# Code Diff — realtime-3a
_Reference: atdd.md, plan.md_

## Files Created
- `backend/sockets/emitter.js` — minimal singleton (`setIo`, `emitToRequestRoom`), circular-require'ı önlüyor
- `backend/sockets/index.js` — `attachSockets(io)`: handshake JWT+is_active doğrulaması + `join:request` handler'ı (`getRequestById` reuse edilerek)

## Files Modified
- `backend/server.js` — `http.createServer(app)` + Socket.io `Server` bağlandı, `module.exports = app` + `.httpServer`/`.io` eklendi. Middleware/route mount sırası birebir korundu.
- `backend/services/requests.service.js` — `fetchEnrichedRequest` private helper'a çıkarıldı (`getRequestById` artık onu çağırıyor, SQL tekrarı yok); `claimRequest`/`changeRequestStatus`/`changePriority` transaction sonrası `request:updated`, `addComment` transaction sonrası `request:commented` emit ediyor. **4 mevcut yazma fonksiyonunun REST davranışı (status kodları, response body'leri) değişmedi** — sadece yan etki olarak emisyon eklendi.
- `backend/package.json` — `socket.io` (dependency), `socket.io-client` (devDependency) eklendi.

## Acceptance Criteria Coverage (independently verified — live socket.io-client script against the real server + real DB, 10/10 checks)

| AC | Status | How verified |
|----|--------|--------------|
| 1 — geçerli JWT handshake başarılı | ✅ | Canlı: gerçek IT authority JWT'siyle bağlantı kuruldu |
| 2 — geçersiz JWT handshake reddedilir | ✅ | Canlı: `connect_error`, "Geçersiz veya süresi dolmuş token" |
| 3 — join:request, getRequestById ile aynı yetki kontrolü | ✅ | Canlı: IT authority kendi departmanındaki talebe join oldu (dolaylı olarak sonraki event alımıyla kanıtlandı) |
| 4 — yetkisiz join → error event | ✅ | Canlı: HR authority (yanlış departman) join denedi, `error` event'i "Bu işlem için yetkiniz yok" ile alındı |
| 5 — olmayan talep join → error event | ✅ | Canlı: `error` event'i "Talep bulunamadı" ile alındı |
| 6 — claimRequest → request:updated | ✅ | Canlı: claim sonrası event alındı, payload `getRequestById` şekliyle aynı (`is_overdue`, `request_type_name` dahil) |
| 7 — changePriority → request:updated | ✅ | Canlı: öncelik değişikliği sonrası event alındı |
| 8 — addComment → request:commented (author_name dahil) | ✅ | Canlı: yorum event'i `author_name:"IT Yetkilisi"` ile alındı |
| 9 — room'a katılmamış client event almaz (izolasyon) | ✅ | Canlı: aynı yetkiye sahip ama join olmamış ikinci bir socket hiçbir event almadı — global broadcast YOK, gerçek room-scoping kanıtlandı |
| 10 — <500ms gecikme | ✅ | Canlı: ölçülen gecikme 18ms |

**Ayrıca (kritik, en yüksek riskli değişiklik) doğrulandı: mevcut 58 test hâlâ PASS** — 3 ardışık `npm test` çalıştırması, hepsi 58/58. `server.js`'in `http.createServer` geçişi hiçbir REST/supertest davranışını bozmadı.

## Remaining Limitations
- 'leave:request' event'i veya açık disconnect handling yok — Socket.io'nun kendi room temizliğine güveniliyor (atdd.md'nin kararı).
- Real-Time 3B (`notification:created`) ve 3C (claim-queue live removal) bu görevin kapsamında değil.
- `is_active`'in sadece handshake anında kontrol edilmesi (bağlantı boyunca değil) — atdd.md'nin Risks bölümünde zaten kabul edilmiş bir sınırlama.

## Assumptions
- Client→server join event'inin adı `join:request` olarak seçildi (CLAUDE.md'de belirtilmemişti, plan.md'de netleştirilmişti).
- `socket.handshake.auth.token` — socket.io-client'ın standart `io(url, {auth:{token}})` deseni kullanıldı.

## CAVEMAN Review
- **Files added**: tam olarak plan.md'nin öngördüğü 2 dosya.
- **New abstractions**: `emitter.js`'in singleton'ı (spec'in kendisi istiyordu, circular-require'ı önlemek için gerekli), `fetchEnrichedRequest` (gerçek SQL tekrarını önlüyor — hem `getRequestById` hem 4 emisyon noktası kullanıyor).
- **New helper functions**: yukarıdakiler + `attachSockets` — hepsi spec'in doğrudan istediği, fazlası yok.
- **New public APIs**: `attachSockets(io)`, `emitter`'ın 2 fonksiyonu — hiçbiri REST yüzeyini değiştirmiyor.
- **Complexity justification**: Socket handshake auth mantığı, `auth.middleware.js`'in REST mantığını kasıtlı olarak tekrarlıyor (farklı imza, paylaşılan bir soyutlama zorlama olurdu) — spec'in kendisi bunu istemişti. Generic bir pub/sub soyutlaması yok, düz `io.to(room).emit(...)` kullanılıyor.

## Addendum — red-team follow-up fix (aynı task-slug, code-copilot ikinci tur)
`artifacts/realtime-3a/red_team.json`'ın 2 bulgusu düzeltildi (`backend/services/requests.service.js`, başka dosya değişmedi):

1. **[Medium/Reliability, düzeltildi]** `claimRequest`/`changeRequestStatus`/`changePriority`/`addComment`'in dördünde de, transaction commit sonrası enrichment-fetch + emit adımı artık ayrı bir `try/catch` içinde — hata durumunda sadece `console.error` ile loglanıyor, asla fonksiyonun kendi `return result;`/`return comment;`'ini engellemiyor. Böylece geçici bir DB hatası, DB'de zaten başarılı olmuş bir yazma işlemini client'a yanlışlıkla 500 olarak yansıtamaz — atdd.md'nin Rollback Beklentisi ilkesi artık emisyondan önceki re-fetch adımını da kapsıyor.
2. **[Low/Maintainability, düzeltildi]** `addComment` ve `listComments`'in neredeyse aynı SELECT'i, `REQUEST_LIST_SELECT` deseniyle tutarlı yeni bir `COMMENT_SELECT` sabitinde birleştirildi — SQL tekrarı kalmadı.

**Doğrulama (orkestratör tarafından bağımsız):**
- Dosya okundu, her 4 fonksiyonda try/catch + `COMMENT_SELECT` kullanımı doğrulandı; başka hiçbir dosya değişmemiş (`git status --short`).
- `npm test`: 2 ardışık çalıştırma, ikisinde de **66/66 PASS, 0 FAIL** (davranış değişmedi, sadece hata izolasyonu eklendi).
- Fix sonrası ikinci bir canlı manuel doğrulama script'i (gerçek server + gerçek Postgres) çalıştırıldı: claim→`request:updated`, comment→`request:commented` (author_name `COMMENT_SELECT` üzerinden doğru), `listComments`, priority change — **10/10 PASS**. Script silindi, DB'de kalıntı yok.
