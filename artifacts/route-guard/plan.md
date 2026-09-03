# Plan — route-guard
_Reference: atdd.md_

## Files to Modify

| File | Why | Risk |
|------|-----|------|
| `frontend/src/App.tsx` | `/` route'u `ProtectedRoute` ile sarmalanacak; `/login` route'u `GuestOnlyRoute` ile sarmalanacak (AC3); `queryClient`'ı ve `useAuth().logout`'u kullanan bir `AuthWiring` bileşeni eklenip `setUnauthorizedHandler` ile kaydedilecek (AC5). | medium |
| `frontend/src/lib/api.ts` | `apiRequest`'e 401-interceptor eklenecek: `setUnauthorizedHandler(fn)` export'u + `/api/auth/login`/`/api/auth/google` yollarını hariç tutan bir kontrol (AC4/AC5). Mevcut `ApiError`/`apiGet`/`apiPost`/`apiPatch` davranışı DEĞİŞMEYECEK — sadece 401 durumunda ek bir yan etki (`unauthorizedHandler?.()`) eklenecek, `throw`'un kendisi aynı kalacak. | medium |
| `frontend/src/pages/Home.tsx` | `useAuth().user`'dan `name`/`role` gösterecek şekilde güncellenecek (AC2) — "Yapım aşamasında" placeholder metni, "Hoş geldin, {name}" seviyesinde bir shell'e dönüşecek. Gerçek dashboard içeriği EKLENMEYECEK (Kapsam Dışı). | low |

## New Files

| File | Purpose |
|------|---------|
| `frontend/src/components/ProtectedRoute.tsx` | İki export: `ProtectedRoute` (AC1/AC2 — `user` yoksa `/login`'e `<Navigate replace/>`, varsa `<Outlet/>`) ve `GuestOnlyRoute` (AC3 — `user` VARSA `/`'e `<Navigate replace/>`, yoksa `<Outlet/>`). Tek dosyada iki küçük, simetrik component — ayrı dosyalara bölmek gereksiz (CAVEMAN: fewest files). |

## Dependencies

### Mevcut altyapı (değiştirilmeyecek, reuse edilecek)
- `frontend/src/context/AuthContext.tsx`'in `useAuth()`'u — hem `ProtectedRoute`/`GuestOnlyRoute` hem `AuthWiring` bunu kullanacak, `AuthContext.tsx`'in kendisi DEĞİŞMEYECEK (zaten `logout()` var).
- `frontend/src/lib/authStorage.ts` — hiç dokunulmuyor.
- `App.tsx`'teki mevcut `const queryClient = new QueryClient()` instance'ı — `AuthWiring`'in `queryClient.clear()` çağrısı için aynı instance'a (modül kapsamındaki closure üzerinden) erişecek, yeni bir instance oluşturulmayacak.

### Mimari not (code-copilot'a açıkça belirtilecek — atdd.md'nin "circular import" varsayımını düzeltiyor)
atdd.md'nin Risks bölümü bunu "circular import riski" olarak adlandırmıştı — daha kesin ifadeyle: `api.ts` bir React component/hook DEĞİL, düz bir modül; `AuthContext.tsx`'in `logout` fonksiyonu ise `useMemo` ile her render'da yeniden oluşan, component state'ine bağlı bir closure. `api.ts`'in `AuthContext`'i import edip `useAuth()` çağırması mümkün değil (hook kuralları), bu yüzden **callback-registration deseni zorunlu** (gerçek bir import-cycle olmasa da): `App.tsx` içindeki bir component (`AuthWiring`), `useAuth()` ile gerçek `logout`'a erişip bunu `setUnauthorizedHandler`'a kaydeder; `api.ts` bu kaydedilmiş referansı çağırır, `AuthContext`'i hiç import etmez.

`AuthWiring` component'i `AuthProvider`'ın İÇİNDE render edilmeli (useAuth için) ama görsel bir şey render etmiyor (`return null`), `useEffect` içinde `setUnauthorizedHandler(() => { logout(); queryClient.clear() })` kaydedip cleanup'ta `setUnauthorizedHandler(null)` yapmalı.

### 401-interceptor'ın tam konumu (`api.ts` içinde, mevcut kod referanslı)
Mevcut `apiRequest`'in `if (!response.ok) { ... throw new ApiError(...) }` bloğunun HEMEN BAŞINA, `throw`'dan ÖNCE eklenmeli:
```ts
if (!response.ok) {
  if (response.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/google') {
    unauthorizedHandler?.()
  }
  const message = /* değişmeyen mevcut mantık */
  throw new ApiError(response.status, data, message)
}
```
`throw` hâlâ HER ZAMAN gerçekleşmeli (interceptor sadece bir yan etki, `ApiError` fırlatma davranışını DEĞİŞTİRMEZ) — `Login.tsx`'in kendi `handleFailure`'ı zaten bu `ApiError`'ı yakalayıp inline hata gösteriyor (login-page görevinde tamamlandı), bu görev onu bozmuyor.

## Migration Required?
**Hayır.** Backend'e hiç dokunulmuyor.

## Risks
_(atdd.md'den taşınan + keşifte netleşenler)_
- **[atdd.md'den, aynen geçerli]** AC5'in (401-interceptor) gerçek bir canlı tetikleyicisi bu görevde yok — Home.tsx hiçbir gerçek authenticated API çağrısı yapmıyor. Canlı Playwright doğrulaması AC1/2/3'ü kapsayacak, AC5 sadece component-testle kanıtlanacak; bu code_diff.md/verify_report.md'de açıkça böyle raporlanmalı, "canlı doğrulandı" diye YAZILMAMALI.
- **[code-copilot'a açıkça belirtilecek]** `AuthWiring`'in `useEffect` dependency array'i sadece `[logout]` (veya `[]`, çünkü `logout` referansı `user`/`token` değiştikçe `AuthContext`'in `useMemo`'su tarafından yeniden oluşuyor) olmalı — `queryClient` modül-seviyesinde sabit olduğu için dependency'e eklenmesine gerek yok, gereksiz re-run'lara yol açar.
- **[düşük risk]** `ProtectedRoute`/`GuestOnlyRoute`'un `useAuth()` çağırabilmesi için `AuthProvider`'ın İÇİNDE render edilmesi ZORUNLU — `App.tsx`'te route ağacının `AuthProvider`'ın dışına taşınmaması gerekiyor (mevcut yapı zaten `AuthProvider` > `BrowserRouter` > `Routes` sıralamasında, bu doğru, sadece korunmalı).

## Open Questions
Yok — mimari netleşti (interceptor'ın tam konumu, AuthWiring deseni, dosya sayısı dahil), code-copilot'a hazır.
