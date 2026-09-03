---
task_slug: google-oauth
jira_id: null
saga_task_id: null
priority: critical
coverage_target: 85
performance_target: "<300ms (email-password-auth ile aynı; Google'ın kendi imza doğrulama süresi hariç, o ölçülmüyor)"
memory_target: null
test_strategy:
  unit: 70
  integration: 20
  e2e: 10
affected_modules:
  - backend/services/auth.service.js (modify — yeni loginWithGoogle(...) fonksiyonu)
  - backend/services/googleAuth.js (new — verifyGoogleToken(idToken), enjekte edilebilir/test edilebilir izole modül)
  - backend/controllers/auth.controller.js (modify — yeni postGoogleLogin)
  - backend/routes/auth.routes.js (modify — yeni POST /google satırı)
  - backend/package.json (yeni bağımlılık: google-auth-library)
  - backend/.env.example (yeni: GOOGLE_CLIENT_ID)
---

# ATDD — google-oauth

## Jira Kaynağı
Jira'ya bağlı değil — yerel görev.

## Persona
Herhangi bir kişi (henüz sistemde kaydı olan veya olmayan), kurumsal Google hesabıyla giriş yapmak isteyen bir çalışan. Self-servis akış — role seçimi yok, CLAUDE.md'nin locked kararı gereği her zaman EMPLOYEE.

## Hedef (Neden)
CLAUDE.md'nin "Not started" olarak işaretlediği, email/password auth'tan sonra planlanmış izole görev. Backend'in auth katmanını CLAUDE.md'nin Security bölümünde zaten tasarlanmış Google OAuth account-linking kurallarıyla tamamlıyor — bu bir "opsiyonel/zaman kalırsa" özellik değil, Core auth'un planlanmış ama unutulmuş bir parçası.

## User Story
As a kurumsal email adresine sahip bir kişi
I want Google hesabımla tek tıkla giriş yapabilmek
So that ayrı bir şifre oluşturmak/hatırlamak zorunda kalmayayım

## Acceptance Criteria (Given-When-Then, önceliklendirilmiş)

1. [Critical] Given sistemde hiç kaydı olmayan, ALLOWED_EMAIL_DOMAIN'e uyan bir email'e sahip geçerli bir Google ID token, When `POST /api/auth/google` `{id_token}` ile çağrılırsa, Then yeni bir `EMPLOYEE` kullanıcısı oluşturulur (`google_id` token'ın `sub` claim'i, `password_hash` NULL, `name`/`surname` sırasıyla `given_name`/`family_name`'den — `family_name` yoksa `surname` NULL kalır), ve local login ile AYNI şekilde `{token, user}` döner.

2. [Critical] Given sistemde ZATEN kayıtlı bir email'e sahip (herhangi bir domain'den — linking'te domain kontrolü YOK) geçerli bir Google ID token, When `POST /api/auth/google` çağrılırsa, Then mevcut kullanıcının `google_id`'si set/güncellenir, mevcut `role`/`department_id` DEĞİŞMEZ, ve o kullanıcı için `{token, user}` döner.

3. [Critical] Given sistemde hiç kaydı olmayan, ALLOWED_EMAIL_DOMAIN'e UYMAYAN bir email'e sahip geçerli bir Google ID token, When `POST /api/auth/google` çağrılırsa, Then `400` döner (local register'ın domain reddiyle aynı mesaj deseni), hiçbir kullanıcı oluşturulmaz.

4. [High] Given geçersiz/süresi dolmuş/imzasız bir ID token, When `POST /api/auth/google` çağrılırsa, Then `401` döner net bir mesajla, hiçbir DB yazımı olmaz.

5. [High] Given eşleşen/linklenen kullanıcının `is_active = false` olduğu bir durum, When `POST /api/auth/google` çağrılırsa, Then `403` döner (`login()`'deki AYNI kontrol/mesaj reuse edilir), token verilmez.

6. [High] Given `{id_token, rememberMe: true}` vs `rememberMe` olmadan, When `POST /api/auth/google` başarılı olursa, Then JWT süresi sırasıyla `7d`/`1h` olur (local login'in `signToken` fonksiyonu AYNEN reuse edilir).

7. [Medium] Given yukarıdaki başarılı senaryolardan herhangi biri, When response dönerse, Then `password_hash` ASLA response'ta yer almaz (`register`/`login`'in `toPublicUser` deseni reuse edilir).

8. [Medium] Given `verifyGoogleToken` ayrı, enjekte edilebilir bir modülde izole edilmiş, When otomatik testler yazılırsa, Then hesap eşleştirme/oluşturma mantığının (AC1-7) tamamı, gerçek Google ağ çağrısı yapılmadan, sahte ama kontrollü claim'ler döndüren bir test-double ile test edilebilir.

## Test Strategy
Unit: 70% — `loginWithGoogle`'ın hesap eşleştirme/oluşturma/domain-kontrol/is_active mantığı (`verifyGoogleToken` enjekte edilerek, sahte claim'lerle)
Integration: 20% — gerçek Postgres'e karşı `POST /api/auth/google` uçtan uca (yine enjekte edilmiş sahte doğrulayıcıyla, ama gerçek DB/gerçek HTTP)
E2E: 10% — N/A (frontend henüz yok)

## Benchmark / Başarı Ölçütü
Coverage Target: 85%
Performance Target: <300ms (email-password-auth ile aynı; Google'ın kendi ağ gecikmesi bu ölçüme dahil değil, gerçek doğrulama testlerde zaten sahte)
Memory: belirtilmedi
Diğer ölçülebilir kriterler: yok

## Kapsam Dışı
- Email doğrulama (email verification) — CLAUDE.md'nin kendisi zaten kapsam dışı bırakıyor ("Full email verification is out of scope unless explicitly requested"), bilinen kabul edilmiş bir risk.
- Hesap bağlantısını kaldırma (unlink Google) — bir kullanıcının `google_id`'sini kaldırıp sadece şifreyle girişe dönme özelliği yok.
- Frontend/UI (Google Sign-In butonu, SDK entegrasyonu) — frontend henüz yok, bu görev sadece backend token doğrulama + hesap eşleştirme.
- Birden fazla Google hesabını aynı kullanıcıya bağlama — `users.google_id` zaten `UNIQUE`, çoklu bağlama kavramı yok.
- Tam sunucu-tarafı OAuth redirect akışı (Authorization Code flow, CLIENT_SECRET) — ID token doğrulama modeli seçildi, redirect/session yönetimi yok.

## Etkilenen Dosyalar/Modüller (bilinen)
- `backend/services/googleAuth.js` (yeni) — `verifyGoogleToken(idToken)`: `google-auth-library`'nin `OAuth2Client.verifyIdToken(...)`'ını sarmalar, doğrulanmış claim'leri (`email`, `given_name`, `family_name`, `sub`) döndürür ya da hata fırlatır. Bu fonksiyonun kendisi test edilebilirlik için `loginWithGoogle`'a bir parametre olarak enjekte edilebilir olacak (plan.md aşamasında kesin imza netleşecek).
- `backend/services/auth.service.js` (mevcut) — yeni `loginWithGoogle({id_token, rememberMe}, verifyFn = verifyGoogleToken)` fonksiyonu, mevcut `fail`/`signToken`/`toPublicUser`/`emailDomain` helper'larını REUSE eder.
- `backend/controllers/auth.controller.js` (mevcut) — yeni `postGoogleLogin`, mevcut `postRegister`/`postLogin` ile aynı ince try/catch şablonu.
- `backend/routes/auth.routes.js` (mevcut) — yeni `router.post('/google', postGoogleLogin)`.
- `backend/package.json` — yeni bağımlılık: `google-auth-library`.
- `backend/.env.example` — yeni: `GOOGLE_CLIENT_ID` (ID token'ın `aud` claim'ini doğrulamak için gerekli, `verifyIdToken`'a `audience` parametresi olarak geçilir).
- Migration YOK — `users.google_id`/`password_hash` zaten nullable, şema zaten bu senaryo için tasarlanmış (CLAUDE.md'nin kendi notu).

## Rollback Beklentisi
Salt yazma işlemi başarısız olursa (DB hatası), `fail(500, ...)` ile net bir hata döner, hiçbir yarım kalan kullanıcı satırı oluşmaz (tek bir `INSERT`/`UPDATE`, transaction'a gerek yok — `register()`'ın mevcut deseniyle tutarlı, tek sorgu zaten atomik). Google token doğrulaması başarısız olursa hiçbir DB işlemi hiç başlamaz (401 en baştan döner).

## Risks
- **CLAUDE.md'nin kendi belgelediği bilinen risk (birebir alındı)**: "local registration has no email verification step, so someone could register a fake account claiming another employee's real email, and Google-linking would then attach the real employee's Google identity to the attacker's account. Mitigation: restrict self-registration to a configurable corporate email domain" — bu mitigation zaten `ALLOWED_EMAIL_DOMAIN` ile mevcut (hem local register'da hem bu görevin AC3'ünde). Tam email doğrulama olmadığı için risk TAMAMEN ortadan kalkmıyor, sadece azaltılıyor — CLAUDE.md'nin kendi kararıyla kabul edilmiş.
- `verifyGoogleToken`'ın enjekte edilebilir olması, "hiç mocking yok" proje felsefesinden BİLİNÇLİ bir sapma — kullanıcı onayıyla, sadece 3. taraf ağ çağrısı için kabul edilen tek istisna.

## Assumptions
- Google ID token'ın claim yapısı: `email`, `email_verified`, `given_name`, `family_name` (opsiyonel), `sub` (Google'ın kullanıcı ID'si) — Google'ın standart OpenID Connect ID token şeması.
- `email_verified` claim'i `true` olmayan bir Google token'ı da (nadir ama mümkün) bu görevde ayrıca reddetme mantığı YOK — atdd.md'de açıkça sorulmadı, plan.md aşamasında `verifyGoogleToken`'ın bunu kontrol edip etmeyeceği netleşecek (Google'ın kendi `verifyIdToken`'ı zaten güçlü bir doğrulama yapıyor, ek bir kontrol gerekmeyebilir).

## Unknowns
- Yok — 11 soru ile tüm kategoriler netleşti.

## Sorular ve Cevaplar (ham kayıt)
1. OAuth akışı → ID Token doğrulama (Recommended, redirect flow değil).
2. Test stratejisi (Google'a bağlanmadan) → verifyGoogleToken enjekte edilebilir bir fonksiyon.
3. Domain kısıtlaması ne zaman → Sadece YENİ hesap oluşturulurken, linking'te yok.
4. Manuel doğrulama nasıl → Sahte ama geçerli şekilde imzalanmış bir test ID token ile canlı doğrulama.
5. Happy path → Yeni kullanıcı, kurumsal domain'de, ilk kez Google ile giriş.
6. rememberMe → Evet, local login ile aynı parametre/davranış.
7. is_active=false → 403, local login ile aynı mesaj.
8. Benchmark → email-password-auth ile aynı (%85, <300ms, 70/20/10).
9. Geçersiz token → 401, net mesaj.
10. Kapsam dışı → Email doğrulama, unlink, frontend/UI, çoklu Google hesabı bağlama — hepsi kapsam dışı.
11. Dosya kapsamı → Mevcut auth dosyalarına ekleme + yeni izole googleAuth.js helper'ı.
