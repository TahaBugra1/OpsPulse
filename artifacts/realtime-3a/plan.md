# Plan — realtime-3a
_Reference: atdd.md_

## Files to Modify

| File | Why | Risk |
|------|-----|------|
| `backend/server.js` | `app.listen()` yerine `http.createServer(app)` + Socket.io `Server` bu HTTP server'a bağlanacak. **Geriye dönük uyumluluk kritik**: mevcut 58 test `const app = require('../server')` ile supertest kullanıyor — `module.exports = app` aynen kalacak, ek olarak `module.exports.httpServer = httpServer` eklenecek (yeni realtime testlerinin gerçek bir portta dinlemesi için, socket.io-client bir WS bağlantısı gerektiriyor, supertest'in in-process modeli yetmiyor). | medium (mevcut tüm testleri etkileme riski var, dikkatli yapılmalı) |
| `backend/services/requests.service.js` | `claimRequest`, `changeRequestStatus`, `changePriority`, `addComment` — dördü de başarılı `withTransaction(...)` DÖNDÜKTEN SONRA (asla transaction içinde değil, atdd.md'nin Rollback Beklentisi'ne göre) ilgili event'i emit edecek. Ayrıca `getRequestById`'in enriched-fetch mantığı, emisyon için de reuse edilebilecek şekilde küçük bir iç fonksiyona çıkarılacak (aşağıya bakın). | medium |
| `backend/package.json` | `socket.io` (dependency), `socket.io-client` (devDependency) eklenecek | low |

## New Files

| File | Purpose |
|------|---------|
| `backend/sockets/emitter.js` | Basit bir singleton: `setIo(io)` (server.js tarafından bir kez çağrılır) + `emitToRequestRoom(requestId, event, payload)`. Bu, `requests.service.js`'in `sockets/index.js`'i (ve dolayısıyla `io`'yu) değil, sadece bu küçük emitter'ı import etmesini sağlıyor — **circular require riskini önlüyor** (server.js → sockets/index.js → requests.service.js → sockets/emitter.js döngü OLUŞTURMUYOR, çünkü emitter.js hiçbir şeyi geri import etmiyor). |
| `backend/sockets/index.js` | `attachSockets(io)` — handshake auth middleware (`auth.middleware.js`'deki JWT+is_active mantığının Socket.io imzasına uyarlanmış hâli, `(socket, next)`) + `connection` handler'ı içinde `join:request` event'i (yetki kontrolü için **doğrudan `getRequestById` reuse edilecek** — request-comments görevindeki aynı prensip). |

## Dependencies
- `backend/middleware/auth.middleware.js` — REST imzası (`req,res,next`) Socket.io'nunkiyle (`socket,next`) uyumsuz olduğu için **kod birebir kopyalanamıyor, yeniden yazılacak** — ama mantık (jwt.verify + is_active DB'den taze) birebir aynı olmalı. Bu, gerekçeli bir küçük tekrar (CAVEMAN: "duplication over premature abstraction" — iki farklı imza için paylaşılan bir soyutlama zorlama olurdu).
- `backend/services/requests.service.js`'in mevcut `getRequestById(id, user)`'ı — hem REST tarafında hem `join:request` handler'ında yetki kontrolü için reuse edilecek.
- **Yeni bir iç refactor gerekiyor**: `getRequestById`'in gövdesindeki "REQUEST_LIST_SELECT ile zenginleştirilmiş satırı çek" kısmı, authorization kontrolünden ayrı, küçük bir private fonksiyona (`fetchEnrichedRequest(id)`) çıkarılacak. Sebebi: `claimRequest`/`changeRequestStatus`/`changePriority`'nin `RETURNING *`'i HAM `requests` satırı dönüyor (join'siz, `is_overdue`/`request_type_name`/`created_by_name` YOK) — ama atdd.md'nin AC6/AC7'si event payload'ının `getRequestById`'in döndürdüğü ZENGİNLEŞTİRİLMİŞ şekille aynı olmasını istiyor. Bu üç fonksiyon, kendi yazma işlemi başarılı olduktan sonra bu yeni `fetchEnrichedRequest(requestId)`'i çağırıp emisyon payload'ını ondan alacak (authorization kontrolü tekrar yapılmayacak — yazma işlemini yapan zaten yetkiliydi).
- `addComment` için benzer bir durum: mevcut INSERT sadece ham `request_comments` satırını (`author_name` YOK) döndürüyor, ama atdd.md'nin AC8'i `listComments`'in şekliyle (author_name dahil) aynı payload istiyor — `addComment`, kendi INSERT'inden sonra `listComments`'in kullandığı JOIN'li sorgunun tek-satır versiyonunu (yeni eklenen yorumun id'siyle) çalıştırıp emisyon payload'ını ondan alacak.

## Migration Required?
**Hayır.** Hiçbir yeni kolon/tablo gerekmiyor, `socket.io` sadece bir npm paketi.

## Risks
_(atdd.md'den taşınan + keşifte netleşenler)_
- `server.js`'in `http.createServer(app)`'a geçişi, mevcut 58 testin hiçbirini bozmamalı (supertest zaten `app`'i sarmalayıp kendi ephemeral portunu açıyordu, `httpServer`'ın kendisi `require.main===module` guard'ı arkasında kalmaya devam ediyor) — ama bu code-copilot'un **çok dikkatli** yapması gereken, geriye dönük uyumluluğu bozma riski en yüksek değişiklik. code-copilot'a bu riski açıkça vurgulayacağım.
- `withTransaction`'ın içinde emisyon YAPILMAMALI (atdd.md'nin Rollback Beklentisi) — code-copilot'a `withTransaction(...)` çağrısının return değerini aldıktan SONRA, fonksiyonun `return` satırından ÖNCE emisyonu yapması gerektiği açıkça yazılacak.
- Event emisyonu hata fırlatırsa (örn. `io` henüz set edilmemişse) REST yanıtını ASLA etkilememeli — `emitToRequestRoom` kendi içinde `ioInstance` yoksa sessizce no-op olmalı (zaten emitter.js tasarımı bunu karşılıyor), ayrıca emisyon çağrısı REST fonksiyonunun `return`'ünden sonra değil, `try/catch` gerektirmeyecek şekilde senkron/best-effort olmalı.

## Open Questions
Yok — mimari netleşti, code-copilot'a hazır.
