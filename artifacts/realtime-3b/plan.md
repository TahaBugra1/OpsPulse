# Plan — realtime-3b
_Reference: atdd.md_

## Files to Modify

| File | Why | Risk |
|------|-----|------|
| `backend/sockets/index.js` | `io.on('connection', (socket) => {...})` handler'ının EN BAŞINA (mevcut `join:request` listener'ından önce), handshake zaten `socket.user` set ettiği için senkron bir `socket.join(\`user:${socket.user.id}\`)` eklenecek — AC1. Hiçbir client-side event beklenmiyor, sadece bağlantı anında otomatik. | low (tek satır ekleme, mevcut `join:request` mantığına dokunulmuyor) |
| `backend/sockets/emitter.js` | Yeni bir `emitToUserRoom(userId, event, payload)` eklenecek. Mevcut `emitToRequestRoom` ile aynı no-op-guard mantığını (`if (!ioInstance) return;`) tekrar etmemek için, iki fonksiyonun da çağıracağı küçük bir ortak `emitToRoom(room, event, payload)` iç fonksiyonuna çıkarılması önerilir (projenin `REQUEST_LIST_SELECT`/`COMMENT_SELECT` paylaşım deseniyle tutarlı — bkz. realtime-3a'nın red-team fix'i). Kesin şekli code-copilot'a bırakılıyor, CAVEMAN'a göre en basiti seçilecek. | low |
| `backend/services/requests.service.js` | 3 mevcut `INSERT INTO notifications (...)` ifadesine `RETURNING *` eklenecek (AC2-4'ün "tam bildirim nesnesi" gereksinimi için — şu an hiçbiri satırı geri döndürmüyor). `claimRequest`, `changeRequestStatus`, `addComment` her biri: transaction içinde insert edilen bildirim satırını dış kapsamdaki bir değişkene yakalayıp, `withTransaction(...)` COMMIT olduktan SONRA (mevcut `request:updated`/`request:commented` emisyon desenindeki AYNI try/catch izolasyonu ile, AC7) `notification:created` emit edecek. `changeRequestStatus`'ta bildirim sadece `COMPLETED`/`REJECTED`'de oluşuyor (koşullu); `addComment`'te sadece `recipient` varsa (koşullu) — bildirim oluşmadıysa emisyon adımı atlanacak. **REST response şekli/status kodları değişmiyor** — bu tamamen yan etki. | medium (4 fonksiyonun 3'ünde değişiklik, ama desen realtime-3a'da zaten kanıtlanmış — asıl risk conditional insert'lerin doğru guard'lanması) |

## New Files
Yok — atdd.md'nin varsaydığının aksine, mevcut `sockets/emitter.js`'e yeni bir fonksiyon eklemek yeterli, ayrı bir dosya gerekmiyor.

## Dependencies
- `backend/sockets/index.js`'in mevcut handshake auth middleware'i (`socket.user = {id, role, department_id}`) — `user:<id>` room adı doğrudan `socket.user.id`'den türetiliyor, ek bir DB sorgusu gerekmiyor.
- `backend/sockets/emitter.js`'in mevcut singleton deseni (`ioInstance`) — `emitToUserRoom` aynı `setIo`'yu kullanacak, yeni bir singleton gerekmiyor.
- realtime-3a'nın red-team fix'inde kurulan try/catch izolasyon deseni (`backend/services/requests.service.js`'deki `claimRequest`/`changeRequestStatus`/`changePriority`/`addComment`'in mevcut `request:updated`/`request:commented` emisyon blokları) — bu görev AYNI try/catch bloğunun İÇİNE (ya da hemen yanına, aynı desende) notification emisyonunu da ekleyecek, ayrı bir try/catch icat etmeyecek.
- Socket.io'nun kendi room-broadcast mekanizması (`io.to(room).emit(...)`) — AC5 (çoklu sekme) ve AC6 (offline) için EK bir kod gerekmiyor: bir room'da 0 ya da N socket olması Socket.io tarafından zaten doğal olarak yönetiliyor (0 socket = no-op, N socket = hepsine iletim). code-copilot'un bunun için ekstra bir mantık kurmasına gerek yok.

## Migration Required?
**Hayır.** `notifications` tablosu zaten var, hiçbir kolon/tablo değişmiyor.

## Risks
_(atdd.md'den taşınan + keşifte netleşenler)_
- `changeRequestStatus`'un notification insert'i koşullu (`status === 'COMPLETED' || status === 'REJECTED'`) — code-copilot bu koşulu emisyon tarafında da doğru guard'lamalı (aksi halde `undefined`/`null` bir bildirim nesnesi emit edilme riski var). Aynı şekilde `addComment`'in `recipient` koşulu.
- `claimRequest`'in notification insert'i koşulsuz (her başarılı claim'de oluşur) — bu üçü arasında en basit durum.
- `changePriority`'de HİÇBİR notification insert'i yok (bugün de yok, bu görevde de eklenmiyor — atdd.md'nin kapsamı dışı, mevcut 4 notification type'ı değişmiyor) — code-copilot'a açıkça bu fonksiyona DOKUNULMAYACAĞI belirtilecek.

## Open Questions
Yok — mimari netleşti (mevcut emitter.js'e ek fonksiyon, mevcut sockets/index.js'e tek satır, mevcut 3 notification INSERT noktasına RETURNING + emisyon), code-copilot'a hazır.
