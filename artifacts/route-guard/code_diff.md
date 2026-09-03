# Code Diff — route-guard
_Reference: atdd.md, plan.md_

## Files Created
- `frontend/src/components/ProtectedRoute.tsx` — `ProtectedRoute` (AC1/2) ve `GuestOnlyRoute` (AC3), plan.md'nin talimatıyla tek dosyada iki simetrik component.

## Files Modified
- `frontend/src/lib/api.ts` — `unauthorizedHandler` modül-seviyesi state + `setUnauthorizedHandler` export'u eklendi; `apiRequest`'in mevcut `if (!response.ok)` bloğunun BAŞINA, `throw`'dan önce, 401 + login/google hariç kontrolü eklendi (AC4/5). `ApiError`/`apiGet`/`apiPost`/`apiPatch` davranışı ve `throw` sözleşmesi byte-for-byte korunmuş — kod okunarak doğrulandı.
- `frontend/src/App.tsx` — `AuthWiring` bileşeni eklendi (`useEffect` ile `setUnauthorizedHandler` kaydı/temizliği, `[logout]` dependency), `/` route'u `ProtectedRoute` ile, `/login` route'u `GuestOnlyRoute` ile sarmalandı, `*` (NotFound) sarmalanmadan bırakıldı. `QueryClientProvider`/`GoogleOAuthProvider`/`AuthProvider`/`Toaster` yapısı değişmedi.
- `frontend/src/pages/Home.tsx` — "Yapım aşamasında" placeholder'ı kaldırıldı, `useAuth().user`'dan "Hoş geldin, {name} ({role})" gösteren bir satıra dönüştü; `user` null ise (savunmacı, çökmeyen) "Hoş geldin" fallback'i var.

**Değiştirilmeyenler (kod okunarak doğrulandı)**: `AuthContext.tsx`, `authStorage.ts`, `Login.tsx`, `Login.test.tsx` — hiçbiri dokunulmamış, mevcut 12 login-page testi hâlâ değişmeden geçiyor (App.tsx'e bağlı değiller, kendi izole `MemoryRouter`/`AuthProvider` kullanıyorlar).

## Acceptance Criteria Coverage (kod okunarak + build/mevcut testler bağımsız olarak doğrulandı)

| AC | Status | Nasıl doğrulandı |
|----|--------|-------------------|
| 1 — girişsiz `/` erişimi → `/login`'e yönlendirme | ✅ | `ProtectedRoute`: `!user` → `<Navigate to="/login" replace/>` |
| 2 — girişli `/` erişimi → basit shell | ✅ | `Home.tsx`: "Hoş geldin, {name} ({role})" |
| 3 — girişli kullanıcı `/login`'e giderse → `/`'e yönlendirme | ✅ | `GuestOnlyRoute`: `user` → `<Navigate to="/" replace/>` |
| 4 — login/google 401'i interceptor'ı tetiklemez | ✅ | `api.ts`: `path !== '/api/auth/login' && path !== '/api/auth/google'` kontrolü, `unauthorizedHandler` bu path'lerde hiç çağrılmıyor |
| 5 — diğer 401'ler → logout+cache-clear+redirect | ✅ | `AuthWiring`'in handler'ı `logout()`+`queryClient.clear()` çağırıyor; `user` null olunca `ProtectedRoute` bir sonraki render'da otomatik yönlendiriyor (explicit `navigate()` gerekmiyor, context re-render zaten tetikliyor) |
| 6 — beklenmedik hatada fail-closed | ✅ | Guard mantığı zaten "user yoksa engelle" — try/catch eklenmemiş, CAVEMAN'a uygun, "by construction" doğru |
| 7 — süresi dolmuş token ilk render'da kabul edilir (bilinçli sınırlama) | ✅ | Hiçbir JWT decode/expiry kontrolü eklenmemiş, sadece AC5'in 401 akışına güveniliyor |
| 8 — logout her yoldan query cache'i temizler | ✅ | Tek `unauthorizedHandler` içinde `logout()`+`queryClient.clear()` birlikte çağrılıyor |

8/8 AC, kapsam dışı hiçbir şey eklenmemiş (rol-bazlı kısıtlama, logout butonu, gerçek dashboard içeriği, JWT decode — hiçbiri yok).

**Ayrıca doğrulandı**: `npm run build` (`tsc -b && vite build`) orkestratör tarafından bağımsız olarak tekrar çalıştırıldı — 0 TypeScript hatası, `✓ built in 581ms`. `npm run test` — mevcut 12 login-page testi hâlâ `12 passed (12)`.

## Remaining Limitations
- AC5'in (401-interceptor → logout+redirect) gerçek bir canlı tetikleyicisi bu görevde yok — `Home.tsx` hiçbir authenticated API çağrısı yapmıyor. atdd.md'nin Risks bölümünde zaten kayıtlı; canlı Playwright doğrulaması AC1/2/3'ü kapsayacak, AC5 sadece test-copilot'un yazacağı component-testle (mock 401) kanıtlanacak.
- Tek global `unauthorizedHandler` — "son kaydedilen kazanır" modeli, ama `AuthWiring` her zaman tam olarak bir kez mount olduğu için (App.tsx'te tek instance) bu bir sorun değil.

## Assumptions
- `AuthUser.name` (surname değil) gösterim alanı olarak seçildi — interface'te zaten var, en doğal seçim.
- `AuthWiring`'in redirect'i explicit bir `navigate()` çağrısı yerine `ProtectedRoute`'un `user` state'ini yeniden değerlendirmesine bırakılması — plan.md'nin tarif ettiği kablolamayla birebir uyumlu, ekstra bir navigasyon mekanizması gerektirmiyor.

## CAVEMAN Review
- **Files added**: 1 (`ProtectedRoute.tsx`) — plan.md'nin açık talimatıyla iki component tek dosyada, ikinci bir dosya gereksiz.
- **New abstractions**: yok.
- **New helper functions**: yok.
- **New public APIs**: `setUnauthorizedHandler` — `api.ts`'in (düz modül, hook kullanamaz) `AuthContext`'in gerçek `logout` referansına ulaşmasının tek yolu, plan.md'de gerekçelendirilmiş.
- **Complexity justification**: `AuthWiring` sadece `useEffect` yan etkisi için var, `null` render ediyor — plan.md'nin tarif ettiği minimal tasarım birebir uygulanmış, spekülatif bir try/catch veya ekstra state eklenmemiş.
