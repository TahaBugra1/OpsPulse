# Plan — login-page
_Reference: atdd.md_

## Files to Modify

| File | Why | Risk |
|------|-----|------|
| `frontend/src/App.tsx` | Yeni `/login` route eklenecek. Ayrıca `@react-oauth/google`'ın `GoogleOAuthProvider`'ı, `QueryClientProvider`'ın hemen içine (diğer provider'ların dışına, en dışta) eklenecek — `clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}`. | low |
| `frontend/vite.config.ts` | Vitest `test` config bloğu eklenecek (`environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.ts'`) — mevcut `plugins`/`resolve.alias` DEĞİŞMEYECEK, sadece yeni bir `test` anahtarı eklenecek. | low |
| `frontend/package.json` | Yeni bağımlılıklar (aşağıda tam liste) + yeni `"test": "vitest run"` script'i eklenecek. | low |

## New Files

| File | Purpose |
|------|---------|
| `frontend/src/pages/Login.tsx` | Form, validasyon, submit mantığı, Google buton entegrasyonu — atdd.md'nin AC1-11'ini karşılayan ana bileşen. |
| `frontend/src/lib/validation.ts` | zod şeması: `loginSchema = z.object({ email: z.string().email('Geçerli bir email adresi girin'), password: z.string().min(1, 'Şifre zorunlu') })`. |
| `frontend/src/test/setup.ts` | `import '@testing-library/jest-dom'` — Vitest'in `setupFiles`'ı için, tüm test dosyalarında `toBeInTheDocument()` gibi matcher'ları etkinleştirir. Bu, code-copilot'un kurması gereken bir ALTYAPI dosyası (test-copilot'un yazacağı `Login.test.tsx`'in çalışabilmesi için önkoşul) — test-copilot'un kendisi bu dosyayı DEĞİL, sadece `Login.test.tsx`'i yazacak. |
| `frontend/src/components/ui/form.tsx` | shadcn CLI ile eklenecek (`npx shadcn add form`) — `react-hook-form` ile entegre `Form`/`FormField`/`FormItem`/`FormLabel`/`FormControl`/`FormMessage` bileşenleri. |
| `frontend/src/components/ui/checkbox.tsx` | shadcn CLI ile eklenecek (`npx shadcn add checkbox`) — "Beni hatırla" için. |

## Dependencies

### Yeni npm bağımlılıkları (tam liste, versiyon aralığı code-copilot'un takdirine bırakılıyor — mevcut `package.json`'daki gibi `^` ile güncel majör)
**Runtime (`dependencies`)**: `react-hook-form`, `zod`, `@hookform/resolvers`, `@react-oauth/google`
**Dev (`devDependencies`)**: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`

### Backend'in tam response/error şekli (code-copilot'un tahmin etmemesi için burada netleştiriliyor)
- Başarılı `POST /api/auth/login` / `POST /api/auth/google` → `200 {token: string, user: {id, name, surname, email, role, department_id}}`.
- Hata (400/401/403/409/500) → `{status: 'error', message: string}` — `frontend/src/lib/api.ts`'in mevcut `ApiError` sınıfı zaten bunu `err.message`'a çeviriyor, `Login.tsx` sadece `err.message`'ı gösterecek.
- **[Kritik keşif]** `POST /api/auth/login`'in rate limiter'ı (`loginLimiter`, `backend/routes/auth.routes.js`) `express-rate-limit`'in VARSAYILAN 429 davranışını kullanıyor — proje bunu ÖZELLEŞTİRMEMİŞ (`message` opsiyonu geçilmemiş). Yani 429 yanıtı, diğer hatalar gibi `{status:'error', message:'...'}` JSON şeklinde OLMAYABİLİR (düz metin veya farklı bir JSON şekli olabilir, `express-rate-limit`'in sürümüne bağlı). `frontend/src/lib/api.ts`'in mevcut `apiRequest`'i zaten bunun için hazır (`isJson` kontrolü, JSON değilse `data: null`, mesaj `İstek başarısız oldu (429)`'a düşer) — ama bu generic mesaj kullanıcıya "neden başarısız olduğunu" (rate limit'e takıldığını) anlatmıyor. **`Login.tsx`, `err.status === 429` durumunu ÖZEL OLARAK ele almalı**, backend'in ham mesajına güvenmek yerine kendi net Türkçe mesajını göstermeli (ör. "Çok fazla deneme yaptınız, lütfen bir süre sonra tekrar deneyin").
- Google akışı için: `@react-oauth/google`'ın `<GoogleLogin onSuccess={(credentialResponse) => ...}>`'inin `credentialResponse.credential` alanı, backend'in beklediği `id_token` string'idir — doğrudan `apiPost('/api/auth/google', {id_token: credentialResponse.credential, rememberMe})` olarak gönderilecek.

### Mevcut altyapı (değiştirilmeyecek, reuse edilecek)
- `frontend/src/lib/api.ts`'in `apiPost` helper'ı — hem `/api/auth/login` hem `/api/auth/google` çağrıları için doğrudan kullanılacak, yeni bir HTTP client kodu YAZILMAYACAK.
- `frontend/src/context/AuthContext.tsx`'in `useAuth().login(token, user, rememberMe)`'i — `Login.tsx` başarılı yanıttan sonra bunu çağıracak, storage mantığına (AC9/10) hiç dokunmayacak (zaten doğru çalışıyor, `authStorage.ts`'te).
- `frontend/src/components/ui/{button,card,input,label}.tsx` — mevcutlar reuse edilecek, sadece `form.tsx`/`checkbox.tsx` yeni eklenecek.

## Migration Required?
**Hayır.** Backend'e hiç dokunulmuyor.

## Risks
_(atdd.md'den taşınan + keşifte netleşenler)_
- **[Kritik, code-copilot'a açıkça belirtilecek]** 429 yanıtının JSON şekli garanti değil — yukarıda detaylandırıldı, `Login.tsx`'in `err.status` bazlı özel bir dal içermesi gerekiyor, ham `err.message`'a güvenilmemeli.
- `VITE_GOOGLE_CLIENT_ID` gerçek bir değer olmadan (sadece `.env.example`'daki placeholder) Google butonu render olur ama gerçek Google consent akışı tamamlanamaz — atdd.md'nin zaten kabul ettiği bir sınırlama, Playwright canlı doğrulaması Google akışının KENDİSİNİ değil, buton render'ını ve email/şifre akışının tamamını kanıtlayacak.
- `GoogleOAuthProvider`'ın `clientId` prop'u boşsa (env hiç set edilmemişse) kütüphane bir console warning/error basabilir — bu, sayfayı çökertmemeli, sadece Google butonunun işlevsiz kalmasına yol açmalı; code-copilot bunun uygulamayı crash ettirmediğini doğrulamalı.

## Open Questions
Yok — mimari netleşti (bağımlılık listesi, response şekilleri, 429'un özel durumu dahil), code-copilot'a hazır.
