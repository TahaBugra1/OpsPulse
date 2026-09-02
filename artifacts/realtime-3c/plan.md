# Plan — realtime-3c
_Reference: atdd.md_

## Files to Modify

| File | Why | Risk |
|------|-----|------|
| `backend/sockets/index.js` | `io.on('connection', ...)` handler'ına, mevcut `socket.join(\`user:${socket.user.id}\`);` satırının hemen altına, `if (socket.user.role === 'DEPARTMENT_AUTHORITY') { socket.join(\`department-queue:${socket.user.department_id}\`); }` eklenecek — AC1. EMPLOYEE/ADMIN hiç bu dala girmiyor, otomatik olarak hiçbir department-queue room'una katılmıyorlar (AC7'nin yapısal garantisi). | low (tek koşullu blok, mevcut `join:request` listener'ına dokunulmuyor) |
| `backend/sockets/emitter.js` | Mevcut `emitToRoom` iç helper'ı reuse edilerek yeni `emitToDepartmentQueue(departmentId, event, payload)` export edilecek — `emitToUserRoom`'un (realtime-3b) birebir aynı desenİ, sadece room prefix'i `department-queue:` . | low |
| `backend/services/requests.service.js` | `claimRequest`'in sonuna ve `changeRequestStatus`'un sonuna, KENDİ bağımsız try/catch'lerinde `request:removedFromQueue` emisyonu eklenecek — AC2/AC3/AC5/AC6. Aşağıda "Dependencies" bölümünde tam kod deseni verildi. | medium (iki fonksiyonda değişiklik, ama realtime-3b'nin zaten kanıtlanmış "bağımsız try/catch" deseninin doğrudan devamı — asıl risk `changeRequestStatus`'ta guard'ın doğru koşullanması) |

## New Files
Yok — mevcut 3 dosyaya ekleme yeterli.

## Dependencies

### `claimRequest` — koşulsuz emisyon
`result` (transaction'ın döndürdüğü güncellenmiş `requests` satırı) zaten `department_id` kolonunu içeriyor (`RETURNING *`, `requests.department_id` gerçek bir kolon — ekstra sorguya gerek yok). `claimRequest`'in bu noktaya ulaşması zaten "başarılı claim" anlamına geldiği için (aksi halde `fail()` daha önce fırlatılırdı), emisyon koşulsuz:
```js
try {
  emitToDepartmentQueue(result.department_id, 'request:removedFromQueue', { id: result.id });
} catch (queueErr) {
  console.error('request:removedFromQueue emisyonu basarisiz oldu:', queueErr);
}
```
Mevcut `request:updated`/`notification:created` emisyonlarının try/catch'lerinden TAMAMEN AYRI, üçüncü bir try/catch olarak eklenecek (realtime-3b'nin red-team dersi: bağımsız sinyaller birbirine bağlanmasın).

### `changeRequestStatus` — koşullu emisyon (AC6'nın guard'ı)
Fonksiyonun en başında zaten hesaplanan `request.status` (transaction öncesi, DB'den taze çekilen orijinal durum) ve parametre olarak gelen `status` (hedef durum) kullanılarak, transaction'dan SONRA basit bir boolean türetilecek:
```js
const wasOpenRejection = request.status === 'OPEN' && status === 'REJECTED';
```
(Bu ifade transaction'ın İÇİNDE değil, fonksiyonun üst kapsamında zaten mevcut olan iki değişkenden türetiliyor — ekstra bir DB sorgusu gerekmiyor.) Emisyon, sadece bu `true` olduğunda çalışacak:
```js
if (wasOpenRejection) {
  try {
    emitToDepartmentQueue(result.department_id, 'request:removedFromQueue', { id: result.id });
  } catch (queueErr) {
    console.error('request:removedFromQueue emisyonu basarisiz oldu:', queueErr);
  }
}
```
Diğer tüm geçişlerde (`ASSIGNED→IN_PROGRESS`, `ASSIGNED→REJECTED`, `IN_PROGRESS→COMPLETED`, `IN_PROGRESS→REJECTED`) bu blok hiç çalışmaz — AC6'nın "yanlış tetiklenmeme" garantisi budur.

### `changePriority` — DOKUNULMAYACAK
Bu fonksiyon zaten sadece `ASSIGNED`/`IN_PROGRESS` durumundaki taleplerde çalışıyor (`WHERE status IN ('ASSIGNED', 'IN_PROGRESS')`) — yani OPEN bir talebi hiç etkilemiyor, kuyruktan kaldırma ile hiç ilgisi yok. atdd.md'nin `affected_modules` listesinde de yok, plan.md bunu netleştiriyor: **dokunulmayacak**.

## Migration Required?
**Hayır.** Hiçbir yeni kolon/tablo gerekmiyor — `requests.department_id` zaten mevcut ve her iki fonksiyonda da `RETURNING *` ile zaten elde ediliyor.

## Risks
_(atdd.md'den taşınan + keşifte netleşenler)_
- `changeRequestStatus`'un guard'ı (`wasOpenRejection`) yanlış koşullanırsa (ör. `request.status` yerine `updated.status` gibi transaction-sonrası bir alan kullanılırsa) AC6 ihlal edilir — code-copilot'a fonksiyonun ÜST kapsamındaki `request.status` (orijinal, transaction öncesi) kullanılması gerektiği açıkça belirtilecek, `updated`/`result` içindeki `status` değil (o zaten her zaman hedef `status`'a eşit, ayrım yapmaz).
- `is_active`'in sadece handshake anında kontrol edilmesi — realtime-3a/3b'den devralınan, zaten kabul edilmiş bir sınırlama.

## Open Questions
Yok — atdd.md aşamasında event adı çelişkisi (claim+reject ikisi de tetikliyor ama `request:claimed` ismi yanıltıcıydı) zaten kullanıcıyla çözüldü (`request:removedFromQueue`'ya çevrildi). Mimari netleşti, code-copilot'a hazır.
