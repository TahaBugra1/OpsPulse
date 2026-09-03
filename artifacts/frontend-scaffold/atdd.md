---
task_slug: frontend-scaffold
priority: low
note: "Kılavuzun (docs/atdd_pipeline_usage_guide.md) 'iskelet aşaması → direkt kod' kuralına göre tam ATDD zincirinden geçmedi. Bu, kılavuzun kendi önerdiği hafif kısayol belgesi (kaba atdd.md + git status/build çıktısı + standalone /red-team)."
---

# ATDD (hafif) — frontend-scaffold

## Hedef
`frontend/` boş bir klasördü (sadece `.gitkeep`) — bunu çalışan bir Vite + React + TypeScript projesine dönüştürmek. Hiçbir gerçek özellik (login, dashboard) yok — sadece: tooling, routing iskeleti, API/socket client altyapısı, auth context (token/user state yönetimi, gerçek login API çağrısı YOK).

## Kararlar (kullanıcı onaylı)
- React + TypeScript
- Tailwind CSS + shadcn/ui
- TanStack Query (provider kurulumu, henüz gerçek query/mutation yok)
- react-router-dom, tek gerçek route (`/`, placeholder) + 404
- UI dili: Türkçe (backend'in hata mesajlarıyla tutarlı)
- Auth token saklama: `rememberMe` true → `localStorage` (7g), false → `sessionStorage` (1s) — backend'in JWT süresi kararıyla birebir tutarlı, locked convention

## Kapsam Dışı (bu görevde)
- Login/Register/Google Sign-In UI'ı ve API çağrıları
- Dashboard/gerçek sayfa içeriği
- Socket.io event listener'ları (sadece bağlantı kurma altyapısı var)
- Redux/Zustand gibi ek state yönetimi

## Kabul Kriteri
- `npm install` hatasız.
- `npm run build` hatasız (TypeScript tip hatası yok).
- Tailwind gerçekten çalışıyor (üretilen CSS boş değil).
- Auth storage kuralı (sessionStorage/localStorage split) doğru uygulanmış.
- Tüm kullanıcıya görünen metin Türkçe.
