# Plan — request-comments
_Reference: atdd.md_

## Files to Modify

| File | Why | Risk |
|------|-----|------|
| `backend/services/requests.service.js` | Add `addComment(requestId, content, user)` ve `listComments(requestId, user)` | medium (yetki kontrolü + notification alıcı mantığı, kendi kendine bildirim gitmemesi gerekiyor) |
| `backend/controllers/requests.controller.js` | Add `addCommentHandler`, `getCommentsHandler` — mevcut thin-controller deseniyle | low |
| `backend/routes/requests.routes.js` | Add `router.post('/:id/comments', addCommentHandler)` ve `router.get('/:id/comments', getCommentsHandler)` | low |

## New Files
Yok.

## Dependencies
- **`getRequestById(id, user)` (mevcut, aynı dosyada) — doğrudan reuse edilecek.** Hem `addComment` hem `listComments`, önce `getRequestById(requestId, user)` çağırarak talebin var olup olmadığını (404) ve görüntüleme yetkisini (403) kontrol edecek — atdd.md'nin AC4/AC5'i zaten "request-read'deki aynı kurallar" diyor, bu fonksiyon o kuralları birebir uyguluyor. Yetki mantığını (isOwner/isDepartmentAuthority/isAdmin) ikinci kez yazmak CAVEMAN'a aykırı olurdu.
- `withTransaction` (mevcut) — yorum INSERT + notification INSERT için reuse.
- `fail` (mevcut) — hata fırlatma deseni.
- `db/schema.sql`'deki `request_comments` (id, request_id, author_id, content, created_at) ve `notifications` (COMMENT_ADDED type zaten CHECK'te var) tabloları — migration gerekmiyor.

## Migration Required?
**Hayır.** `request_comments` ve `notifications` tabloları zaten hazır, `COMMENT_ADDED` notification type'ı zaten CHECK constraint'inde tanımlı.

## Risks
_(atdd.md'den taşınan + keşifte netleşenler)_
- **Kendi kendine bildirim riski**: `getRequestById` çağrısı yetkiyi doğruluyor ama "karşı taraf kim" sorusunu cevaplamıyor — bu mantık `addComment` içinde ayrıca yazılmalı: `recipientId = (user.id === request.created_by) ? request.assigned_to : request.created_by`, ve `recipientId === user.id` ise (örn. bir DEPARTMENT_AUTHORITY kendi oluşturduğu talebi kendine atamışsa) veya `recipientId` null ise (OPEN, henüz atanmamış) **notification oluşturulmamalı**.
- `getRequestById`'in döndürdüğü satır zaten `created_by`/`assigned_to` içeriyor (REQUEST_LIST_SELECT'in bir parçası) — `addComment`'in ayrıca bir SELECT atmasına gerek yok, `getRequestById`'in sonucu doğrudan kullanılabilir.

## Open Questions
Yok — atdd.md ve bu keşif kapsamı tam netleştirdi, code-copilot'a hazır.
