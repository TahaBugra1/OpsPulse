# Code Diff — realtime-3b
_Reference: atdd.md, plan.md_

## Files Created
Yok.

## Files Modified
- `backend/sockets/emitter.js` — `emitToRequestRoom`'un içindeki no-op-guard mantığı ortak (export edilmeyen) `emitToRoom(room, event, payload)` iç fonksiyonuna çıkarıldı; yeni export edilen `emitToUserRoom(userId, event, payload)` aynı helper'ı `user:<id>` room adıyla çağırıyor. plan.md'nin öngördüğü tek yeni soyutlama, tam olarak önerilen şekilde.
- `backend/sockets/index.js` — `io.on('connection', ...)` handler'ının en başına tek satır eklendi: `socket.join(\`user:${socket.user.id}\`);`. Client-side hiçbir event gerekmiyor, `join:request` listener'ına dokunulmadı.
- `backend/services/requests.service.js` — `claimRequest`, `changeRequestStatus`, `addComment`: her üçünde de mevcut `INSERT INTO notifications (...)`'a `RETURNING *` eklendi, satır `withTransaction(...)`'dan ÖNCE tanımlanan bir `notificationRow` değişkenine yakalandı (transaction'ın kendi `return` değeri değişmedi), commit sonrası mevcut `request:updated`/`request:commented` emisyon try/catch'i İÇİNDE `if (notificationRow) { emitToUserRoom(...) }` ile `notification:created` emit ediliyor. `changeRequestStatus`'ta guard gerçekten koşullu (sadece COMPLETED/REJECTED'de), `addComment`'te gerçekten koşullu (sadece recipient varsa), `claimRequest`'te koşulsuz ama tutarlılık için guard'lı. `changePriority`'ye HİÇ dokunulmadı (plan.md'nin kararı — bu fonksiyonun hiç notification'ı yok). **REST response şekli/status kodları hiçbir fonksiyonda değişmedi.**

## Acceptance Criteria Coverage (kod okunarak + npm test ile doğrulandı)

| AC | Status | Nasıl doğrulandı |
|----|--------|-------------------|
| 1 — bağlantı anında otomatik user:<id> join | ✅ | Kod: `sockets/index.js:39`, `connection` handler'ının ilk satırı, senkron |
| 2 — claim → notification:created (REQUEST_ASSIGNED) | ✅ | Kod: `claimRequest`, `RETURNING *` + `notificationRow` + guard'lı emit |
| 3 — COMPLETED/REJECTED → notification:created | ✅ | Kod: `changeRequestStatus`, aynı desen, `if (status === 'COMPLETED' \|\| status === 'REJECTED')` içinde |
| 4 — comment → notification:created (COMMENT_ADDED) | ✅ | Kod: `addComment`, aynı desen, `if (recipient && recipient !== user.id)` içinde |
| 5 — çoklu sekme (tüm socket'lar alır) | ✅ (ekstra kod yok) | Socket.io'nun room-broadcast'i doğası gereği room'daki tüm socket'lara iletir — CAVEMAN'a uygun şekilde ekstra kod eklenmedi |
| 6 — offline (bağlı değilse sessiz no-op) | ✅ (ekstra kod yok) | `emitToRoom`'un `ioInstance.to(room).emit(...)`'i, room boşsa/yoksa zaten no-op — REST etkilenmiyor |
| 7 — emisyon hatası REST'i etkilemesin (baştan) | ✅ | Kod: 3 fonksiyonda da mevcut try/catch bloğu İÇİNDE (retrofit değil, day-1) |
| 8 — izolasyon (farklı kullanıcı event almaz) | ✅ (ekstra kod yok) | Room-based hedefleme (`user:<id>`) doğası gereği izole |
| 9 — <500ms (bilgi amaçlı) | N/A (kapsamda test yok) | atdd.md'nin kararıyla tutarlı, otomatik testte sabit eşik yok |

**Ayrıca doğrulandı: mevcut 66 test hâlâ PASS** — 2 ardışık `npm test` çalıştırması, hepsi 66/66. Hiçbir REST davranışı bozulmadı.

## Remaining Limitations
- REST bildirim endpoint'leri (liste/unread-count/mark-as-read) yok — atdd.md'nin kararıyla bu görevin kapsamı dışında, ayrı bir görev olacak.
- ADMIN'e hiç canlı bildirim gitmiyor — bugünkü davranış (ADMIN'e hiç notification satırı yazılmıyor) korunuyor, kullanıcı kararıyla.
- Offline/reconnection mesaj kuyruğu yok — bilinçli tasarım kararı (atdd.md).

## Assumptions
- Event adı `notification:created`, room adı deseni `user:<id>` — atdd.md'de zaten netleşmişti, plan.md'de teyit edildi.

## CAVEMAN Review
- **Files added**: 0.
- **New abstractions**: 1 — `emitter.js`'deki export edilmeyen `emitToRoom` iç fonksiyonu, plan.md'nin açıkça önerdiği, iki room-emit fonksiyonu arasındaki `ioInstance` guard tekrarını önleyen minimal bir refactor.
- **New helper functions**: yukarıdaki + 0 başka.
- **New public APIs**: `emitToUserRoom` — AC'nin doğrudan gerektirdiği, fazlası yok.
- **Complexity justification**: Her serviste sadece 1 `let` değişkeni + `RETURNING *` + 1 guard'lı emit çağrısı eklendi, mevcut try/catch idiomuna gömülü. AC5/6/8/9 için HİÇ ekstra kod yazılmadı (Socket.io'nun doğal davranışına bırakıldı) — CAVEMAN'ın "gereksiz özel durum kodu ekleme" ilkesine tam uyum.

## Addendum — red-team follow-up fix (aynı task-slug, code-copilot ikinci tur)
`artifacts/realtime-3b/red_team.json`'ın 1 bulgusu düzeltildi (`backend/services/requests.service.js`, başka dosya değişmedi):

**[Medium/Reliability, düzeltildi]** `claimRequest`/`changeRequestStatus`/`addComment`'in üçünde de, `notification:created` emisyonu artık `request:updated`/`request:commented` enrichment fetch'inin try/catch'inden AYRI, kendi bağımsız try/catch'inde çalışıyor. Artık enrichment fetch'i (geçici bir DB hatasıyla) patlasa bile, zaten DB'ye kalıcı yazılmış ve elde hazır olan `notificationRow` kendi başına, bağımsız olarak emit edilmeye çalışılıyor — iki bağımsız sinyal artık birbirine bağlı değil.

**Doğrulama (orkestratör tarafından bağımsız):**
- Dosya okundu, her 3 fonksiyonda ayrı try/catch blokları doğrulandı (satır numaraları: `claimRequest` 141-153, `changeRequestStatus` 247-259, `addComment` 462-474); başka hiçbir dosya değişmemiş (`git status --short`).
- `npm test`: 2 ardışık çalıştırma, ikisinde de **75/75 PASS, 0 FAIL** (davranış değişmedi, sadece hata izolasyonu iyileştirildi).
