---
task_slug: realtime-3b
jira_id: null
saga_task_id: null
priority: critical
coverage_target: 75
performance_target: "<500ms event delivery (same as realtime-3a)"
memory_target: null
test_strategy:
  unit: 40
  integration: 50
  e2e: 10
affected_modules:
  - backend/sockets/index.js (modify — auto-join each authenticated socket to its own user:<id> room at connection time, no client-side join event)
  - backend/sockets/emitter.js (modify — add a room-emit helper for user-scoped rooms, alongside the existing request-scoped one)
  - backend/services/requests.service.js (modify — the 3 existing notification INSERT sites in claimRequest, changeRequestStatus, addComment each emit notification:created after their transaction commits)
---

# ATDD — realtime-3b

## Jira Kaynağı
Jira'ya bağlı değil — yerel görev.

## Persona
- **EMPLOYEE / DEPARTMENT_AUTHORITY / ADMIN**: hepsi kendi `notifications` satırlarının canlı bildirimini alır (CLAUDE.md: "an EMPLOYEE's socket only receives events for their own requests/notifications"). Bu görevde ADMIN'e özel bir davranış YOK — bugünkü INSERT mantığı ADMIN'e hiç satır yazmıyor, bu değişmiyor (kullanıcı kararı).

## Hedef (Neden)
CLAUDE.md'nin garanti/korunan kapsamının SON parçası (Core + Analytics 2A + Real-Time 3A + Real-Time 3B). Şu ana kadar `notifications` tablosuna satır yazılıyor ama kullanıcı bunu görmek için sayfayı yenilemesi gerekiyordu. Bu görev, realtime-3a'da kurulan Socket.io altyapısını (JWT handshake auth, aynı emit-after-commit deseni) yeniden kullanarak, bir bildirim oluşturulduğu anda ilgili kullanıcının bağlı socket'ına canlı olarak iletir — rozet sayısı anlık artar.

## User Story
As a kimliği doğrulanmış bir kullanıcı (EMPLOYEE/DEPARTMENT_AUTHORITY/ADMIN)
I want kendime ait yeni bir bildirim oluştuğunda bunu sayfa yenilemeden anlık görebilmek
So that talep durumuyla ilgili gelişmeleri kaçırmayayım

## Acceptance Criteria (Given-When-Then, önceliklendirilmiş)

1. [Critical] Given geçerli bir JWT ile kurulmuş bir Socket.io bağlantısı, When bağlantı kurulursa, Then sunucu client'ı hiçbir client-side event beklemeden otomatik olarak kendi `user:<id>` room'una ekler (`<id>` = `socket.user.id`, handshake'ten gelen).

2. [Critical] Given bir talep bir DEPARTMENT_AUTHORITY tarafından claim edilir (mevcut `REQUEST_ASSIGNED` bildirimi oluşur), When `notifications` satırı commit edilirse, Then talebi oluşturan kullanıcının `user:<id>` room'una tam bildirim nesnesiyle bir `notification:created` event'i emit edilir.

3. [Critical] Given bir talebin durumu `COMPLETED` veya `REJECTED` olur (mevcut `REQUEST_COMPLETED`/`REQUEST_REJECTED` bildirimi oluşur), When commit edilirse, Then aynı şekilde `notification:created` emit edilir.

4. [Critical] Given bir talebe yorum eklenir ve alıcı için `COMMENT_ADDED` bildirimi oluşur, When commit edilirse, Then aynı şekilde `notification:created` emit edilir.

5. [High] Given bir kullanıcının aynı anda birden fazla bağlı socket'ı (ör. 2 sekme), When kendisi için bir bildirim oluşursa, Then TÜM bağlı socket'ları event'i alır (hepsi aynı `user:<id>` room'unda).

6. [High] Given bildirim oluştuğunda hedef kullanıcı hiç bağlı değilse (offline), When bildirim insert edilirse, Then REST işlemi normal şekilde başarıyla tamamlanır (event sadece iletilmez, kuyruklanmaz, hata fırlatılmaz).

7. [High] Given notification insert + emit adımı (mevcut yazma transaction'ı zaten commit olduktan sonra ya da onun içinde), When emisyon adımı herhangi bir sebeple hata verirse, Then bu hata sadece loglanır, asla üst REST fonksiyonunun başarılı dönüşünü etkilemez — realtime-3a'nın red-team'de SONRADAN bulduğu deseni bu görev BAŞTAN uygular (kullanıcı kararı).

8. [Medium] Given kullanıcı A'ya ait bağlı bir socket, When kullanıcı B için bir bildirim oluşursa, Then A'nın socket'ı HİÇBİR event almaz (room izolasyonu — realtime-3a'nın AC9'uyla aynı kanıt deseni, farklı room tipi).

9. [Medium] Given başarılı bir bildirim insert + emit, When event teslim edilirse, Then gecikme <500ms içinde gerçekleşir (bilgi amaçlı, sabit eşik assertion'ı yok — realtime-3a'nın AC10 kararıyla tutarlı).

## Test Strategy
Unit: 40% — (varsa) auto-join mantığının izole kontrolü
Integration: 50% — `socket.io-client` ile gerçek bağlantı + gerçek Postgres'e karşı REST tetikleyicileri (claim/status/comment) + event dinleme (realtime-3a ile aynı ağırlık, aynı gerekçe)
E2E: 10% — N/A (frontend henüz yok)

## Benchmark / Başarı Ölçütü
Coverage Target: 75%
Performance Target: <500ms event teslimatı (realtime-3a ile aynı)
Memory: belirtilmedi
Diğer ölçülebilir kriterler: yok

## Kapsam Dışı
- REST bildirim endpoint'leri (`GET /api/notifications` liste/unread-count, mark-as-read) — bu görev SADECE WS push'u kapsar, REST tarafı ayrı bir görev (kullanıcı kararı).
- Mark-as-read'in canlı senkronizasyonu (bir sekmede okundu işaretlenince diğerlerinde anlık güncelleme) — REST mark-as-read endpoint'i bile yok, dolayısıyla bu da yok.
- Bildirim listesi UI/sayfalama/filtreleme — frontend henüz yok.
- Browser/native push notification (Web Push API vb.) — CLAUDE.md'nin genel "Email/SMS notifications" kapsam dışı kararıyla aynı ruhta.
- Yeni bir `notifications.type` değeri eklemek — mevcut 4 tip (`REQUEST_ASSIGNED`/`REQUEST_COMPLETED`/`REQUEST_REJECTED`/`COMMENT_ADDED`) değişmiyor.
- ADMIN için sistem geneli canlı bildirim — bugünkü davranış (ADMIN'e hiç satır yazılmıyor) korunuyor, genişletilmiyor.
- Reconnection/offline mesaj kuyruğu mantığı — CLAUDE.md'nin proje geneli kapsam dışı kararıyla ve realtime-3a'nın kendi kararıyla tutarlı.
- Explicit `join:notifications` event'i — otomatik room-join tercih edildi, client hiçbir şey emit etmiyor.

## Etkilenen Dosyalar/Modüller (bilinen)
- `backend/sockets/index.js` — `io.on('connection', ...)` içine, handshake auth başarılı olduktan hemen sonra `socket.join(\`user:${socket.user.id}\`)` eklenecek.
- `backend/sockets/emitter.js` — request-scoped `emitToRequestRoom`'un yanına, user-scoped room'a emit için bir helper eklenecek (plan.md'de netleşecek: yeni bir fonksiyon mu, yoksa generic bir `emitToRoom(roomName, event, payload)`'a mı refactor edilecek).
- `backend/services/requests.service.js` — 3 mevcut `INSERT INTO notifications` noktası (`claimRequest`, `changeRequestStatus`, `addComment`) her biri kendi commit'inden sonra `notification:created` emit edecek, try/catch ile izole (AC7).
- Migration YOK — hiçbir şema değişikliği gerekmiyor.

## Rollback Beklentisi
`notifications` INSERT'i zaten ilgili yazma işleminin (claim/status-change/comment) kendi transaction'ı İÇİNDE yapılıyor — yani bildirim satırı, REST işlemi başarılı olduğunda zaten kalıcı olarak commit edilmiş oluyor. Emisyon adımı (post-commit, realtime-3a'daki desenle aynı) bu görevde BAŞTAN try/catch ile izole edilecek: emisyon başarısız olursa sadece loglanır, REST yanıtını hiçbir şekilde etkilemez (kullanıcı kararı — AC7).

## Risks
- `is_active`'in sadece handshake anında kontrol edilmesi (bağlantı boyunca değil) — realtime-3a'dan devralınan, zaten kabul edilmiş bir sınırlama, bu görevde tekrar değerlendirilmedi (kullanıcı kararı: "realtime-3a'dan devralınanlar yeterli").

## Assumptions
- Event adı `notification:created`, CLAUDE.md'nin API Design Principles bölümünde birebir bu şekilde listelenmiş.
- Room adı deseni `user:<id>` (request-scoped `request:<id>` deseniyle tutarlı, plan.md'de netleşecek).

## Unknowns
- Yok — 12 soru ile tüm kategoriler netleşti.

## Sorular ve Cevaplar (ham kayıt)
1. Room'a katılım mekanizması → Otomatik (bağlantı anında, client hiçbir event göndermez).
2. ADMIN'in canlı bildirim kapsamı → Sadece kendi bildirimleri (bugünkü davranış, INSERT mantığı değişmiyor).
3. Bu görevin kapsamı → Sadece WS push (notification:created), REST list/mark-as-read ayrı görev.
4. Kabul kriteri sahibi → Evet, otomatik testler + manuel doğrulama (realtime-3a ile tutarlı standart).
5. Çoklu sekme davranışı → Tüm bağlı socket'lar event alır.
6. Offline durum → Event kaybolur (realtime-3a ile tutarlı, kuyruklama yok).
7. Hata izolasyonu deseni → Evet, baştan try/catch ile izole edilsin (realtime-3a'nın red-team dersini tekrarlamayalım).
8. Test stratejisi/coverage → Aynı (40/50/10, %75).
9. Happy path senaryosu → Talep claim edilince bildirim (REQUEST_ASSIGNED).
10. Kapsam dışı → (kullanıcı önce fikrimi sordu, önerim onaylandı) Mark-as-read canlı senkronizasyonu, bildirim listesi UI, browser push, yeni notification type — hepsi kapsam dışı.
11. Performans hedefi → Aynı <500ms.
12. Bilinen risk/varsayım → realtime-3a'dan devralınanlar yeterli, yeni risk yok.
