# Plan — request-read
_Reference: atdd.md_

## Files to Modify

| File | Why | Risk |
|------|-----|------|
| `backend/services/requests.service.js` | Add `listRequests(query, user)` and `getRequestById(id, user)` — role-based scoping, `?status=` filter, join'lenmiş alanlar, `is_overdue` hesaplaması | medium (rol-bazlı dinamik WHERE koşulu, parametrize sorgu ile inşa edilmeli — SQL injection riskine dikkat) |
| `backend/controllers/requests.controller.js` | Add `getRequests`, `getRequestById` — mevcut thin-controller deseniyle | low |
| `backend/routes/requests.routes.js` | Add `router.get('/', getRequests)` ve `router.get('/:id', getRequestById)` | low |

## New Files
Yok — üçü de mevcut dosyalara ekleme.

## Dependencies
- `backend/services/db.js` — mevcut `pool`, sadece `pool.query()` (transaction gerekmiyor, salt okunur).
- `db/schema.sql` — `requests` (ana tablo) + `request_types.name`, `departments.name`, `users.name`/`users.surname` (created_by ve assigned_to için ayrı ayrı JOIN — assigned_to nullable olduğu için `LEFT JOIN`).
- `backend/middleware/auth.middleware.js` — zaten `/api/requests`'in tamamını koruyor (`server.js`'de mount edilmiş), yeni route'lar için ek bir değişiklik gerekmiyor.

## Migration Required?
**Hayır.** Sadece SELECT + JOIN, hiçbir yeni kolon/tablo gerekmiyor.

## Risks
_(atdd.md'den taşınan + keşifte bulunanlar)_
- Rol-bazlı dinamik WHERE koşulu (`created_by=$1` / `department_id=$1` / filtre yok) inşa edilirken, `?status=` filtresi de eklenince sorgu string'i şartlı olarak birleştirilecek — her koşulda hâlâ parametrize ($1, $2...) kalmalı, asla string concatenation ile status değeri sorguya gömülmemeli.
- `assigned_to_name` hesaplaması `LEFT JOIN` gerektiriyor (assigned_to NULL olabilir) — `created_by_name` için ise `INNER JOIN` yeterli (created_by her zaman NOT NULL).
- `is_overdue`, DB'nin kendi `now()`'ını kullanmalı (`sla_due_at < now()`), uygulama kodunda `new Date()` ile karşılaştırma YAPILMAMALI — atdd.md'nin Assumptions'ında zaten belirtilmiş, code-copilot'a açıkça hatırlatılacak.

## Open Questions
1. ~~`?status=` geçersiz değer verilirse ne olmalı?~~ **Çözüldü.** 400 dönecek — request-service görevindeki `changePriority`/`createRequest`'in geçersiz `priority` değerini reddetme deseniyle tutarlı.

No further open questions — ready for `code-copilot`.
