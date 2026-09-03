# Code Diff (hafif) — frontend-scaffold
_Kılavuzun önerdiği kısayol: gerçek code_diff.md yerine git status + dosya listesi + orkestratörün kendi okuduğu kritik dosyalar._

## Yeni dosyalar (git status --short frontend/)
```
D  frontend/.gitkeep          (silindi, gerçek dosyalarla değişti)
?? frontend/.env.example
?? frontend/.gitignore
?? frontend/.oxlintrc.json
?? frontend/README.md
?? frontend/components.json    (shadcn/ui config)
?? frontend/index.html
?? frontend/package-lock.json
?? frontend/package.json
?? frontend/public/
?? frontend/src/
?? frontend/tsconfig.app.json
?? frontend/tsconfig.json
?? frontend/tsconfig.node.json
?? frontend/vite.config.ts
```

## src/ yapısı
```
src/App.tsx                        — QueryClientProvider → AuthProvider → BrowserRouter, / ve * route'ları
src/main.tsx                       — Vite entry
src/index.css                      — Tailwind v4 + shadcn tema
src/pages/Home.tsx                 — Türkçe placeholder sayfa
src/pages/NotFound.tsx             — Türkçe 404
src/context/AuthContext.tsx        — useAuth() hook, login()/logout(), API çağrısı YOK
src/lib/authStorage.ts             — sessionStorage/localStorage split (tek gerçek kaynak)
src/lib/api.ts                     — fetch wrapper, Bearer token otomatik ekleniyor
src/lib/socket.ts                  — Socket.io client, JWT handshake auth field'ında
src/lib/utils.ts                   — shadcn'ın kendi cn() helper'ı
src/components/ui/*.tsx            — 8 shadcn bileşeni (button/card/input/label/badge/table/dialog/sonner)
```

## Orkestratörün bağımsız olarak okuyup doğruladığı kritik dosyalar
- `src/lib/authStorage.ts` — `getStoredToken`/`getStoredUser` sessionStorage'ı önceliklendiriyor, `setStoredSession` doğru storage'a yazıp diğerini temizliyor (**doğru** — atdd.md'nin locked convention'ıyla birebir uyumlu).
- `src/lib/api.ts` — `Authorization: Bearer <token>` otomatik ekleniyor, endpoint-özel fonksiyon yok (kapsam dışı bırakılmış, doğru).
- `src/lib/socket.ts` — JWT `auth: {token}` handshake field'ında (header değil) — backend'in `sockets/index.js`'inin beklediği format ile **birebir uyumlu**.
- `src/context/AuthContext.tsx` — `login()` sadece state/storage günceller, hiçbir API çağrısı yok (kapsam dışı bırakılmış, doğru).
- `src/App.tsx` — provider sıralaması ve route yapısı istenildiği gibi.

## Bağımsız doğrulama (orkestratör tarafından, subagent'ın raporuna güvenilmeden tekrar çalıştırıldı)
- `npm install` → 0 vulnerabilities, hatasız.
- `npm run build` → `tsc -b && vite build` temiz, 0 tip hatası, `dist/assets/index-MhjaMZTr.css` 37.55 kB (Tailwind gerçekten üretim yapıyor, boş değil).
