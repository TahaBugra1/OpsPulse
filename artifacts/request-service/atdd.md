---
task_slug: request-service
jira_id: null
saga_task_id: null
priority: critical
coverage_target: 85
performance_target: "<300ms"
memory_target: null
test_strategy:
  unit: 70
  integration: 20
  e2e: 10
affected_modules:
  - backend/routes/requests.routes.js (new)
  - backend/controllers/requests.controller.js (new)
  - backend/services/requests.service.js (new — createRequest, claimRequest, changeRequestStatus, changePriority)
  - backend/middleware/auth.middleware.js (existing — mounted for the first time, protects all /api/requests routes)
  - backend/server.js (mount /api/requests routes behind auth.middleware.js)
  - backend/services/db.js (existing pg Pool, reused — transactions via pool.connect())
  - db/schema.sql (read-only — requests/request_types/request_history/notifications tables already exist, no migration)
---

# ATDD — request-service

## Jira Kaynağı
Jira'ya bağlı değil — yerel görev. `jira-sync` bu projede kullanılmıyor.

## Persona
- **EMPLOYEE**: yeni bir talep (request) oluşturur.
- **DEPARTMENT_AUTHORITY**: kendi departmanına düşen açık talepleri claim eder, durumunu ilerletir, önceliğini değiştirir, reddeder.
- **ADMIN**: bu görevde write yetkisi yok (görüntüleme/kullanıcı yönetimi ayrı bir kapsam) — CLAUDE.md'nin "sees everything, manages users" tanımı bu görevin dört yazma fonksiyonuna genişletilmiyor.

## Hedef (Neden)
Bu, `requests` tablosuna yazan **tek merkezi giriş noktası** — CLAUDE.md'nin "Centralize writes" kuralı gereği, ileride eklenecek her yeni endpoint/AI özelliği/real-time tetikleyici bu dört fonksiyonu çağırmak zorunda. State machine, atomik claim, audit trail (`request_history`) ve SLA hesaplama garantisi burada kuruluyor.

## User Story
As a çalışan (EMPLOYEE)
I want IT/HR/Finance ile ilgili bir talep oluşturabilmek
So that departman yetkilileri bu talebi görüp işleme alabilsin

As a departman yetkilisi (DEPARTMENT_AUTHORITY)
I want kendi departmanıma düşen açık talepleri claim edip durumunu/önceliğini yönetebilmek
So that talepler denetlenebilir, çakışmasız bir şekilde ilerlesin

## Acceptance Criteria (Given-When-Then, önceliklendirilmiş)

1. [Critical] Given kimliği doğrulanmış bir EMPLOYEE ve geçerli/aktif bir `request_type_id`, When `POST /api/requests` `{title, description, request_type_id, priority?}` ile çağrılır, Then `department_id` sunucu tarafında `request_types.department_id`'den (client'tan asla kabul edilmeden) çözülür, `sla_due_at` priority'ye göre hesaplanır (`created_at` + HIGH=4h/MEDIUM=24h/LOW=72h), `status='OPEN'`/`assigned_to=null` ile INSERT edilir, `request_history`'e `CREATED` kaydı düşer — **INSERT + history log tek DB transaction'ı içinde**, 201 ile tam request nesnesi döner.

2. [Critical] Given `OPEN` durumundaki bir request ve o request'in `department_id`'sindeki bir DEPARTMENT_AUTHORITY, When `POST /api/requests/:id/assign` çağrılır, Then atomik conditional UPDATE (`WHERE id=$1 AND status='OPEN'`) ile `status='ASSIGNED'`/`assigned_to=<officer>` set edilir, `request_history`'e `STATUS_CHANGED` (`OPEN`→`ASSIGNED`) kaydı düşer, request'i oluşturan kullanıcıya `REQUEST_ASSIGNED` notification'ı oluşturulur, 200 ile güncel request nesnesi döner.

3. [Critical] Given aynı `OPEN` request'e eşzamanlı iki claim denemesi, When ikinci `POST /api/requests/:id/assign` çağrısı çalıştığında request artık `OPEN` değildir, Then conditional UPDATE 0 satır etkiler, 409 Conflict ("already claimed") döner — select-then-update değil, CLAUDE.md'nin "WHERE clause'a beklenen mevcut state'i koy" deseni.

4. [High] Given bir DEPARTMENT_AUTHORITY ve kendi departmanına ait OLMAYAN bir `OPEN` request, When bu officer `POST /api/requests/:id/assign` çağırır, Then 403 döner (object-level authorization — `assigned user.department_id === request.department_id` service katmanında kontrol edilir), request değişmez.

5. [High] Given `ASSIGNED` durumundaki bir request ve o request'in `assigned_to`'su olan officer, When `PATCH /api/requests/:id/status` `{status:'IN_PROGRESS'}` ile çağrılır, Then conditional UPDATE (`WHERE id=$1 AND status='ASSIGNED' AND assigned_to=$2`) ile geçiş yapılır, `request_history`'e `STATUS_CHANGED` kaydı düşer, 200 döner.

6. [Critical] Given locked state machine (`OPEN→ASSIGNED`, `OPEN→REJECTED`, `ASSIGNED→IN_PROGRESS`, `ASSIGNED→REJECTED`, `IN_PROGRESS→COMPLETED`, `IN_PROGRESS→REJECTED`), When `PATCH /api/requests/:id/status` bu listede olmayan bir geçiş için çağrılır (örn. `COMPLETED→IN_PROGRESS`, `OPEN→IN_PROGRESS`, herhangi bir reopen), Then 400/409 döner, `request_history`'e hiçbir satır yazılmaz, `assigned_to`/`status` değişmez.

7. [High] Given `REJECTED`'e geçiş isteyen bir çağrı, When `note` alanı boş/eksik gönderilirse, Then 400 döner ("Red sebebi belirtilmeli") — service katmanında birincil enforcement, DB'deki CHECK constraint sadece backstop.

8. [High] Given red yetkisi: `OPEN→REJECTED` request'in `department_id`'sindeki HERHANGİ bir DEPARTMENT_AUTHORITY tarafından tetiklenebilir (henüz atanmamış); `ASSIGNED→REJECTED`/`IN_PROGRESS→REJECTED` SADECE o an `assigned_to` olan officer tarafından tetiklenebilir. Given bu kurala uymayan bir çağrı (örn. atanmamış bir officer, ASSIGNED bir request'i reddetmeye çalışırsa), When `PATCH /api/requests/:id/status` çağrılır, Then 403 döner.

9. [High] Given `ASSIGNED`/`IN_PROGRESS` durumundaki bir request ve o request'in `assigned_to`'su olan officer, When `PATCH /api/requests/:id/priority` `{priority:'HIGH'}` ile çağrılır, Then priority güncellenir, `sla_due_at` **orijinal `created_at`'e göre** (şu ana göre değil) yeniden hesaplanır, `request_history`'e `PRIORITY_CHANGED` (`old_value`/`new_value`) kaydı düşer, 200 döner.

10. [High] Given `OPEN` (henüz assign edilmemiş) bir request, When herhangi bir DEPARTMENT_AUTHORITY `PATCH /api/requests/:id/priority` çağırırsa (atanmış officer olsun olmasın), Then 403/409 döner — priority değişikliği sadece atanmış officer'a özel, department genelinde değil.

11. [Medium] Given geçersiz (`request_types` tablosunda olmayan) bir `request_type_id`, When `POST /api/requests` çağrılır, Then 404 döner, satır eklenmez. Given var olan ama `is_active=false` bir `request_type_id`, When `POST /api/requests` çağrılır, Then 400 döner, satır eklenmez.

12. [Medium] Given `createRequest`'in transaction'ı içinde bir adımda (INSERT veya history log) DB hatası oluşursa, When `POST /api/requests` çağrılır, Then transaction tamamen ROLLBACK edilir, 500 generic mesajıyla döner, DB'de yarım kalan (request var ama history yok gibi) hiçbir state oluşmaz.

## Test Strategy
Unit: 70% — `requests.service.js`'deki state-machine/authorization/SLA-hesaplama mantığı (mocked DB ile)
Integration: 20% — gerçek (yerel) Postgres'e karşı `POST /api/requests`, `POST /api/requests/:id/assign`, `PATCH /api/requests/:id/status`, `PATCH /api/requests/:id/priority` uçtan uca, transaction/rollback davranışı dahil
E2E: 10% — şimdilik **N/A** (frontend henüz yok, auth görevindeki gibi)

## Benchmark / Başarı Ölçütü
Coverage Target: 85%
Performance Target: <300ms (yerel/dev ortamda, tüm endpoint'ler için)
Memory: belirtilmedi
Diğer ölçülebilir kriterler: atomik claim/status/priority conditional UPDATE'leri her zaman "WHERE clause'a beklenen state" deseniyle yazılmalı — hiçbir double-click aynı history event'ini iki kez yazmamalı.

## Kapsam Dışı
- ADMIN'in bu 4 fonksiyonda department-scoping'i bypass etmesi — ayrı bir görev, bu görevde ADMIN write yapamıyor.
- `request_comments` (yorumlar) — bu görevin dört fonksiyonunun kapsamında değil, ayrı bir görev.
- `COMMENT_ADDED` notification type'ı — yorumlar özelliği olmadan tetiklenemez, kapsam dışı.
- Reopen — proje genelinde kapsam dışı (CLAUDE.md), bu görevde de yok.
- Multi-department requests, file attachments — proje genelinde kapsam dışı.
- Otomatik/cron-based SLA escalation — `sla_due_at` sadece hesaplanıyor, okunuyor; hiçbir arka plan job'ı tetiklenmiyor (CLAUDE.md: "No cron job reads it yet").
- Request DELETE — hiçbir zaman olmayacak (CLAUDE.md).
- Generic bypasslanabilir bir PATCH — sadece CLAUDE.md'nin belirttiği operation-specific endpoint'ler (`/assign`, `/status`, `/priority`) var, `status`/`assigned_to` başka hiçbir yoldan set edilemez.

## Etkilenen Dosyalar/Modüller (bilinen)
- `backend/routes/requests.routes.js` (yeni)
- `backend/controllers/requests.controller.js` (yeni)
- `backend/services/requests.service.js` (yeni)
- `backend/middleware/auth.middleware.js` (mevcut — bu görevde ilk kez gerçekten bir route'a bağlanıyor)
- `backend/server.js` (yeni route'ları `auth.middleware.js` arkasında mount etmek için düzenlenecek)
- `backend/services/db.js` (mevcut pool, transaction için `pool.connect()` ile reuse edilecek)
- `db/schema.sql` (mevcut `requests`/`request_types`/`request_history`/`notifications` tabloları okunacak, migration YOK)

## Rollback Beklentisi
`createRequest`'in INSERT + history log adımları tek DB transaction'ı içinde — herhangi bir adım başarısız olursa `ROLLBACK`, hiçbir yarım state kalmaz (AC12). Diğer üç fonksiyon (`claimRequest`, `changeRequestStatus`, `changePriority`) tek satırlık conditional UPDATE + tek history INSERT olduğu için benzer şekilde transaction içine alınacak (aynı ilke, "audit trail her zaman tutarlı olmalı").

## Risks
- `pool.connect()` ile alınan transaction client'ının her fonksiyonda düzgün `release()` edilmesi kritik — edilmezse connection pool tükenir (bağlantı sızıntısı). Implementasyonda `finally` bloğuyla garanti altına alınmalı.
- `changeRequestStatus`'un tek generic endpoint olması (`PATCH /:id/status`, body'de hedef status), CLAUDE.md'nin "operation-specific endpoint" ilkesiyle sınırda — ama CLAUDE.md bunu API Design Principles'ta zaten bu şekilde (tek `/status` endpoint'i) tanımlıyor, service katmanındaki state-machine kontrolü bunun "bypasslanabilir generic PATCH" olmasını engelliyor.

## Assumptions
- `REQUEST_ASSIGNED` notification'ı, claim eden officer'a değil, **request'i oluşturan EMPLOYEE'ye** gidiyor (kendi talebinin durumundan haberdar olması için) — CLAUDE.md'de alıcı açıkça belirtilmemiş, mantıklı varsayım.
- `changeRequestStatus`'ta `COMPLETED`/`REJECTED` durumuna geçişte de benzer bir notification (`REQUEST_COMPLETED`/`REQUEST_REJECTED`) oluşturulacak, alıcı yine request'i oluşturan EMPLOYEE — notifications şeması bunu zaten öngörüyor.
- Transaction implementasyonu için `pg`'nin `pool.connect()` + `client.query('BEGIN'/'COMMIT'/'ROLLBACK')` deseni kullanılacak (ek bir paket gerekmiyor, `pg` zaten yüklü).

## Unknowns
- Yok — CLAUDE.md ve bu oturumdaki sorularla kapsam tam netleşti.

## Sorular ve Cevaplar (ham kayıt)
1. createRequest happy path alan/response kontratı → Standart: {title, description, request_type_id, priority?}, response tam request nesnesi.
2. Geçersiz/inactive request_type_id → 404 (yok) / 400 (inactive), her ikisi de reddedilsin.
3. changeRequestStatus yetki modeli → OPEN→REJECTED: department genelinde herhangi bir officer; sonraki tüm geçişler: sadece atanmış officer.
4. changePriority yetkisi → Sadece atanmış DEPARTMENT_AUTHORITY (OPEN request'te priority değiştirilemez).
5. ADMIN write yetkisi → Bu görevde ADMIN write yapamıyor, department-scoping bypass'ı yok.
6. Notifications kapsamda mı → Evet, claim/status-complete/status-reject'te oluşturulacak.
7. Coverage hedefi → 85%.
8. Performans hedefi → <300ms.
9. Test stratejisi → 70/20/10 onaylandı (E2E N/A).
10. Kabul kriteri sahibi → Otomatik testler + /verify + /red-team yeterli DEĞİL, ayrıca manuel Postman doğrulaması da gerekiyor (auth görevindeki gibi).
11. Transaction beklentisi → Tek DB transaction'ı içinde, kısmi state asla oluşmamalı.
