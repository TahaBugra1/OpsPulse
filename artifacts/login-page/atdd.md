---
task_slug: login-page
jira_id: null
saga_task_id: null
priority: critical
coverage_target: 80
performance_target: "<100ms hissedilir form etkileşim gecikmesi (backend çağrı süresi hariç)"
memory_target: null
test_strategy:
  unit: 60
  integration: 30
  e2e: 10
affected_modules:
  - frontend/src/pages/Login.tsx (new)
  - frontend/src/lib/validation.ts (new — zod şeması)
  - frontend/src/App.tsx (modify — yeni /login route)
  - frontend/package.json (yeni bağımlılıklar: react-hook-form, zod, @hookform/resolvers, @react-oauth/google, vitest, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, jsdom)
---

# ATDD — login-page

## Jira Kaynağı
Jira'ya bağlı değil — yerel görev.

## Persona
Sistemde zaten kayıtlı (email/şifre VEYA Google ile) herhangi bir kullanıcı (EMPLOYEE/DEPARTMENT_AUTHORITY/ADMIN — rol login akışını etkilemiyor).

## Hedef (Neden)
Frontend'in ilk gerçek özelliği. Backend'in auth katmanı (email/password + Google OAuth) tamamen hazır ve test edilmiş durumda; bu görev, kullanıcının bu API'lere gerçekten erişebileceği bir arayüz sağlıyor. Auth'a dokunduğu için (kılavuzun kendi kararı: "Email/şifre auth → Tam pipeline") tam ATDD zincirinden geçiyor.

## User Story
As a kayıtlı bir kullanıcı
I want email/şifremle veya Google hesabımla giriş yapabilmek
So that uygulamanın geri kalanına erişebileyim

## Acceptance Criteria (Given-When-Then, önceliklendirilmiş)

1. [Critical] Given geçerli bir email/şifre, When kullanıcı `/login` sayfasındaki formu doldurup gönderirse, Then `POST /api/auth/login` `{email, password, rememberMe}` ile çağrılır, başarılı olursa `AuthContext.login(token, user, rememberMe)` çağrılır ve kullanıcı `/` sayfasına yönlendirilir.

2. [Critical] Given yanlış email/şifre kombinasyonu, When form gönderilirse, Then backend'in 401 yanıtındaki mesaj ("Email veya şifre hatalı") formun üzerinde/altında **inline** gösterilir (toast değil), kullanıcı `/login`'de kalır, yönlendirme olmaz.

3. [Critical] Given login rate limiter'ı tetiklenmiş (5 deneme/15dk aşılmış, backend 429 döner), When form gönderilirse, Then kullanıcıya net, anlaşılır bir mesaj gösterilir (sessizce başarısız olmaz, boş bir hata değil).

4. [Critical] Given kullanıcı "Google ile giriş yap" butonuna tıklayıp Google'ın kendi onay akışını tamamlarsa, When `@react-oauth/google`'ın callback'i bir ID token döndürürse, Then `POST /api/auth/google` `{id_token, rememberMe}` ile çağrılır, başarılı olursa AC1'deki AYNI davranış (login + yönlendirme) gerçekleşir.

5. [High] Given backend Google id_token'ı reddederse (400 domain reddi veya 401 geçersiz token), When bu gerçekleşirse, Then net, inline bir hata mesajı gösterilir.

6. [High] Given ağ/sunucu hatası (backend'e hiç ulaşılamıyor, `fetch` reddedilir), When bu gerçekleşirse, Then genel ama anlaşılır bir hata mesajı gösterilir, sayfa donmaz/çökmez.

7. [High] Given email veya şifre alanı boş, When kullanıcı formu göndermeye çalışırsa, Then client-side validasyon gönderimi engeller, alan bazlı hata mesajı gösterir — hiçbir network çağrısı yapılmadan.

8. [High] Given geçersiz bir email formatı, When kullanıcı formu göndermeye çalışırsa, Then client-side validasyon engeller, net bir mesaj gösterir.

9. [Medium] Given "Beni hatırla" checkbox'ı işaretsiz (varsayılan), When login başarılı olursa, Then token `sessionStorage`'da saklanır (`localStorage`'da DEĞİL) — `AuthContext`'in mevcut `setStoredSession` kuralı doğru parametreyle çağrılmış olmalı.

10. [Medium] Given "Beni hatırla" checkbox'ı işaretli, When login başarılı olursa, Then token `localStorage`'da saklanır.

11. [Medium] Given bir login/Google isteği devam ediyor (in-flight), When kullanıcı zaten göndermişse, Then submit butonu devre dışı bırakılır/loading state gösterir (çift gönderimi engeller).

## Test Strategy
Unit: 60% — Vitest + React Testing Library ile form validasyonu (zod şeması), hata mesajı render mantığı, loading state
Integration: 30% — RTL ile `LoginPage`'in `api.ts`/`AuthContext` ile birlikte davranışı (mock edilmiş `fetch` — bu, projenin backend'deki "hiç mocking yok" felsefesinden BİLİNÇLİ bir sapma, frontend component testlerinde gerçek bir backend'e bağlanmak pratik değil; gerçek backend'e karşı doğrulama ayrı olarak Playwright MCP ile canlı yapılacak)
E2E: 10% — Playwright MCP ile orkestratörün kendi canlı tarayıcı doğrulaması (otomatik test suite'in bir parçası değil, manuel doğrulama adımı)

## Benchmark / Başarı Ölçütü
Coverage Target: 80%
Performance Target: <100ms hissedilir form etkileşim gecikmesi (backend çağrı süresi hariç — o backend'in kendi <300ms hedefine tabi)
Memory: belirtilmedi
Diğer ölçülebilir kriterler: yok

## Kapsam Dışı
- Şifremi unuttum akışı — backend'de böyle bir endpoint yok.
- Register/Kayıt sayfası — ayrı bir görev.
- Route guard/korumalı sayfa mantığı (`/`'yi giriş yapmamış kullanıcıdan koruma) — henüz korunacak gerçek bir dashboard yok, dashboard eklenince ayrı bir görevde kurulacak.
- Dark mode/tema değiştirme — shadcn'in tema altyapısı var ama bu görevde bir tema anahtarı eklenmiyor.

## Etkilenen Dosyalar/Modüller (bilinen)
- `frontend/src/pages/Login.tsx` (yeni) — form, validasyon, submit mantığı, Google buton entegrasyonu.
- `frontend/src/lib/validation.ts` (yeni) — zod şeması (email format, şifre boş olmasın).
- `frontend/src/App.tsx` (mevcut, değişecek) — `/login` route'u eklenecek.
- `frontend/package.json` — yeni bağımlılıklar: `react-hook-form`, `zod`, `@hookform/resolvers`, `@react-oauth/google` (runtime); `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom` (dev, test altyapısı — bu görevde ilk kez kuruluyor).
- `frontend/vite.config.ts` (muhtemelen değişecek) — Vitest config'i (`test` alanı) eklenmesi gerekebilir, plan.md'de netleşecek.
- Migration YOK — bu bir frontend görevi, backend'e hiç dokunulmuyor.

## Rollback Beklentisi
Bu bir UI görevi, "rollback" kavramı backend'deki gibi transaction/DB anlamında geçerli değil. Hata durumunda (401/429/400/network) kullanıcı forma net bir mesajla geri döner, hiçbir state kalıcı olarak bozulmaz (AuthContext başarısız bir denemeden sonra `null` state'inde kalmaya devam eder, önceki bir oturum varsa etkilenmez).

## Risks
- `@react-oauth/google`, gerçek bir Google Client ID (`VITE_GOOGLE_CLIENT_ID`, `.env.example`'da zaten placeholder var) gerektiriyor — gerçek bir Google hesabıyla uçtan uca test (gerçek OAuth consent ekranı) bu ortamda mümkün değil, backend'in google-oauth görevindeki aynı sınırlama. Playwright MCP ile canlı doğrulama, Google butonunun DOĞRU RENDER edilmesini ve email/şifre akışının tam çalışmasını kanıtlayacak; Google akışının kendisi (AC4/5) sadece kod incelemesi + component-level testlerle (sahte bir `credentialResponse` callback'i simüle ederek) doğrulanacak, gerçek Google consent ekranıyla değil.

## Assumptions
- `react-hook-form` + `zod` (+ `@hookform/resolvers`) client-side validasyon için — proje henüz bir form kütüphanesi kararı almamıştı, bu en yaygın/az kod gerektiren React+TS kombinasyonu olduğu için seçildi, plan.md aşamasında teyit edilecek.
- Vitest, Vite projeleriyle en doğal entegre olan test runner olduğu için seçildi (Jest yerine) — CLAUDE.md'de bir tercih belirtilmemişti, bu proje-tipine göre makul bir varsayılan.

## Unknowns
- Yok — 12 soru ile tüm kategoriler netleşti.

## Ek Not (red-team sonrası, implementasyondan sonra eklendi)
Implementasyon, yukarıdaki 11 AC'ye ek olarak `GoogleLogin` bileşeninin kendi
`onError` callback'ini de ele alıyor (Google SDK'sının kendisi hata verirse —
ör. popup kapatılması, Google tarafı ağ hatası — sabit bir Türkçe mesaj
gösteriliyor). Bu, AC5'ten (backend'in id_token'ı reddetmesi) FARKLI bir
senaryo ve yukarıdaki 11 AC'nin hiçbirinde açıkça listelenmemişti — red-team
incelemesinde (bkz. `red_team.json`, low/scope bulgusu) tespit edildi.
Retroaktif olarak kabul ediliyor: `GoogleLogin` bileşeni zaten bir `onError`
prop'u zorunlu kılıyor (boş bırakmak hatayı sessizce yutar), bu yüzden
implementasyon doğru ve gerekli — sadece bu ATDD dosyasında baştan
belirtilmemişti. Gelecekte referans için 12. bir AC olarak kaydediliyor:

12. [Low, retroaktif] Given Google SDK'sının kendisi (backend'e hiç
    ulaşmadan) bir hata döndürürse, When bu gerçekleşirse, Then "Google ile
    giriş başarısız oldu, lütfen tekrar deneyin." mesajı gösterilir.

## Sorular ve Cevaplar (ham kayıt)
1. Google Sign-In entegrasyonu → `@react-oauth/google` kütüphanesi.
2. Yönlendirme → `/login` yeni route, başarılı girişte `/`'e.
3. Test altyapısı → Evet, bu görevde kurulsun (Vitest+RTL).
4. Register kapsamda mı → Hayır, sadece Login.
5. Form validasyonu → Evet, temel client-side (react-hook-form + zod).
6. Hata gösterimi → Form üzerinde inline.
7. rememberMe varsayılan → İşaretsiz (false), 1 saatlik oturum.
8. Happy path → Geçerli email/şifre → `/`'e yönlendirme.
9. Edge case'ler → Yanlış email/şifre (401), rate limit (429), Google hatası (400/401), ağ hatası.
10. Benchmark → %80 coverage, <100ms hissedilir gecikme.
11. Kapsam dışı → Şifremi unuttum, Register, route guard, dark mode.
12. Manuel doğrulama → Evet, Playwright MCP ile gerçek tarayıcıda canlı test.
