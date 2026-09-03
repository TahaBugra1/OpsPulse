# Code Diff — google-oauth
_Reference: atdd.md, plan.md_

## Files Created
- `backend/services/googleAuth.js` — `verifyGoogleToken(idToken)`, `google-auth-library`'nin `OAuth2Client.verifyIdToken`'ını sarmalıyor, plan.md'nin verdiği tam şekille birebir aynı.

## Files Modified
- `backend/services/auth.service.js` — `register`/`login`/`fail`/`toPublicUser`/`signToken`/`emailDomain`/`EMAIL_RE` **byte-for-byte değişmedi** (kod okunarak doğrulandı). Yeni `loginWithGoogle({id_token, rememberMe}, verifyFn = verifyGoogleToken)` eklendi: `verifyFn` başarısızsa 401, yeni kullanıcı yolunda domain kontrolü (`register()`'ın aynı mesajıyla) + `role='EMPLOYEE'` SQL metninde sabit + `password_hash` hiç geçilmiyor, mevcut kullanıcı yolunda domain kontrolü YOK + `is_active` kontrolü (`login()`'in aynı mesajıyla) + idempotent `google_id` UPDATE. Her iki yol da `toPublicUser`/`signToken`'ı değiştirmeden reuse ediyor.
- `backend/controllers/auth.controller.js` — `postGoogleLogin` eklendi, diğer 2 handler'la birebir aynı ince try/catch şablonu.
- `backend/routes/auth.routes.js` — `router.post('/google', postGoogleLogin)` eklendi. **Kritik**: `loginLimiter` bu route'a EKLENMEDİ (plan.md'nin işaret ettiği rate-limiter hatasından kaçınıldı) — kod okunarak doğrulandı.
- `backend/package.json`/`package-lock.json` — `google-auth-library@^9.0.0` eklendi, `npm install` çalıştırıldı ve doğrulandı (`node_modules/google-auth-library` mevcut).
- `backend/.env.example` — `GOOGLE_CLIENT_ID=` satırı eklendi.

## Acceptance Criteria Coverage (kod okunarak + npm test + canlı sanity check ile doğrulandı)

| AC | Status | Nasıl doğrulandı |
|----|--------|-------------------|
| 1 — yeni kullanıcı, uygun domain, EMPLOYEE, password_hash NULL | ✅ | Canlı: DB'de `password_hash NULL`, `google_id` set, `surname` doğru map'lenmiş |
| 2 — mevcut kullanıcıya linking, domain kontrolü yok, rol/departman değişmez | ✅ | Canlı: aynı `user.id`, rol hâlâ EMPLOYEE |
| 3 — yeni email + yanlış domain → 400, kullanıcı oluşmaz | ✅ | Canlı: `status 400`, DB'de satır yok |
| 4 — geçersiz token → 401, DB yazımı yok | ✅ | Canlı: `status 401` |
| 5 — is_active=false → 403 | ✅ | Canlı: `status 403` |
| 6 — rememberMe → 7d/1h | ✅ | Canlı: JWT `exp-iat` farkı sırasıyla ~7gün/~1saat |
| 7 — password_hash asla response'ta yok | ✅ | Canlı: `res.user.password_hash === undefined` |
| 8 — verifyFn enjekte edilebilir, gerçek ağ çağrısı olmadan test edilebilir | ✅ | Canlı sanity check'in kendisi bunu kanıtlıyor — hiç gerçek Google çağrısı yapılmadan tüm akış test edildi |

**Ayrıca doğrulandı**: `npm install` (19 paket, 0 hata) + `npm test` 2 ardışık çalıştırma, ikisinde de **94/94 PASS** (bu görevde henüz yeni test dosyası yok — test-copilot'un işi, mevcut testlerin bozulmadığı doğrulandı). Canlı sanity check (geçici script, silindi): **14/14 PASS**, DB'de kalıntı yok.

## Remaining Limitations
- Email doğrulama, unlink, çoklu Google hesabı bağlama, frontend, tam redirect OAuth akışı yok (hepsi kapsam dışı, atdd.md kararı).

## Assumptions
- `google-auth-library@^9.0.0` makul bir güncel major versiyon (plan.md'nin önerisiyle tutarlı).
- DB hata mesajları `login()`'in tonuyla tutarlı (`'Giriş yapılamadı, lütfen tekrar deneyin'`) — plan.md kesin metni code-copilot'un takdirine bırakmıştı, tutarlılık şartıyla.

## Addendum — red-team follow-up fix (aynı task-slug, code-copilot ikinci tur)
`artifacts/google-oauth/red_team.json`'ın 2 bulgusundan 1'i düzeltildi (`backend/services/auth.service.js`, başka dosya değişmedi):

**[Low/Reliability, düzeltildi]** `loginWithGoogle`'ın yeni-kullanıcı INSERT'ine, `register()`'daki `if (dbErr.code === '23505') { fail(409, 'Bu email zaten kayıtlı'); }` deseni eklendi — iki eşzamanlı Google girişi aynı yeni email için yarışırsa artık belirsiz bir 500 yerine net bir 409 dönüyor.

**[Medium/Security, kabul edilen risk, düzeltilmedi]** `gaxios`→`uuid` transitive npm audit bulgusu — red-team'in kendi önerisi zaten "şimdi aksiyon gerekmiyor, `--force` ile zorlama" idi, bu bir kod düzeltmesi değil, izlenen bir teknik borç olarak bırakıldı.

**Doğrulama (orkestratör tarafından bağımsız):**
- Dosya okundu, `23505` özel durumu doğrulandı (satır 146-148); başka hiçbir dosya değişmemiş (`git status --short`).
- `npm test`: 2 ardışık çalıştırma, ikisinde de **102/102 PASS, 0 FAIL** (davranış değişmedi, sadece hata mesajı kalitesi iyileştirildi).

## CAVEMAN Review
- **Files added**: 1 — `googleAuth.js`, task spec'in doğrudan gerektirdiği, gerekçeli.
- **New abstractions**: 0 (sadece 1 yeni fonksiyon, 1 yeni dosya — hepsi AC'nin doğrudan gerektirdiği).
- **New helper functions**: `loginWithGoogle` — gerekli, fazlası yok.
- **New public APIs**: `postGoogleLogin`, `POST /api/auth/google` — AC'nin doğrudan gerektirdiği.
- **Complexity justification**: `loginWithGoogle`'ın dallanması (yeni kullanıcı / linking) plan.md'nin öngördüğü akışla birebir aynı, gereksiz bir soyutlama veya spekülatif kod yok. `register`/`login`'e hiç dokunulmamış.
