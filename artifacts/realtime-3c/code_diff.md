# Code Diff — realtime-3c
_Reference: atdd.md, plan.md_

## Files Created
Yok.

## Files Modified
- `backend/sockets/emitter.js` — `emitToRoom`/`emitToRequestRoom`/`emitToUserRoom`/`setIo` **değişmedi**. Yeni `emitToDepartmentQueue(departmentId, event, payload)` eklendi, mevcut `emitToUserRoom` deseniyle birebir aynı (tek satır delegasyon).
- `backend/sockets/index.js` — mevcut `user:<id>` otomatik-join ve `join:request` listener'ı **değişmedi**. Mevcut `socket.join(\`user:${socket.user.id}\`);` satırının hemen altına, `socket.user.role === 'DEPARTMENT_AUTHORITY'` koşuluyla `department-queue:<department_id>` otomatik-join eklendi.
- `backend/services/requests.service.js` — `changePriority`/`createRequest`/`getRequestById`/`addComment`/`listComments`/`listRequests` ve diğer tüm fonksiyonlar **byte-for-byte değişmedi** (kod okunarak doğrulandı). `claimRequest`'e KOŞULSUZ 3. bağımsız try/catch (mevcut `request:updated`/`notification:created` bloklarından tamamen ayrı) eklendi. `changeRequestStatus`'a `wasOpenRejection = request.status === 'OPEN' && status === 'REJECTED'` (transaction öncesi orijinal `request.status` kullanılarak, `updated`/`result` değil) + bu koşula bağlı 4. bağımsız try/catch eklendi.

## Acceptance Criteria Coverage (kod okunarak + npm test ile doğrulandı)

| AC | Status | Nasıl doğrulandı |
|----|--------|-------------------|
| 1 — DEPARTMENT_AUTHORITY otomatik department-queue join, EMPLOYEE/ADMIN hiç join olmaz | ✅ | Kod: `sockets/index.js:40-42`, koşullu blok |
| 2 — claim → request:removedFromQueue (room'daki herkes, claimer dahil) | ✅ | Kod: `claimRequest`'in koşulsuz 3. try/catch'i |
| 3 — OPEN→REJECTED → request:removedFromQueue | ✅ | Kod: `changeRequestStatus`'un `wasOpenRejection` guard'lı 4. try/catch'i |
| 4 — izolasyon (farklı departman event almaz) | ✅ (ekstra kod yok) | Room-based hedefleme (`department-queue:<id>`) doğası gereği izole |
| 5 — emisyon hatası REST'i etkilemesin, DİĞER emisyonlardan bağımsız | ✅ | Kod: 4 emisyon da (request:updated, notification:created, request:removedFromQueue x2) ayrı ayrı try/catch'lerde, hiçbiri birleştirilmemiş |
| 6 — yanlış geçişte emit edilmez (ASSIGNED→IN_PROGRESS vb.) | ✅ | Kod: `wasOpenRejection` doğru değişkenlerden (`request.status` pre-transaction, `status` parametre) türetilmiş, `updated`/`result`'tan DEĞİL |
| 7 — EMPLOYEE/ADMIN asla almaz | ✅ (ekstra kod yok, AC1'in yapısal sonucu) | Hiçbir department-queue room'una hiç eklenmediler |

**Ayrıca doğrulandı**: `npm test` 2 ardışık çalıştırma, ikisinde de **88/88 PASS** (bu görevde henüz yeni test dosyası yok — test-copilot'un işi, mevcut testlerin bozulmadığı doğrulandı).

## Remaining Limitations
- Kuyruğa canlı ekleme yok, ADMIN otomatik-join yok, explicit `leave:department-queue` yok, kuyruk UI yok (hepsi kapsam dışı, atdd.md kararı).

## Assumptions
- `result.department_id`, her iki fonksiyonun da `RETURNING *`'ından zaten geliyor (gerçek bir kolon), ekstra sorguya gerek yok — plan.md'nin öngördüğü gibi.

## CAVEMAN Review
- **Files added**: 0.
- **New abstractions**: `emitToDepartmentQueue` — `emitToUserRoom`'un birebir aynı deseni, yeni room tipini hedeflemek için gerekli, gerekçeli.
- **New helper functions**: 0 (yalnızca `wasOpenRejection` yerel bir `const`, helper fonksiyon değil).
- **New public APIs**: `emitToDepartmentQueue` — AC'nin doğrudan gerektirdiği, fazlası yok.
- **Complexity justification**: `claimRequest`'teki emisyon koşulsuz (basit), `changeRequestStatus`'taki emisyon tek bir boolean guard ile koşullu — ikisi de minimal, spekülatif bir yapı yok. `changePriority`'ye hiç dokunulmamış.
