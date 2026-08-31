# Code Diff — request-comments
_Reference: atdd.md, plan.md_

## Files Created
Yok — üçü de mevcut dosyalara ek.

## Files Modified
- `backend/services/requests.service.js` — `addComment`, `listComments` eklendi. **`getRequestById` yeniden implement edilmedi, doğrudan reuse edildi** (plan.md'nin önerdiği gibi). Mevcut 6 fonksiyona tek satır dokunulmadı — diff ile doğrulandı (62 satır ekleme, 0 silme).
- `backend/controllers/requests.controller.js` — `postAddComment`, `getComments` eklendi.
- `backend/routes/requests.routes.js` — `POST /:id/comments`, `GET /:id/comments` eklendi.

## Acceptance Criteria Coverage (independently verified — live end-to-end testing against the real DB)

| AC | Status | How verified |
|----|--------|--------------|
| 1 — yorum yazma yetkisi (`getRequestById` reuse) | ✅ | Kod incelemesi: `addComment` doğrudan `getRequestById(requestId, user)` çağırıyor, yetki mantığı ikinci kez yazılmamış |
| 2 — DEPARTMENT_AUTHORITY (atanmış) yorum yazar, karşı tarafa bildirim | ✅ | Canlı: IT authority claim edip yorum yazdı, `COMMENT_ADDED` notification EMPLOYEE'ye oluştu |
| 3 — yetkisiz erişim → 403 | ✅ | Canlı: hem farklı EMPLOYEE hem farklı departman authority'si için `403` |
| 4 — sahibi OPEN talebe yorum yazar, notification OLUŞMAZ | ✅ | Canlı: yorum `201`, `SELECT count(*) FROM notifications` → `0` |
| 5 — yetkisiz listeleme → 403 | ✅ | Canlı: `403` |
| 6 — boş içerik → 400 | ✅ | Canlı: `400 "Yorum içeriği boş olamaz"` |
| 7 — 2000+ karakter → 400 | ✅ | Canlı: `400 "Yorum en fazla 2000 karakter olabilir"` |
| 8 — terminal durumda yorum çalışır | ✅ | Canlı: talep COMPLETED yapıldıktan sonra yorum `201` ile başarılı |
| 9 — olmayan talep → 404 | ✅ | Canlı: `404 "Talep bulunamadı"` |
| 10 — transaction atomicity | ✅ (kod incelemesi) | `withTransaction` reuse edildi, yorum INSERT + koşullu notification INSERT aynı transaction içinde — auth/request-service görevlerindeki AC9/AC12 ile aynı gerekçeyle canlı DB-outage simülasyonu yapılmadı |
| 11 — ADMIN yazamaz, görüntüleyebilir | ✅ | Canlı: ADMIN yorum yazma denemesi `403`, listeleme `200` |

Ayrıca doğrulandı: `listComments` kronolojik sıralama (`created_at ASC`) doğru, `author_name` join'i doğru çalışıyor (`"CommentEmp"`, `"IT Yetkilisi"`), mevcut 36 test hâlâ PASS, `/health` bozulmadı.

## Post-Red-Team Fixes
Red-team review (`red_team.json`) found 2 low-severity findings, both addressed by the same subagent and independently re-verified (48/48 tests pass, no regressions):
- `addComment`: notification recipient (`created_by`/`assigned_to`/`request_number`) is now re-read fresh inside `withTransaction`, immediately after the comment INSERT, instead of relying on the pre-transaction `getRequestById` snapshot — closes a narrow stale-read window consistent with the pattern `claimRequest`/`changeRequestStatus`/`changePriority` already use.
- `test/requests.comments.test.js`: added a test proving a matching-department `DEPARTMENT_AUTHORITY` can comment on a still-`OPEN` (unassigned) request — atdd.md's AC2 explicitly claims this ("atanmış olsun olmasın") but it wasn't previously covered by an automated test.

## Remaining Limitations
- Yorum düzenleme/silme, pagination, dosya eki/mention — hepsi kapsam dışı, eksiklik değil.

## Assumptions
- `req.body.content` alan adı olarak kullanıldı (plan.md/atdd.md'de örtük olarak varsayılmıştı, açıkça teyit edildi).
- Notification recipient mantığı (`user.id === created_by ? assigned_to : created_by`, `null`/kendi-kendine ise atlanır) atdd.md'nin Assumptions/Risks bölümündeki tanımla birebir uygulandı.

## CAVEMAN Review
- **Files added**: 0.
- **New abstractions**: yok — `fail`, `withTransaction`, ve özellikle `getRequestById` (yetki kontrolü için) reuse edildi, hiçbiri yeniden yazılmadı.
- **New helper functions**: yok, sadece 2 gerekli servis fonksiyonu + 2 gerekli controller fonksiyonu.
- **New public APIs**: `addComment`, `listComments` (servis), `postAddComment`, `getComments` (controller) — spec'in istediği kadar, fazlası yok.
- **Complexity justification**: notification INSERT'i inline (mevcut `claimRequest`/`changeRequestStatus` deseniyle aynı, ayrı bir "notification service" soyutlaması yok), `author_name` join'i `REQUEST_LIST_SELECT`'teki `TRIM(CONCAT(...))` deseniyle birebir tutarlı.
