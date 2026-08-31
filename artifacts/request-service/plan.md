# Plan — request-service
_Reference: atdd.md_

## Files to Modify

| File | Why | Risk |
|------|-----|------|
| `backend/server.js` | Mount `/api/requests` behind `auth.middleware.js` (its first real usage — currently written but unmounted) | low |

## New Files

| File | Purpose |
|------|---------|
| `backend/routes/requests.routes.js` | `POST /`, `POST /:id/assign`, `PATCH /:id/status`, `PATCH /:id/priority` — mirrors `routes/auth.routes.js`'s thin `Router` pattern |
| `backend/controllers/requests.controller.js` | Thin controllers (try/catch → HTTP status), same shape as `controllers/auth.controller.js` |
| `backend/services/requests.service.js` | `createRequest`, `claimRequest`, `changeRequestStatus`, `changePriority` — all four DB-transaction-wrapped, state-machine/authorization logic, `pool.connect()` for transactions instead of the bare `pool.query()` `auth.service.js` uses (auth never needed multi-statement atomicity, this does) |

No new dependencies — `pg`'s `Pool.connect()` (transactions) is available on the existing `services/db.js` pool without any new package.

## Dependencies

- `backend/services/db.js` — existing shared `pool`, but used differently here: `const client = await pool.connect(); try { await client.query('BEGIN'); ...; await client.query('COMMIT'); } finally { client.release(); }` instead of `pool.query()` directly, since every one of the four functions writes to `requests` + `request_history` (+ `notifications`) atomically per atdd.md's Rollback Beklentisi.
- `backend/middleware/auth.middleware.js` — existing, unchanged, mounted for the first time to populate `req.user.{id,role,department_id}` for all four endpoints.
- `db/schema.sql` — `requests`, `request_types`, `request_history`, `notifications`, `departments`, `users` tables, all already exist with every column/constraint atdd.md's ACs rely on (verified by reading the live schema, not just atdd.md's description).

## Migration Required?
**No.** Every column, CHECK constraint, and index the 12 ACs need already exists in `db/schema.sql` (`requests.sla_due_at`, `requests`'s status/assigned_to CHECK, `request_history.action` CHECK including `PRIORITY_CHANGED`, `notifications.type` CHECK including `REQUEST_ASSIGNED`/`REQUEST_COMPLETED`/`REQUEST_REJECTED`). No `ALTER TABLE` needed.

## Risks
_(carried from atdd.md, plus what exploration found)_
- `pool.connect()`'ten alınan transaction `client`'ının her yolda (başarı, iş-kuralı hatası, DB hatası) `finally` içinde `release()` edilmesi kritik — atdd.md'de zaten flagged, code-copilot'un prompt'unda açıkça vurgulanacak.
- **YENİ (kritik, engelleyici) — DB'de sıfır veri var**: `departments`, `request_types`, `users` tabloları şu an tamamen boş (doğrulandı: `SELECT count(*)` üçü için de `0`). Bunun iki sonucu var:
  1. `createRequest`'i test etmek için en az bir `department` + bir `request_type` satırı gerekiyor — yoksa her `POST /api/requests` çağrısı AC11'in 404 yoluna düşer (yanlışlıkla "çalışıyor" gibi görünebilir ama aslında hiçbir happy-path hiç test edilmemiş olur).
  2. `claimRequest`/`changeRequestStatus`/`changePriority`'i test etmek için en az bir `DEPARTMENT_AUTHORITY` rolünde kullanıcı gerekiyor — ama self-registration'ın kilitli kuralı gereği (CLAUDE.md: rol her zaman `EMPLOYEE`) bu rol **hiçbir API çağrısıyla oluşturulamıyor**, sadece seed data veya (henüz yazılmamış) admin-only user-management ekranıyla oluşturulabilir.

  Bu, `code-copilot`/`test-copilot`'un integration testlerini VE sizin manuel Postman doğrulamanızı doğrudan engeller — bu görevin ATDD'sinde hiç bahsedilmemiş bir bağımlılık.

## Open Questions
1. ~~Seed script bu görevin bir parçası mı, yoksa ayrı bir ön-koşul task mı?~~ **Çözüldü.** `backend/seed.js` doğrudan (pipeline dışı, mekanik) yazıldı ve çalıştırıldı: 3 department (IT/HR/Finance), 4 request_type, 2 `DEPARTMENT_AUTHORITY` kullanıcı (`it.authority@opspulse.com`, `hr.authority@opspulse.com`, şifre `sifre1234`) — farklı departmanlarda, AC4'ün cross-department reddini test etmeye izin veriyor. İdempotent (`ON CONFLICT DO UPDATE`), tekrar çalıştırılabilir. `package.json`'a `"seed": "node seed.js"` eklendi.

No further open questions — ready for `code-copilot`.
