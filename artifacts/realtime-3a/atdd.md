---
task_slug: realtime-3a
jira_id: null
saga_task_id: null
priority: critical
coverage_target: 75
performance_target: "<500ms event delivery (in addition to the underlying REST write's own <300ms target)"
memory_target: null
test_strategy:
  unit: 40
  integration: 50
  e2e: 10
affected_modules:
  - backend/server.js (modify — attach Socket.io to the HTTP server)
  - backend/sockets/ (new — handshake auth middleware, room-join handler, event emission helpers)
  - backend/services/requests.service.js (modify — emit request:updated/request:commented after successful writes)
  - backend/package.json (new dependency: socket.io; devDependency: socket.io-client for tests)
---

# ATDD — realtime-3a

## Jira Kaynağı
Jira'ya bağlı değil — yerel görev.

## Persona
- **EMPLOYEE**: kendi talebinin detay sayfasını açıp durum/öncelik/yorum değişikliklerini canlı görür.
- **DEPARTMENT_AUTHORITY**: kendi departmanındaki bir talebin detay sayfasını (atanmış olsun olmasın) açıp canlı güncellemeleri görür.
- **ADMIN**: herhangi bir talebin detayını açıp canlı güncellemeleri görür.

## Hedef (Neden)
CLAUDE.md'nin garanti/korunan kapsamının son parçası (Core + Analytics 2A'dan sonra). Şu ana kadar bir talebin durumu/önceliği/yorumları değiştiğinde bunu görmenin tek yolu sayfayı yenilemekti. Bu görev, talep detay sayfasını açık tutan kullanıcılara REST üzerinden yapılan değişiklikleri gerçek zamanlı olarak WebSocket ile iletiyor. CLAUDE.md'nin özellikle vurguladığı bir güvenlik prensibi burada uygulanıyor: "REST'in object-level authorization'ı WebSocket event'lerine otomatik taşınmaz" — bu görevin merkezi kaygısı budur.

## User Story
As a kimliği doğrulanmış bir kullanıcı (EMPLOYEE/DEPARTMENT_AUTHORITY/ADMIN)
I want görüntüleme yetkim olan bir talebin detay sayfasında durum/öncelik/yorum değişikliklerini sayfa yenilemeden görebilmek
So that talebi takip etmek için sürekli manuel yenileme yapmama gerek kalmasın

## Acceptance Criteria (Given-When-Then, önceliklendirilmiş)

1. [Critical] Given geçerli bir JWT (REST auth.middleware.js'deki AYNI doğrulama: `jwt.verify` + `is_active`'in DB'den taze kontrolü), When bir client Socket.io handshake'i bu JWT ile yaparsa, Then bağlantı kurulur ve socket'e `{id, role, department_id}` bilgisi (REST'teki `req.user` ile birebir aynı şekilde) eklenir.

2. [Critical] Given geçersiz, eksik veya süresi dolmuş bir JWT, When handshake denenirse, Then bağlantı tamamen reddedilir (`connect_error`), hiçbir socket kurulmaz.

3. [Critical] Given bağlı bir client, When bir talep id'si ile "join" event'i emit ederse, Then sunucu `getRequestById`'deki AYNI yetki kuralını (sahibi VEYA kendi departmanındaki DEPARTMENT_AUTHORITY VEYA ADMIN) uygular — yetkiliyse client `request:<id>` room'una eklenir.

4. [High] Given yetkisiz bir client (talebi görme yetkisi olmayan), When bu talebe join denerse, Then sunucu bir `error` event'i emit eder (net bir mesajla), client room'a eklenmez.

5. [High] Given var olmayan bir talep id'si, When join denenirse, Then bir `error` event'i emit edilir (404-eşdeğeri).

6. [Critical] Given `request:<id>` room'una join olmuş bir client, When bu talebin durumu REST üzerinden değişirse (`claimRequest` veya `changeRequestStatus` başarılı olursa), Then room'daki tüm client'lara `request:updated` event'i emit edilir — payload, `getRequestById`'in döndürdüğü tam talep nesnesiyle aynı şekil.

7. [Critical] Given `request:<id>` room'una join olmuş bir client, When bu talebin önceliği REST üzerinden değişirse (`changePriority` başarılı olursa), Then aynı room'a `request:updated` event'i emit edilir (aynı payload şekli).

8. [Critical] Given `request:<id>` room'una join olmuş bir client, When bu talebe REST üzerinden bir yorum eklenirse (`addComment` başarılı olursa), Then room'a `request:commented` event'i emit edilir — payload, `listComments`'in döndürdüğü satır şekliyle aynı (`author_name` dahil).

9. [High] Given bir talebin room'una join OLMAMIŞ bir client, When o talep için bir güncelleme/yorum event'i tetiklenirse, Then bu client HİÇBİR event almaz (izolasyon testi — gerçek room-scoping'in çalıştığını, global broadcast olmadığını kanıtlar).

10. [Medium] Given REST üzerinden başarılı bir yazma işlemi tamamlanmışsa, When ilgili event emit edilirse, Then room'daki client'lara teslimat <500ms içinde gerçekleşir.

## Test Strategy
Unit: 40% — handshake JWT doğrulama mantığı, join yetki kontrolü (mocked DB ile)
Integration: 50% — `socket.io-client` ile gerçek bir socket bağlantısı kurup gerçek Postgres'e karşı REST çağrıları + event dinleme (ağırlık burada, çünkü bu görevin asıl riski gerçek bir bağlantı+yetki+event akışı)
E2E: 10% — şimdilik **N/A** (frontend henüz yok)

## Benchmark / Başarı Ölçütü
Coverage Target: 75%
Performance Target: <500ms event teslimatı (REST yazma işleminin kendi <300ms hedefine ek)
Memory: belirtilmedi
Diğer ölçülebilir kriterler: yok

## Kapsam Dışı
- Real-Time 3B (`notification:created` event'i, canlı bildirim badge'i) — ayrı bir görev.
- Real-Time 3C (yetkili kuyruğunda canlı claim-kaldırma) — ayrı bir görev.
- Yorum düzenleme/silme canlı güncellemeleri — şema zaten bunu desteklemiyor (request-comments görevinde kilitlendi).
- Herhangi bir frontend/UI — bu görev sadece sunucu tarafı altyapı + test client'ları.
- Yeniden bağlanma (reconnection)/offline mesaj kuyruğu mantığı — Socket.io'nun kendi varsayılanlarına bırakılıyor, özel bir kod yazılmıyor.
- Room'dan açıkça "leave" event'i — Socket.io'nun disconnect'te otomatik temizlediği davranışa güveniliyor, ayrı bir AC/test yok.

## Etkilenen Dosyalar/Modüller (bilinen)
- `backend/server.js` (mevcut — HTTP server'a Socket.io eklenecek; `app.listen` yerine `http.createServer(app)` + `new Server(httpServer)` deseni gerekebilir, plan.md'de netleştirilecek)
- `backend/sockets/` (yeni — handshake auth middleware, join handler, event emission helper'ları)
- `backend/services/requests.service.js` (mevcut — `claimRequest`/`changeRequestStatus`/`changePriority`/`addComment` başarılı olduktan sonra ilgili event'i emit edecek şekilde genişletilecek)
- `backend/package.json` (yeni bağımlılık: `socket.io`; devDependency: `socket.io-client`)
- Migration YOK — hiçbir şema değişikliği gerekmiyor.

## Rollback Beklentisi
Event emisyonu, REST yazma işleminin kendi transaction'ı BAŞARIYLA COMMIT olduktan SONRA gerçekleşmeli — event emisyonunun kendisi başarısız olursa (örn. bir client bağlantısı kopmuşsa) REST yanıtını etkilememeli, sadece o event kaybolur (client bir sonraki sayfa açılışında/yenilemede güncel veriyi zaten REST'ten alır). Event emisyonu asla REST işleminin başarı/başarısızlığını belirlememeli.

## Risks
- Socket.io handshake'te `is_active`'in DB'den taze kontrolü, REST'teki gibi HER İSTEKTE değil, sadece BAĞLANTI KURULURKEN yapılabilir (WebSocket bağlantısı kalıcı, REST gibi istek-bazlı değil) — bir kullanıcı bağlıyken deaktive edilirse, mevcut bağlantısı kesilene kadar (JWT süresi dolana/reconnect olana kadar) bunu yansıtmayabilir. Bu, REST'in "her istekte taze kontrol" garantisinden daha zayıf bir garanti — CLAUDE.md bunu açıkça çözmüyor, kabul edilmiş bir sınırlama olarak not düşülüyor.
- `request:<id>` room'larının sayısı, aynı anda açık talep detay sayfası sayısıyla orantılı büyür — mevcut ölçekte (küçük kullanıcı sayısı) önemsiz.

## Assumptions
- Socket.io event isimleri tam olarak CLAUDE.md'nin API Design Principles'ta listelediği gibi: `request:updated`, `request:commented` (client→server "join" event'inin adı CLAUDE.md'de belirtilmemiş, `join:request` gibi makul bir isim seçilip plan.md'de netleştirilecek).
- Disconnect'te room temizliği Socket.io'nun kendi davranışına bırakılıyor (kullanıcı kararı, yukarıda kaydedildi) — ayrı bir AC/test yok.
- `is_active`'in socket bağlantısı süresince yeniden kontrol edilmemesi (yukarıdaki Risk) kabul edilebilir bir sınırlama olarak işaretlendi, bu görevde çözülmüyor.

## Unknowns
- Yok.

## Sorular ve Cevaplar (ham kayıt)
1. Room granularitesi → Talep-bazlı (`request:<id>`), join anında getRequestById ile aynı yetki kontrolü.
2. request:updated kapsamı → Tek event, hem status hem priority değişikliklerini kapsıyor.
3. request:commented payload'ı → Tam yorum nesnesi (author_name dahil).
4. Yetkisiz join → error event dönsün.
5. Geçersiz JWT handshake → Bağlantı tamamen reddedilsin.
6. Test stratejisi → socket.io-client ile entegrasyon testleri, ağırlık Integration'da (40/50/10).
7. Gecikme hedefi → <500ms.
8. Coverage hedefi → 75% (REST'ten düşük, WebSocket testlerinin doğası gereği).
9. Kabul kriteri sahibi → Yine manuel doğrulama gerekli (proje en yüksek güvenlik riskli katman).
10. Room ayrılma → Socket.io'nun kendi disconnect temizliğine güvenilsin, ayrı AC yok.
