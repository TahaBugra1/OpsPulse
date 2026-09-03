# Plan — google-oauth
_Reference: atdd.md_

## Files to Modify

| File | Why | Risk |
|------|-----|------|
| `backend/services/auth.service.js` | Yeni `loginWithGoogle({id_token, rememberMe}, verifyFn = verifyGoogleToken)` eklenecek. Mevcut `fail`/`signToken`/`toPublicUser`/`emailDomain` helper'ları AYNEN reuse edilecek (değiştirilmeyecek). `verifyFn` parametresi AC8'in test edilebilirlik gereksinimini karşılıyor — üretimde varsayılan olarak gerçek `verifyGoogleToken` kullanılır, testler kendi sahte fonksiyonlarını geçebilir. | medium (yeni bir fonksiyon ama tamamen mevcut desenlerin devamı) |
| `backend/controllers/auth.controller.js` | Yeni `postGoogleLogin` — mevcut `postRegister`/`postLogin` ile BİREBİR aynı ince try/catch şablonu. | low |
| `backend/routes/auth.routes.js` | Yeni `router.post('/google', postGoogleLogin)`. **Kritik keşif**: mevcut `loginLimiter`'ın `keyGenerator: (req) => req.body.email \|\| 'unknown'`'ı `/google` route'una UYGULANMAMALI — Google akışının request body'sinde `email` alanı yok (sadece `id_token`), bu yüzden `loginLimiter` bu route'a eklenirse TÜM Google giriş denemeleri (tüm kullanıcılar) `'unknown'` anahtarı altında TEK bir paylaşılan 5-istek/15-dakika kotasına düşer — 5. kullanıcıdan sonra herkes kilitlenir. Ayrıca `loginLimiter`'ın asıl amacı (şifre brute-force'unu yavaşlatmak) Google akışında geçerli değil (tahmin edilecek bir şifre yok, token Google tarafından imzalanıyor). Çözüm: `/google`'a `loginLimiter` EKLENMEYECEK — `server.js`'de zaten global olarak uygulanan `apiLimiter` (IP-bazlı, 300/15dk, `/api/auth` dahil tüm route'ları kapsıyor) yeterli koruma sağlıyor. | medium (yanlış limiter eklenirse gerçek bir kullanılabilirlik hatası olur — code-copilot'a açıkça belirtildi) |
| `backend/package.json` | `google-auth-library` (dependency) eklenecek. | low |
| `backend/.env.example` | `GOOGLE_CLIENT_ID=` satırı eklenecek (yorum satırıyla: "Google Cloud Console'dan alınan OAuth 2.0 Client ID"). | low |

## New Files

| File | Purpose |
|------|---------|
| `backend/services/googleAuth.js` | `verifyGoogleToken(idToken)` — `google-auth-library`'nin `OAuth2Client.verifyIdToken(...)`'ını sarmalar. Tam kullanım deseni (`google-auth-library`'nin resmi API'si, code-copilot'un keşfetmesine gerek yok, doğrudan bu şekilde kullanılacak): <br>`const { OAuth2Client } = require('google-auth-library');`<br>`const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);`<br>`async function verifyGoogleToken(idToken) { const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID }); const payload = ticket.getPayload(); return { email: payload.email, given_name: payload.given_name, family_name: payload.family_name, sub: payload.sub }; }`<br>`verifyIdToken` kendi içinde imza/süre/audience doğrulamasını zaten yapıyor ve geçersizse hata fırlatıyor — `auth.service.js` bu hatayı yakalayıp `fail(401, ...)`'a çevirecek. |

## Dependencies

### `loginWithGoogle`'ın akışı (atdd.md'nin AC1-7'sini tek fonksiyonda karşılayacak sıra)
1. `verifyFn(id_token)` çağrılır — hata fırlatırsa (`try/catch`) → `fail(401, 'Geçersiz Google kimlik doğrulaması')` (AC4).
2. Dönen `{email, given_name, family_name, sub}` ile `SELECT id, ... FROM users WHERE email = $1` (mevcut `login()`'in sorgu deseniyle tutarlı — `citext` sayesinde case-insensitive zaten).
3. Satır BULUNAMAZSA (yeni kullanıcı yolu):
   - `emailDomain(email) !== ALLOWED_EMAIL_DOMAIN` ise → `fail(400, 'Bu email domaini ile kayıt olunamaz')` (`register()`'daki AYNI mesaj, AC3).
   - Aksi halde `INSERT INTO users (name, surname, email, google_id, role) VALUES ($1, $2, $3, $4, 'EMPLOYEE') RETURNING ...` (`password_hash` hiç geçilmiyor, NULL kalıyor — schema'nın `CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)` kısıtına zaten uygun, AC1).
4. Satır BULUNURSA (linking yolu, AC2):
   - Domain kontrolü YOK (atdd.md'nin kararı).
   - `is_active` kontrolü: `if (!row.is_active) fail(403, 'Hesap aktif değil')` (`login()`'deki AYNI kontrol, AC5).
   - `google_id`'si zaten aynıysa veya farklıysa `UPDATE users SET google_id = $1 WHERE id = $2` (idempotent — ilk linking'te set eder, sonraki Google girişlerinde zaten aynı değeri yazar, zararsız).
5. Her iki yolda da: `toPublicUser(row)` + `signToken(user, rememberMe === true ? '7d' : '1h')` (AC6/AC7 — mevcut fonksiyonlar birebir reuse).

### Yeni kullanıcı INSERT'inde dikkat edilecek nokta
`register()`'ın INSERT'i `'EMPLOYEE'` rolünü sabit yazıyor (`VALUES ($1, $2, $3, $4, 'EMPLOYEE')`) — `loginWithGoogle`'ın INSERT'i de AYNI şekilde rolü sabit `'EMPLOYEE'` yazmalı (CLAUDE.md: "Role is always EMPLOYEE regardless of registration path — this is a separate code path from email/password registration and must independently enforce the same rule"). Bu, `register()`'dan KOPYALANMIŞ bir davranış olmalı, parametrik/değişken bir rol ASLA kabul edilmemeli.

## Migration Required?
**Hayır.** `users.google_id`/`password_hash` zaten nullable, `CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)` zaten bu senaryo için tasarlanmış (schema.sql'in kendi yorumu: "a user can be local-only, Google-only, or both").

## Risks
_(atdd.md'den taşınan + keşifte netleşenler)_
- **[Kritik keşif]** `loginLimiter`'ın `/google` route'una yanlışlıkla eklenmesi gerçek bir kullanılabilirlik hatası yaratır (yukarıda detaylandırıldı) — code-copilot'a açıkça "EKLEME" talimatı verilecek.
- CLAUDE.md'nin belgelediği email-doğrulama-eksikliği riski (atdd.md'de zaten taşındı) — `ALLOWED_EMAIL_DOMAIN` mitigation'ı hem local register'da hem burada (yeni hesap oluşturmada) tutarlı şekilde uygulanıyor.
- `verifyGoogleToken`'ın enjekte edilebilir olması (atdd.md'nin kararı) — `loginWithGoogle`'ın imzası `(payload, verifyFn = verifyGoogleToken)` şeklinde olacak, `controller` katmanı `verifyFn`'i hiç bilmeyecek/geçmeyecek (sadece testler bunu doğrudan çağırırken geçecek) — üretim davranışı hiç etkilenmiyor.

## Open Questions
Yok — mimari netleşti (rate limiter kararı dahil), code-copilot'a hazır.
