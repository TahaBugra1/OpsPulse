# Plan — analytics-2a
_Reference: atdd.md_

## Files to Modify

| File | Why | Risk |
|------|-----|------|
| `backend/server.js` | Mount `/api/analytics` behind `authMiddleware` (import zaten var, sadece yeni route eklenecek) | low |

## New Files

| File | Purpose |
|------|---------|
| `backend/services/analytics.service.js` | `getSummary(user)`, `getSla(user)`, `getWorkload(user)` — rol-bazlı scope, SLA hesaplaması (`request_history`'den), workload (LEFT JOIN departments→requests, boş departmanlar dahil) |
| `backend/controllers/analytics.controller.js` | Thin controllers, mevcut desenle (`fail()` → `err.status\|\|500`) |
| `backend/routes/analytics.routes.js` | `GET /summary`, `GET /sla`, `GET /workload` |

## Dependencies
- `backend/services/db.js` — mevcut `pool`, sadece `pool.query()` (salt okunur, transaction gerekmiyor).
- **Yeni dosyanın kendi lokal `fail()` helper'ı** — `auth.service.js` ve `requests.service.js`'in ikisi de bu helper'ı kendi dosyalarında ayrı ayrı tanımlıyor (paylaşılan bir utils modülü yok, proje konvansiyonu). `analytics.service.js` de aynı şekilde kendi `fail()`'ini tanımlayacak.
- `db/schema.sql`'deki `requests`, `request_history`, `departments` tabloları — migration gerekmiyor.
- `backend/middleware/auth.middleware.js` — zaten `/api/requests`'i koruyor, aynı middleware `/api/analytics`'e de uygulanacak.

## Migration Required?
**Hayır.** Sadece SELECT/aggregate sorgular, hiçbir yeni kolon/tablo gerekmiyor.

## Risks
_(atdd.md'den taşınan + keşifte netleşenler)_
- SLA sorgusu `request_history`'de doğru `STATUS_CHANGED`+`COMPLETED` satırını (en sonuncusunu, `ORDER BY created_at DESC LIMIT 1` mantığıyla, talep başına) bulmalı — bir talebin birden fazla `STATUS_CHANGED` satırı olabilir (örn. `ASSIGNED`→`IN_PROGRESS`→`COMPLETED`), sadece en son `COMPLETED`'e giden satır kullanılmalı.
- Workload sorgusu `departments` tablosundan `LEFT JOIN requests` ile başlamalı (departman merkezli), `requests`'ten başlayıp departmanlara join yapmamalı — aksi halde boş departmanlar (kullanıcının onayladığı "hepsi görünsün" kararı) listeden düşer.

## Open Questions
1. ~~Boş departman workload'da görünsün mü?~~ **Çözüldü.** Evet, tüm departmanlar sıfırlarla görünecek (LEFT JOIN).

No further open questions — ready for `code-copilot`.
