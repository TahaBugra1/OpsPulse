---
task_slug: email-password-auth
jira_id: null
saga_task_id: null
priority: critical
coverage_target: 85
performance_target: "<300ms"
memory_target: null
test_strategy:
  unit: 70
  integration: 20
  e2e: 10
affected_modules:
  - backend/routes/auth.routes.js (new)
  - backend/controllers/auth.controller.js (new)
  - backend/services/auth.service.js (new)
  - backend/middleware/auth.middleware.js (new — JWT verify + is_active recheck, reusable by future protected routes)
  - backend/services/db.js (existing, reused — no changes)
  - backend/server.js (mount /api/auth routes + dedicated login rate limiter)
  - backend/.env / backend/.env.example (add ALLOWED_EMAIL_DOMAIN)
  - db/schema.sql users table (read-only — no migration needed, table already exists)
---

# ATDD — email-password-auth

## Jira Kaynağı
Jira'ya bağlı değil — yerel görev. `jira-sync` bu projede kullanılmıyor (CLAUDE.md: "no Jira/Saga instance exists").

## Persona
Herhangi bir yeni şirket çalışanı — self-servis kayıt oluyor. Kayıt formunda rol seçimi yok; herkes `EMPLOYEE` olarak oluşturulur (ADMIN/DEPARTMENT_AUTHORITY sadece seed data veya admin-only user-management ekranından oluşturulur, bu görevin kapsamında değil). Login, zaten var olan (seed edilmiş veya kayıtlı) her rolden kullanıcı için ortak bir akıştır.

## Hedef (Neden)
Auth, tüm sistemin giriş kapısı — request oluşturma, department authority işlemleri ve admin ekranları dahil hiçbir şey auth olmadan çalışmaz. Bu görev olmadan backend'in geri kalanı test edilemez.

## User Story
As a çalışan (employee)
I want email/şifre ile kayıt olup giriş yapabilmek
So that kimliğim doğrulanmış şekilde sistemdeki (IT/HR/Finance) taleplerimi oluşturup takip edebileyim

## Acceptance Criteria (Given-When-Then, önceliklendirilmiş)

1. [Critical] Given geçerli bir kurumsal email (`ALLOWED_EMAIL_DOMAIN` ile eşleşen), benzersiz email ve min 8 karakterlik şifre, When `POST /api/auth/register` çağrılır, Then email formatı → domain kısıtı → email benzersizliği → şifre uzunluğu sırasıyla kontrol edilir, şifre bcrypt ile hash'lenir, `role='EMPLOYEE'` ile `users` tablosuna INSERT edilir ve 201 ile `{ token, user: { id, name, surname, email, role, department_id } }` döner (`password_hash` asla response'a girmez).

2. [Critical] Given zaten kayıtlı bir email/şifre çifti ve `is_active=true` bir kullanıcı, When `POST /api/auth/login` çağrılır, Then şifre bcrypt.compare ile doğrulanır, `rememberMe=true` ise 7 günlük (localStorage için) `rememberMe=false`/verilmemişse 1 saatlik (sessionStorage için) JWT üretilir, 200 ile `{ token, user: {...} }` döner.

3. [Critical] Given `is_active=false` olan bir kullanıcı, When bu kullanıcı geçerli şifreyle `POST /api/auth/login` çağırır, Then 403 döner ("Hesabınız devre dışı bırakılmış" benzeri bir mesajla), token üretilmez.

4. [High] Given zaten kayıtlı bir email, When aynı email ile ikinci kez `POST /api/auth/register` çağrılır, Then 409 Conflict, "Bu email zaten kayıtlı" mesajı döner (kullanıcı dostu, açık mesaj — enumeration koruması bu görevin kapsamında değil, internal tool kabul edildi).

5. [High] Given `ALLOWED_EMAIL_DOMAIN` ile eşleşmeyen bir email, When `POST /api/auth/register` çağrılır, Then 400 döner, kayıt oluşturulmaz.

6. [High] Given var olan bir email ama yanlış şifre, When `POST /api/auth/login` art arda 5 kez aynı email için çağrılır, Then 6. denemede (ve 15 dakika boyunca) email bazlı rate-limit devreye girer, 429 döner — bu limiter global API limiter'dan ayrı, login'e özel ve email'e göre anahtarlanır (paylaşılan ofis IP'lerinde yanlışlıkla başka kullanıcıları kilitlememek için).

7. [High] Given geçerli bir JWT ile korumalı bir endpoint'e (örn. gelecekteki `/me`) istek atan bir kullanıcı, When bu kullanıcı istek anında `is_active=false` ise (JWT hâlâ süresi dolmamış olsa bile), Then 401/403 döner — `is_active` her authenticated istekte DB'den taze okunur, JWT payload'ındaki değere güvenilmez.

8. [Medium] Given 8 karakterden kısa bir şifre, When `POST /api/auth/register` çağrılır, Then 400 döner, "Şifre en az 8 karakter olmalı" mesajıyla.

9. [Medium] Given kayıt sırasında DB bağlantısı/INSERT hatası oluşursa, When `POST /api/auth/register` çağrılır, Then 500 döner, generic bir hata mesajı ("Kayıt oluşturulamadı, lütfen tekrar deneyin") — tek INSERT olduğu için ayrıca bir transaction/rollback mekanizması gerekmiyor, yarım kalan state oluşmaz.

## Test Strategy
Unit: 70% — `auth.service.js` içindeki saf mantık (şifre kural kontrolü, email domain kontrolü, JWT payload/expiresIn seçimi, bcrypt hash/compare çağrıları mocked DB ile)
Integration: 20% — gerçek (test) Postgres'e karşı `POST /api/auth/register` ve `POST /api/auth/login` uçtan uca (route→controller→service→DB), rate-limit davranışı dahil
E2E: 10% — şimdilik **N/A** (frontend henüz yok); Playwright MCP frontend aşamasında bu task'a geri dönülüp doldurulacak

## Benchmark / Başarı Ölçütü
Coverage Target: 85%
Performance Target: <300ms (yerel/dev ortamda, bcrypt hash maliyeti dahil, register ve login endpoint'leri için)
Memory: belirtilmedi
Diğer ölçülebilir kriterler: login rate-limit — 5 deneme / 15 dakika, email bazlı anahtarlama

## Kapsam Dışı
- Email doğrulama (verification link) — CLAUDE.md'de bilinen, bu görevde çözülmeyen bir risk olarak açıkça işaretli
- Refresh-token altyapısı — proje genelinde kapsam dışı (CLAUDE.md "Explicitly Out of Scope")
- Google OAuth account linking — ayrı bir görev, bu ATDD'yi kapsamıyor
- Şifre sıfırlama / "forgot password" akışı — istenmedi, eklenmiyor
- Email enumeration koruması (generic hata mesajları) — kullanıcı açık mesaj tercih etti (AC4)
- `/me` endpoint'inin tam implementasyonu — sadece AC7'nin gerektirdiği `is_active` recheck middleware'i bu görevde yazılıyor, `/me` route'unun kendisi opsiyonel/gelecek görev

## Etkilenen Dosyalar/Modüller (bilinen)
- `backend/routes/auth.routes.js` (yeni)
- `backend/controllers/auth.controller.js` (yeni)
- `backend/services/auth.service.js` (yeni)
- `backend/middleware/auth.middleware.js` (yeni — JWT verify + is_active recheck)
- `backend/server.js` (auth route'larını mount etmek + login'e özel rate limiter eklemek için düzenlenecek)
- `backend/.env`, `backend/.env.example` (`ALLOWED_EMAIL_DOMAIN` eklenecek)
- `db/schema.sql` (mevcut `users` tablosu okunacak, migration YOK — tablo zaten hazır)
- `backend/services/db.js` (mevcut pg Pool, değişiklik yok, reuse)

## Rollback Beklentisi
DB hatası durumunda 500 + generic hata mesajı yeterli; tek INSERT/SELECT olduğu için ayrı bir transaction/rollback mekanizmasına gerek yok (AC9).

## Risks
- Login rate-limiter'ın email bazlı anahtarlanması, in-memory store kullanılıyorsa çoklu backend instance'ında (yatay ölçekleme) tutarsız çalışır — bu MVP'de tek instance varsayıldığı için kabul edilebilir risk, ölçeklenirse Redis-backed store gerekir (bu görevin kapsamı dışında, not olarak düşülüyor).
- `ALLOWED_EMAIL_DOMAIN` uygulaması, gerçek email doğrulaması değildir — sadece domain formatını kontrol eder, CLAUDE.md'nin belirttiği gibi hâlâ "sahte hesap + Google-linking" riskini tam çözmez, sadece azaltır.

## Assumptions
- `ALLOWED_EMAIL_DOMAIN` tek bir domain string'i olarak `.env`'de tutulacak (örn. `sirket.com`) — çoklu domain desteği istenmedi, varsayım olarak tek domain.
- Login rate-limiter için ayrı bir paket kurulumuna gerek yok — zaten yüklü olan `express-rate-limit`, farklı bir `keyGenerator` (email bazlı) ve farklı bir `windowMs`/`limit` ile ikinci bir instance olarak kullanılacak.
- JWT payload içeriği: `{ sub: user.id, role, department_id }` — CLAUDE.md'de payload şeması net belirtilmediği için makul bir varsayım; `is_active` payload'a eklenmez (zaten her istekte DB'den taze okunacağı için payload'da taşımanın anlamı yok).

## Unknowns
- Kurumsal email domain'in gerçek değeri (örn. `opspulse.com` mu, gerçek bir şirket domaini mi) — `.env.example`'a placeholder yazılacak, gerçek değeri kullanıcı deploy sırasında ayarlayacak.

## Sorular ve Cevaplar (ham kayıt)
1. Kayıt formunda hangi alanlar zorunlu, backend hangi sırayla kontrol etsin? → Standart: name, surname (opsiyonel), email, password — sıra: email format → email unique → password kural → bcrypt hash → INSERT → JWT.
2. Login başarılı olduğunda response'da neler dönsün? → Token + kullanıcı özeti: `{ token, user: { id, name, surname, email, role, department_id } }`, `password_hash` asla dönmez.
3. Aynı email ile ikinci kayıt denemesinde ne dönmeli? → 409 Conflict, açık mesaj ("Bu email zaten kayıtlı").
4. Yanlış şifre girişlerinde kaç denemeden sonra ve ne kadar süreyle rate-limit uygulansın? → 5 deneme / 15 dakika, email bazlı.
5. Kayıtta şifre için minimum kural ne olsun? → Min 8 karakter, başka kompozisyon kuralı yok.
6. Kurumsal email domain kısıtı bu task'ta uygulansın mı? → Evet, `ALLOWED_EMAIL_DOMAIN` env değişkeniyle şimdi uygulanacak.
7. Test coverage hedefi kaç %? → 85%.
8. Login/register endpoint'leri için yanıt süresi hedefi var mı? → <300ms.
9. Kayıt sırasında DB hatası olursa ne olmalı? → 500 dön, temiz hata mesajı, transaction/rollback gerekmiyor.
10. Bu task "tamamlandı" sayılması için kimin onayı yeterli? → Otomatik testler + `/verify` yeterli değil; kullanıcının curl/Postman ile manuel doğrulaması da gerekiyor.
11. Test stratejisi oranı (backend API varsayılanı 70/20/10) onaylanıyor mu? → Evet, Unit 70 / Integration 20 / E2E 10 (E2E şimdilik N/A, frontend geldiğinde Playwright ile doldurulacak).
