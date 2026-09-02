---
task_slug: realtime-3c
jira_id: null
saga_task_id: null
priority: high
coverage_target: 75
performance_target: "<500ms event delivery (realtime-3a/3b ile aynı)"
memory_target: null
test_strategy:
  unit: 40
  integration: 50
  e2e: 10
affected_modules:
  - backend/sockets/index.js (modify — DEPARTMENT_AUTHORITY için otomatik department-queue:<department_id> join)
  - backend/sockets/emitter.js (modify — yeni emitToDepartmentQueue(departmentId, event, payload) helper)
  - backend/services/requests.service.js (modify — claimRequest ve changeRequestStatus'un OPEN→REJECTED dalı, kendi bağımsız try/catch'inde request:removedFromQueue emit edecek)
---

# ATDD — realtime-3c

## Jira Kaynağı
Jira'ya bağlı değil — yerel görev.

## Persona
- **DEPARTMENT_AUTHORITY**: kendi departmanının kuyruk (OPEN, henüz üstlenilmemiş talepler) sayfasını açık tutarken, bir meslektaşı bir talebi üstlendiğinde veya reddettiğinde, o talebin sayfa yenilemeden kuyruktan kaybolduğunu görür.
- **EMPLOYEE / ADMIN**: bu görevde erişimi/rolü yok — kuyruk canlı güncellemesi sadece DEPARTMENT_AUTHORITY'nin iş akışı (kullanıcı kararı).

## Hedef (Neden)
CLAUDE.md'nin "Real-Time 3C — authority queue live claim-removal" katmanı. Şu ana kadar bir DEPARTMENT_AUTHORITY, bir meslektaşının az önce üstlendiği/reddettiği bir talebi kendi kuyruk ekranında görmeye devam ediyordu (sayfayı yenileyene kadar) — bu, aynı talebi iki yetkilinin aynı anda üstlenmeye çalışması riskini artırıyordu (backend'de zaten atomik `WHERE status='OPEN'` koruması var, 409 döner, ama kullanıcı deneyimi kötü). Bu görev, realtime-3a/3b'nin kurduğu Socket.io altyapısını genişleterek, bir talep kuyruktan çıktığında (üstlenildiğinde veya reddedildiğinde) aynı departmandaki tüm bağlı yetkililere canlı bildirim gönderir.

## User Story
As a bir DEPARTMENT_AUTHORITY
I want kendi departmanımın kuyruk görünümünde, bir talep başka biri tarafından üstlenildiğinde veya reddedildiğinde bunu anlık olarak görebilmek
So that artık üstlenilemeyecek bir talebe boşuna tıklamayayım ve 409 hatası almayayım

## Acceptance Criteria (Given-When-Then, önceliklendirilmiş)

1. [Critical] Given geçerli bir JWT ile bağlanan bir DEPARTMENT_AUTHORITY, When Socket.io bağlantısı kurulursa, Then hiçbir client-side event beklemeden otomatik olarak kendi `department-queue:<department_id>` room'una eklenir (realtime-3b'nin `user:<id>` otomatik-join deseniyle aynı). EMPLOYEE ve ADMIN socket'ları HİÇBİR department-queue room'una otomatik eklenmez (kullanıcı kararı — bu görevde ADMIN kapsamı dışı).

2. [Critical] Given aynı departmanda bağlı iki DEPARTMENT_AUTHORITY socket'ı (`department-queue:<department_id>` room'unda), When biri OPEN bir talebi üstlenirse (`POST /api/requests/:id/assign` başarılı olursa), Then room'daki TÜM socket'lar (üstlenen dahil) `request:removedFromQueue` event'ini `{id: <requestId>}` payload'ıyla alır.

3. [Critical] Given aynı kurulum, When OPEN bir talep reddedilirse (`PATCH /api/requests/:id/status`, OPEN→REJECTED geçişi), Then aynı `request:removedFromQueue` event'i aynı room'a emit edilir (kullanıcı kararı: claim VE reject ikisi de kuyruktan kaldırma anlamına geliyor, event adı bunu kapsayacak şekilde `request:claimed` değil `request:removedFromQueue` seçildi).

4. [High] Given Departman A'da bağlı bir DEPARTMENT_AUTHORITY socket'ı, When Departman B'deki bir talep üstlenilir/reddedilirse, Then Departman A'nın socket'ı HİÇBİR event almaz (izolasyon — realtime-3a/3b'nin aynı kanıt deseni, farklı room tipi).

5. [High] Given emisyon adımı (department-queue lookup + emit), When herhangi bir sebeple hata verirse, Then sadece loglanır, üst REST fonksiyonunun başarılı dönüşünü ASLA etkilemez — realtime-3b'nin red-team dersiyle tutarlı: bu emisyon, aynı fonksiyondaki mevcut `request:updated`/`notification:created` emisyonlarından BAĞIMSIZ kendi try/catch'inde olacak (biri düşerse diğeri etkilenmeyecek).

6. [Medium] Given OPEN→ASSIGNED veya OPEN→REJECTED DIŞINDA bir geçiş (ör. ASSIGNED→IN_PROGRESS, IN_PROGRESS→COMPLETED), When gerçekleşirse, Then `request:removedFromQueue` HİÇ emit edilmez (guard gerçekten load-bearing — talep zaten kuyrukta değildi, tekrar "kaldırma" event'i anlamsız olurdu).

7. [Medium] Given bir EMPLOYEE veya ADMIN socket'ı, When herhangi bir yerde bir claim/reject gerçekleşirse, Then bu socket'lar `request:removedFromQueue` event'ini ASLA almaz (yapısal olarak kanıtlanır — hiçbir department-queue room'una hiç eklenmediler).

## Test Strategy
Unit: 40% — auto-join mantığının (sadece DEPARTMENT_AUTHORITY) izole kontrolü
Integration: 50% — `socket.io-client` ile gerçek bağlantı + gerçek Postgres'e karşı claim/reject tetikleyicileri + event dinleme (realtime-3a/3b ile aynı ağırlık)
E2E: 10% — N/A (frontend henüz yok)

## Benchmark / Başarı Ölçütü
Coverage Target: 75%
Performance Target: <500ms event teslimatı (realtime-3a/3b ile aynı)
Memory: belirtilmedi
Diğer ölçülebilir kriterler: yok

## Kapsam Dışı
- Kuyruk listesi UI/pagination/filtreleme — frontend henüz yok.
- Yeni talep oluştuğunda kuyruğa canlı ekleme — CLAUDE.md'nin lafzı sadece "removal" diyor, ekleme ayrı bir özellik (kullanıcı kararı).
- ADMIN'in kuyruk görünümü — bu görev sadece DEPARTMENT_AUTHORITY'nin kendi departman kuyruğunu kapsıyor (kullanıcı kararı).
- Öncelik/durum değişikliğinin kuyruk üzerinde başka bir canlı yansıması (ör. priority badge güncellemesi) — sadece OPEN→ASSIGNED/REJECTED kaldırması var.
- Explicit `leave:department-queue` event'i — Socket.io'nun kendi disconnect temizliğine güveniliyor (realtime-3a/3b ile tutarlı).
- Manuel doğrulama otomatik testlerin YERİNE değil, EK olarak zorunlu (kullanıcı kararı — bu da bir socket/yetkilendirme katmanı).

## Etkilenen Dosyalar/Modüller (bilinen)
- `backend/sockets/index.js` — `io.on('connection', ...)` handler'ına, `socket.user.role === 'DEPARTMENT_AUTHORITY'` ise `socket.join(\`department-queue:${socket.user.department_id}\`)` eklenecek (mevcut `user:<id>` otomatik-join'in hemen yanına).
- `backend/sockets/emitter.js` — mevcut `emitToRoom` iç helper'ı reuse edilerek yeni `emitToDepartmentQueue(departmentId, event, payload)` export edilecek (realtime-3b'nin `emitToUserRoom` deseniyle aynı).
- `backend/services/requests.service.js` — `claimRequest`'in başarılı yolu ve `changeRequestStatus`'un `OPEN→REJECTED` dalı, kendi transaction'ları commit olduktan sonra, KENDİ bağımsız try/catch'lerinde `request:removedFromQueue` emit edecek.
- Migration YOK — hiçbir şema değişikliği gerekmiyor.

## Rollback Beklentisi
`requests` tablosundaki durum değişikliği zaten kendi transaction'ı içinde commit ediliyor — bu görevin emisyon adımı (post-commit, realtime-3a/3b'deki desenle aynı) BAŞTAN kendi bağımsız try/catch'inde izole edilecek: emisyon başarısız olursa sadece loglanır, REST yanıtını hiçbir şekilde etkilemez, VE aynı fonksiyondaki diğer emisyonları (request:updated, notification:created) da etkilemez (realtime-3b'nin red-team'de bulduğu "bağımsız sinyallerin yapay olarak birbirine bağlanması" hatasını tekrarlamamak için).

## Risks
- `is_active`'in sadece handshake anında kontrol edilmesi (bağlantı boyunca değil) — realtime-3a/3b'den devralınan, zaten kabul edilmiş bir sınırlama, bu görevde tekrar değerlendirilmedi (kullanıcı kararı).

## Assumptions
- Room adı deseni `department-queue:<department_id>` — `request:<id>` (3a) ve `user:<id>` (3b) desenleriyle tutarlı, yeni bir prefix.
- Event adı `request:removedFromQueue`, payload `{id: <requestId>}` — CLAUDE.md'de bu katman için önceden tanımlanmış bir isim yoktu, plan.md aşamasında netleşen bir isim çelişkisi (claim+reject ikisi de tetikliyor ama ilk önerilen isim `request:claimed` sadece claim'i çağrıştırıyordu) kullanıcıyla çözüldü.

## Unknowns
- Yok — 12 soru (1 düzeltme sorusu dahil) ile tüm kategoriler netleşti.

## Sorular ve Cevaplar (ham kayıt)
1. Room katılım mekanizması → Otomatik (bağlantı anında, realtime-3b'nin user:<id> deseni gibi).
2. Kaldırma tetikleyicisi → Claim + Reject (OPEN→ASSIGNED VEYA OPEN→REJECTED).
3. Yeni talep canlı ekleme kapsamda mı → Hayır (orkestratörün önerisi, onaylandı).
4. Event adı/payload (ilk tur) → request:claimed { id } — SONRADAN çelişki fark edildi (claim+reject ikisini de kapsıyor ama isim sadece claim'i çağrıştırıyor).
5. Event adı düzeltmesi → request:removedFromQueue { id } olarak değiştirildi (kullanıcı onayı).
6. ADMIN'in kuyruk görünümü → Bu görevin kapsamı dışında.
7. Kabul kriteri sahibi → Evet, otomatik testler + manuel doğrulama (realtime-3a/3b ile tutarlı).
8. Benchmark → realtime-3a/3b ile aynı (<500ms, %75, 40/50/10).
9. Hata izolasyonu deseni → Evet, baştan (kendi bağımsız try/catch'inde, realtime-3b'nin dersini tekrarlamayalım).
10. Happy path senaryosu → İki DEPARTMENT_AUTHORITY aynı departmanda, biri claim ediyor.
11. Kapsam dışı → Kuyruk UI, canlı ekleme, ADMIN kapsamı, öncelik/durum canlı yansıması — hepsi kapsam dışı.
12. Bilinen risk/varsayım → realtime-3a/3b'den devralınanlar yeterli, yeni risk yok.
