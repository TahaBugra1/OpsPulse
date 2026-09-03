---
task_slug: route-guard
jira_id: null
saga_task_id: null
priority: high
coverage_target: 80
performance_target: "<50ms redirect kararı (client-side, backend çağrısı hariç)"
memory_target: null
test_strategy:
  unit: 60
  integration: 30
  e2e: 10
affected_modules:
  - frontend/src/components/ProtectedRoute.tsx (new)
  - frontend/src/lib/api.ts (modify — 401 interceptor)
  - frontend/src/App.tsx (modify — route guard wiring)
  - frontend/src/pages/Home.tsx (modify — kullanıcı adı/rolü gösteren basit shell)
---

# ATDD — route-guard

## Jira Kaynağı
Jira'ya bağlı değil — yerel görev.

## Persona
Sistemde zaten giriş yapmış (veya yapmamış) herhangi bir kullanıcı (EMPLOYEE/DEPARTMENT_AUTHORITY/ADMIN — rol bu görevde davranışı etkilemiyor, hepsi aynı guard mantığına tabi).

## Hedef (Neden)
login-page'in tamamladığı auth akışının, gerçek anlamda bir şeyi korumasını sağlamak. Şu an başarılı bir girişin ineceği yer sadece "Yapım aşamasında" placeholder'ı — hem demo edilebilirliği hem de sonraki her frontend özelliğinin (request listesi, analytics dashboard'u) üzerine oturacağı temeli engelliyor. Bu görev, sonraki tüm korumalı sayfaların üzerine kurulacağı `ProtectedRoute` mekanizmasını ve token geçersizleşince (401) otomatik çıkışı kurar.

## User Story
As a giriş yapmış veya yapmamış bir kullanıcı
I want korumalı sayfalara sadece giriş yapmışsam erişebilmek, token'ım geçersizleşince otomatik çıkış yapmak
So that uygulama beklediğim şekilde güvenli ve tutarlı davransın

## Acceptance Criteria (Given-When-Then, önceliklendirilmiş)

1. [Critical] Given kullanıcı giriş yapmamış (`AuthContext.user === null`), When `/` (korumalı route) adresine erişmeye çalışırsa, Then `/login`'e yönlendirilir, `/`'in gerçek içeriği hiç render edilmez.

2. [Critical] Given kullanıcı giriş yapmış, When `/` adresine erişirse, Then sayfa normal render olur — kullanıcının adını ve rolünü gösteren basit bir shell (gerçek dashboard içeriği DEĞİL, sadece "Hoş geldin, {name} ({role})" seviyesinde).

3. [Critical] Given kullanıcı zaten giriş yapmış, When `/login` sayfasına gitmeye çalışırsa, Then otomatik olarak `/`'e yönlendirilir, login formu hiç render edilmez.

4. [Critical] Given `POST /api/auth/login` veya `POST /api/auth/google` isteği 401 dönerse (yanlış şifre/geçersiz Google token), When bu gerçekleşirse, Then global 401-interceptor TETİKLENMEZ — bu senaryo zaten Login.tsx'in kendi inline hata gösterimiyle (login-page görevinde tamamlandı) ele alınıyor. Global logout/redirect tetiklenirse login sayfasında sonsuz döngü veya yanlış "oturumunuz sona erdi" mesajı oluşur.

5. [High] Given giriş yapmış bir kullanıcının login/google DIŞINDAKİ herhangi bir API çağrısı backend'den 401 dönerse (örn. token süresi dolmuş), When bu gerçekleşirse, Then `AuthContext.logout()` çağrılır, TanStack Query cache'i (`queryClient.clear()`) temizlenir, kullanıcı `/login`'e yönlendirilir.

6. [High] Given `ProtectedRoute` veya 401-interceptor içinde beklenmedik bir hata/exception oluşursa, When bu gerçekleşirse, Then fail-closed davranılır — kullanıcı içeri alınmaz, `/login`'e yönlendirilir (fail-open değil).

7. [Medium] Given localStorage/sessionStorage'da süresi dolmuş ama HÂLÂ MEVCUT bir JWT varsa, When kullanıcı `/` sayfasını (ilk kez veya yenileyerek) açarsa, Then `ProtectedRoute` token'ın içeriğini/süresini decode etmediği için sayfayı ilk anda render eder (kullanıcı içeride görünür) — asıl geçersizlik ancak bir sonraki gerçek API çağrısı 401 aldığında (AC5 üzerinden) yakalanıp kullanıcı çıkışa yönlendirilir. Bu, bilinçli bir tasarım kararı (client-side JWT expiry-decode bu görevde YAPILMAYACAK, bkz. Kapsam Dışı).

8. [Medium] Given `AuthContext.logout()` herhangi bir yoldan (401-interceptor veya ileride eklenecek manuel bir çıkış eylemi) çağrılırsa, When bu gerçekleşirse, Then TanStack Query cache'i (`queryClient.clear()`) de temizlenir — bir sonraki kullanıcı aynı tarayıcıda giriş yaparsa önceki kullanıcının cache'lenmiş verisini görmez.

## Test Strategy
Unit: 60% — Vitest ile `ProtectedRoute`'un redirect mantığı (authenticated/unauthenticated dallar), `api.ts`'in 401-interceptor'ının login/google endpoint'lerini hariç tuttuğunu doğrulayan testler.
Integration: 30% — RTL ile `App.tsx` route ağacının tamamı (gerçek `AuthProvider` + `MemoryRouter` ile) — giriş yapmamış kullanıcı `/`'e gidince `/login`'i görüyor mu, tersi de doğru mu.
E2E: 10% — Orkestratörün kendi canlı Playwright doğrulaması (AC1/2/3 gerçek tarayıcıda; AC5'in gerçek bir canlı tetikleyicisi bu görev kapsamında YOK — bkz. Risks).

## Benchmark / Başarı Ölçütü
Coverage Target: 80%
Performance Target: <50ms redirect kararı (client-side, backend çağrısı hariç — guard salt AuthContext'in zaten bellekteki state'ine bakıyor, network beklemiyor)
Memory: belirtilmedi
Diğer ölçülebilir kriterler: yok

## Kapsam Dışı
- Rol-bazlı sayfa kısıtlaması (ör. "sadece ADMIN görebilir" route'ları) — henüz böyle bir sayfa yok, gerektiğinde ayrı bir görev.
- Logout butonu / UI'da çıkış eylemi — bu görev sadece guard + 401-otomatik-çıkışı kapsıyor, kullanıcının kendi isteğiyle çıkış yapabileceği bir buton ayrı bir görev (muhtemelen gerçek dashboard/header ile birlikte).
- Gerçek dashboard içeriği (request listesi, analytics kartları vb.) — Home.tsx'e sadece "Hoş geldin, {name}" seviyesinde bir güncelleme yapılacak, gerçek veri çekimi yok.
- Client-side JWT decode/expiry kontrolü veya otomatik token yenileme (refresh token) — proje zaten refresh-token altyapısını CLAUDE.md'de kapsam dışı bırakmış, token geçerliliği sadece backend'in 401 yanıtı üzerinden (AC5) anlaşılır.

## Etkilenen Dosyalar/Modüller (bilinen)
- `frontend/src/components/ProtectedRoute.tsx` (yeni) — `useAuth()`'a bakıp ya `children`/`<Outlet/>`'i render eden ya da `<Navigate to="/login" replace />` döndüren wrapper.
- `frontend/src/lib/api.ts` (değişecek) — `apiRequest`'e 401-interceptor eklenecek: bir `setUnauthorizedHandler(fn)` export'u ile dışarıdan (App.tsx'ten) bir callback kaydedilecek, `/api/auth/login`/`/api/auth/google` YOLLARI HARİÇ tutularak 401'de bu callback çağrılacak. (`api.ts`'in `AuthContext`'i doğrudan import etmesi circular-import riski taşıyor — callback-registration deseni bunu önlüyor, plan.md'de netleşecek.)
- `frontend/src/App.tsx` (değişecek) — `/` route'u `ProtectedRoute` ile sarmalanacak, `/login` için ters guard (zaten giriş yapmışsa `/`'e yönlendirme) eklenecek, `setUnauthorizedHandler`'ın `useAuth().logout` + `queryClient.clear()`'ı çağıran bir callback ile kaydedilmesi.
- `frontend/src/pages/Home.tsx` (değişecek) — `useAuth().user`'dan `name`/`role` gösterecek basit bir güncelleme.
- Migration YOK — bu bir frontend görevi, backend'e hiç dokunulmuyor.

## Rollback Beklentisi
Guard veya interceptor'da beklenmedik bir hata olursa fail-closed: kullanıcı içeri alınmaz, `/login`'e yönlendirilir (AC6). Bu bir UI görevi, backend transaction/DB rollback kavramı geçerli değil.

## Risks
- **401-interceptor'ın (AC5) gerçek bir canlı tetikleyicisi bu görev kapsamında henüz yok.** Home.tsx (bu görevde) hiçbir gerçek authenticated API çağrısı yapmıyor (sadece AuthContext'in zaten bellekteki state'ini okuyor), bu yüzden orkestratörün canlı Playwright doğrulamasında AC5'i gerçek bir 401 ile tetiklemenin doğal bir yolu yok. AC5'in davranışı bu görevde SADECE component-testlerle (mock edilmiş 401 fetch) kanıtlanacak; gerçek kullanım üzerinden canlı doğrulama, ilk gerçek authenticated veri-çekimi sayfası (ör. request listesi) geldiğinde ayrıca yapılacak. Bu, atdd.md'de bilinçli ve şeffaf bir sınırlama olarak kayıtlı — verify/red-team aşamalarında sahte bir "canlı doğrulandı" iddiası YAPILMAYACAK.
- `api.ts`/`AuthContext.tsx` arasında circular import riski (callback-registration deseniyle önleniyor, ama code-copilot'a açıkça belirtilmesi gerekiyor).

## Assumptions
- `ProtectedRoute`, react-router v7'nin `<Navigate replace />` desenini kullanacak (login-page'de zaten `useNavigate` kullanılıyor, tutarlı).
- `queryClient` instance'ı App.tsx'te zaten tanımlı (`const queryClient = new QueryClient()`) — yeni bir yerde tanımlanmayacak, aynı instance 401-handler'a geçirilecek.

## Unknowns
- Yok — 11 soru ile tüm kategoriler netleşti.

## Sorular ve Cevaplar (ham kayıt)
1. Kapsam (sadece guard+shell mi, rol-bazlı içerik mi) → Sadece guard + basit shell.
2. Login redirect (zaten giriş yapmışsa /login'e gidince ne olur) → `/`'e otomatik yönlendir.
3. 401 handling → Otomatik logout + /login'e yönlendir.
4. Route guard mimarisi → Ayrı bir `ProtectedRoute` wrapper component.
5. 401-interceptor mimarisi → api.ts'e merkezi bir interceptor.
6. Benchmark → %80 coverage + <50ms redirect gecikmesi.
7. Kapsam dışı → Rol-bazlı sayfa kısıtlaması + logout butonu + gerçek dashboard içeriği.
8. Test stratejisi → 60/30/10 (login-page ile tutarlı).
9. Onay sahibi → Otomatik testler + orkestratörün canlı Playwright doğrulaması.
10. TanStack Query cache temizliği → Evet, `queryClient.clear()`.
11. Rollback/hata durumu → Fail-closed (erişimi engelle).
