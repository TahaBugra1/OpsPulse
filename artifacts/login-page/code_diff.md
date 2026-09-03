# Code Diff — login-page
_Reference: atdd.md, plan.md_

## Files Created
- `frontend/src/pages/Login.tsx` — ana Login bileşeni (form + Google buton + hata yönetimi).
- `frontend/src/lib/validation.ts` — zod `loginSchema` (email format + boş şifre kontrolü, plan.md'nin verdiği kodla birebir aynı).
- `frontend/src/test/setup.ts` — Vitest `setupFiles` hedefi, tek satır (`import '@testing-library/jest-dom'`).
- `frontend/src/components/ui/checkbox.tsx` — shadcn CLI ile eklendi.
- `frontend/src/components/ui/field.tsx` + `frontend/src/components/ui/separator.tsx` — shadcn CLI ile eklendi, **`form.tsx` yerine** (aşağıda "Sapmalar" bölümünde açıklanıyor).

## Files Modified
- `frontend/src/App.tsx` — `GoogleOAuthProvider` (`QueryClientProvider`'ın içine, `AuthProvider`'ı sarmalıyor) + `/login` route'u eklendi. `/` ve `*` route'ları değişmedi.
- `frontend/vite.config.ts` — `test: {environment:'jsdom', globals:true, setupFiles:'./src/test/setup.ts'}` eklendi. `defineConfig` import'u `'vite'`'ten `'vitest/config'`'e değişti (bkz. Sapmalar). `plugins`/`resolve.alias` değişmedi.
- `frontend/package.json` — yeni bağımlılıklar (`react-hook-form`, `zod`, `@hookform/resolvers`, `@react-oauth/google` / dev: `vitest`, `@testing-library/*`, `jsdom`) + `"test": "vitest run"` script'i. `shadcn` hâlâ doğru şekilde `devDependencies`'de (önceki red-team fix'i korunmuş).
- `frontend/package-lock.json` — `npm install` ile otomatik güncellendi.

**Değiştirilmeyenler (kod okunarak doğrulandı)**: `AuthContext.tsx`, `authStorage.ts`, `api.ts`, `socket.ts`, `Home.tsx`, `NotFound.tsx`, mevcut 8 shadcn bileşeni — hepsi byte-for-byte aynı.

## Sapmalar (subagent'ın raporladığı, orkestratörün doğruladığı)

1. **`form.tsx` yerine `field.tsx`/`separator.tsx`**: Bu projenin shadcn stili (`nova` preset, `@base-ui/react` primitives — Radix değil) için klasik `FormProvider`-tabanlı `form.tsx` bileşeni CLI registry'sinde mevcut değil (`npx shadcn add form` "No files" döndürüyor). Bunun yerine bu stilin kendi güncel deseni olan `Field`/`FieldLabel`/`FieldError`/`FieldGroup` bileşenleri CLI ile eklenmiş ve `react-hook-form`'un `Controller`'ıyla manuel olarak entegre edilmiş (shadcn'in kendi `field-example.tsx` deseniyle tutarlı). Bu CLI-kaynaklı bir zorunluluk, subagent'ın kendi tercihi değil — kabul edilebilir.
2. **`vitest@^2.1.8` yerine `vitest@^4.1.11`**: plan.md'nin varsaymadığı bir versiyon uyumsuzluğu keşfedildi — `vitest@2.x`, bu projenin `vite@^8.2.2`'siyle peer-dependency çakışması yaratıp `tsc` build'ini bozuyordu. `vitest@^4.1.11` (peer aralığı `^6||^7||^8`) sorunu çözdü. `vite.config.ts`'in `defineConfig` import'unun `'vitest/config'`'e değişmesi bunun doğal bir sonucu (Vitest'in `test` alanının tip tanımını taşımak için).

## Acceptance Criteria Coverage (kod okunarak + npm install/build ile doğrulandı)

| AC | Status | Nasıl doğrulandı |
|----|--------|-------------------|
| 1 — geçerli giriş → login+yönlendirme | ✅ | Kod: `onSubmit` → `apiPost` → `auth.login` → `navigate('/')` |
| 2 — 401 → inline hata, yönlendirme yok | ✅ | Kod: `handleFailure`, `ApiError` dalı, `err.message` gösteriliyor |
| 3 — 429 → özel Türkçe mesaj | ✅ | Kod: `err.status === 429` özel olarak kontrol ediliyor, ham mesaja güvenilmiyor |
| 4 — Google başarılı → aynı akış | ✅ | Kod: `handleGoogleSuccess`, `credentialResponse.credential` → `id_token` |
| 5 — Google backend reddi → inline hata | ✅ | Kod: aynı `handleFailure` reuse ediliyor |
| 6 — ağ hatası → genel mesaj, çökme yok | ✅ | Kod: `ApiError` olmayan durum için genel mesaj, try/catch çökmeyi engelliyor |
| 7/8 — boş/geçersiz email → client-side engelleme | ✅ | Kod: `zodResolver(loginSchema)`, react-hook-form network çağrısı yapmadan engelliyor |
| 9/10 — rememberMe → doğru storage | ✅ | Kod: `rememberMe` state'i doğrudan `auth.login`'e geçiyor, `authStorage`'a hiç dokunulmamış |
| 11 — in-flight sırasında submit devre dışı | ✅ | Kod: `loading` state, input/button'ları `disabled` yapıyor |

**Ayrıca doğrulandı**: `npm install` (0 vulnerabilities) + `npm run build` (`tsc -b && vite build`, 0 tip hatası) orkestratör tarafından bağımsız olarak tekrar çalıştırıldı, ikisi de temiz.

## Remaining Limitations
- `GoogleLogin` butonu, `@react-oauth/google` kütüphanesinin kendisinde `loading` durumunda devre dışı bırakılabilecek dokümante bir prop sunmuyor — düşük risk (Google'ın kendi popup'ı zaten hızlı ardışık gönderimi engelliyor), atdd.md'nin AC11'i esas olarak form submit yolunu kapsıyor.
- Route guard yok (kapsam dışı, doğru).

## Assumptions
- `VITE_GOOGLE_CLIENT_ID`, `.env.example`'da zaten var, `api.ts`'in `VITE_API_URL` deseniyle tutarlı kullanılıyor.
- Backend'in `/api/auth/login`/`/api/auth/google`'ı `{token, user}` döndürüyor, `AuthUser` tipiyle eşleşiyor.

## CAVEMAN Review
- **Files added**: 5 — hepsi ya doğrudan gerekli (`Login.tsx`, `validation.ts`, `test/setup.ts`) ya da CLI-zorunlu (`field.tsx`, `separator.tsx`'in kendi hard dependency'si).
- **New abstractions**: `handleFailure` — email/şifre VE Google yollarında birebir aynı hata işleme mantığının tekrarını önlüyor (2 kullanım yeri, meşru — CAVEMAN'ın "duplication over premature abstraction" ilkesi ihlal edilmiyor çünkü bu erken değil, gerçek bir tekrar noktası).
- **New helper functions**: yukarıdaki + 0 başka.
- **New public APIs**: `Login` bileşeni (default export) — AC'nin doğrudan gerektirdiği.
- **Complexity justification**: Redux/Zustand gibi ek state yönetimi eklenmedi, sadece `useState` + `react-hook-form` + mevcut `useAuth()` — plan.md'nin öngördüğü minimal tasarım korunmuş.
