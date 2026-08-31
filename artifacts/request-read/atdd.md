---
task_slug: request-read
jira_id: null
saga_task_id: null
priority: high
coverage_target: 85
performance_target: "<300ms"
memory_target: null
test_strategy:
  unit: 70
  integration: 20
  e2e: 10
affected_modules:
  - backend/routes/requests.routes.js (modify — add GET / and GET /:id)
  - backend/controllers/requests.controller.js (modify — add list/detail controllers)
  - backend/services/requests.service.js (modify — add listRequests, getRequestById)
---

# ATDD — request-read

## Jira Kaynağı
Jira'ya bağlı değil — yerel görev.

## Persona
- **EMPLOYEE**: kendi oluşturduğu taleplerin durumunu takip eder.
- **DEPARTMENT_AUTHORITY**: kendi departmanına düşen tüm talepleri (henüz kimseye atanmamışlar dahil) görüp claim edebileceklerini değerlendirir.
- **ADMIN**: sistem genelinde tüm talepleri görür (CLAUDE.md: "sees everything, manages users, system-wide dashboard").

## Hedef (Neden)
Şu ana kadar `requests` tablosuna sadece yazılabiliyordu (create/claim/status/priority), hiçbir yerden okunamıyordu. Bu görev, frontend'in ve manuel doğrulamanın ihtiyaç duyduğu ilk okuma yüzeyini (liste + detay) ekliyor — CLAUDE.md'nin object-level authorization ilkesini (her sorgu kullanıcının kendi scope'una göre filtrelenmeli) okuma tarafına da taşıyor.

## User Story
As a kullanıcı (EMPLOYEE/DEPARTMENT_AUTHORITY/ADMIN)
I want kendi rolüme uygun talepleri listeleyip detaylarını görebilmek
So that hangi taleplerin bende/departmanımda/sistemde olduğunu takip edebileyim

## Acceptance Criteria (Given-When-Then, önceliklendirilmiş)

1. [Critical] Given kimliği doğrulanmış bir EMPLOYEE, When `GET /api/requests` çağrılır, Then sadece `created_by = req.user.id` olan talepler döner (başkasının talebi asla görünmez), varsayılan sıralama `created_at DESC`.

2. [Critical] Given kimliği doğrulanmış bir DEPARTMENT_AUTHORITY, When `GET /api/requests` çağrılır, Then `department_id = req.user.department_id` olan TÜM talepler döner — sadece kendine atanmışlar değil, henüz kimseye atanmamış (`OPEN`) olanlar da dahil (claim edebilmesi için görmesi gerekiyor).

3. [Critical] Given kimliği doğrulanmış bir ADMIN, When `GET /api/requests` çağrılır, Then hiçbir department/created_by/assigned_to filtresi olmadan sistemdeki TÜM talepler döner.

4. [High] Given herhangi bir rol, When `GET /api/requests?status=OPEN` (veya başka bir geçerli status değeri) çağrılır, Then o rolün zaten sahip olduğu scope'un İÇİNDE ek bir `status` filtresi uygulanır — filtre asla rolün scope'unu genişletemez (örn. bir EMPLOYEE `?status=` ile başkasının talebini göremez).

5. [Critical] Given bir talebi oluşturan EMPLOYEE, When `GET /api/requests/:id` kendi talebi için çağrılır, Then `200` ile tam talep detayı döner.

6. [High] Given bir DEPARTMENT_AUTHORITY (talebe atanmış olsun olmasın), When `GET /api/requests/:id` kendi departmanındaki bir talep için çağrılır, Then `200` ile tam talep detayı döner.

7. [High] Given bir ADMIN, When `GET /api/requests/:id` herhangi bir talep için çağrılır, Then `200` ile tam talep detayı döner.

8. [High] Given yetkisiz bir kullanıcı (talebi oluşturmayan bir EMPLOYEE, veya farklı departmandan bir DEPARTMENT_AUTHORITY), When `GET /api/requests/:id` bu talep için çağrılır, Then `403` döner (talebin var olup olmadığı sızdırılmaz bir şekilde gizlenmiyor — kullanıcının seçimiyle açık `403` kullanılıyor, `404` değil).

9. [Medium] Given var olmayan bir `id`, When `GET /api/requests/:id` çağrılır, Then `404` döner.

10. [High] Given bir talep, When liste veya detay endpoint'i çağrılır, Then response'ta hesaplanmış bir `is_overdue` boolean alanı bulunur: `sla_due_at < now() AND status NOT IN ('COMPLETED', 'REJECTED')` — terminal durumdaki (`COMPLETED`/`REJECTED`) talepler, `sla_due_at`'ları geçmiş olsa bile her zaman `is_overdue: false` döner.

11. [High] Given liste veya detay response'u, When döndürülür, Then ham `request_type_id`/`department_id`/`created_by`/`assigned_to` UUID'lerinin yanında okunabilir join'lenmiş alanlar da bulunur: `request_type_name`, `department_name`, `created_by_name`, `assigned_to_name` (assigned_to null ise bu alan da null).

## Test Strategy
Unit: 70% — scope/filtreleme mantığı (rol bazlı WHERE koşulu seçimi, `is_overdue` hesaplaması), mocked DB ile
Integration: 20% — gerçek Postgres'e karşı `GET /api/requests` ve `GET /api/requests/:id`, üç rol + `?status=` filtresi + yetkisiz erişim senaryoları
E2E: 10% — şimdilik **N/A** (frontend henüz yok)

## Benchmark / Başarı Ölçütü
Coverage Target: 85%
Performance Target: <300ms
Memory: belirtilmedi
Diğer ölçülebilir kriterler: join'lü sorgular olmasına rağmen hedefin altında kalınmalı (mevcut veri hacmi küçük).

## Kapsam Dışı
- Pagination (`?page=`/`?limit=`) — bu görevde yok, veri hacmi küçük, ayrı bir göreve bırakıldı.
- Varsayılan sıralamadan başka sıralama seçenekleri (`?sort=`) — sadece `created_at DESC` sabit.
- `request_comments`, `notifications` okuma endpoint'leri — ayrı görevler.
- Herhangi bir yazma/mutasyon — bu görev salt okunur.
- Analytics/dashboard sorguları (özet kartlar, SLA compliance oranları vb.) — Analytics 2A'nın kapsamı, bu görev değil.

## Etkilenen Dosyalar/Modüller (bilinen)
- `backend/routes/requests.routes.js` (mevcut — `GET /` ve `GET /:id` eklenecek)
- `backend/controllers/requests.controller.js` (mevcut — `getRequests`/`getRequestById` eklenecek)
- `backend/services/requests.service.js` (mevcut — `listRequests`/`getRequestById` eklenecek, mevcut 4 write fonksiyonuna dokunulmayacak)
- Migration YOK — `requests`/`request_types`/`departments`/`users` tabloları zaten hazır, sadece SELECT + JOIN.

## Rollback Beklentisi
Salt okunur endpoint'ler, transaction/rollback kavramı yok. DB hatası olursa (bağlantı sorunu vb.) generic 500 dönmeli — mevcut `auth.service.js`/`requests.service.js`'deki DB-hata sanitizasyon deseniyle tutarlı (ham driver hatası asla client'a sızmamalı).

## Risks
- `is_overdue` hesaplaması sunucu saatine (`now()`) dayanıyor — istemci ile sunucu arasında saat farkı varsa (olmamalı, aynı makinede/aynı timezone'da çalışıyoruz ama production'da farklı olabilir) küçük bir tutarsızlık riski var; bu MVP için kabul edilebilir, DB'nin kendi `now()`'ını kullanmak (uygulama katmanının saatini değil) bu riski zaten minimize ediyor.
- Join'li sorgular, talep sayısı arttıkça (pagination olmadan) performansı etkileyebilir — şu an için kabul edilebilir risk, pagination ayrı bir görevde ele alınacak.

## Assumptions
- `is_overdue` hesaplaması DB tarafında (SQL `CASE WHEN` veya benzeri) yapılacak, `now()` DB'nin kendi saatini kullanacak — uygulama kodunda `new Date()` ile karşılaştırma yapılmayacak (tutarlılık için).
- `assigned_to_name` gibi join'lenmiş alanlar `users` tablosundan `name`+`surname` birleştirilerek oluşturulacak (auth'taki `toPublicUser` deseninin izinden).

## Unknowns
- Yok — CLAUDE.md ve bu oturumdaki sorularla kapsam tam netleşti.

## Sorular ve Cevaplar (ham kayıt)
1. Endpoint kapsamı → Standart: GET /api/requests (scope'lu liste, opsiyonel ?status=) + GET /api/requests/:id, pagination bu görevde yok.
2. EMPLOYEE liste scope'u → Sadece kendi oluşturdukları.
3. DEPARTMENT_AUTHORITY liste scope'u → Kendi departmanının tüm talepleri (OPEN dahil).
4. ADMIN liste scope'u → Tüm talepler, sistem genelinde.
5. Detay yetkisi → Oluşturan EMPLOYEE, kendi departmanındaki herhangi bir DEPARTMENT_AUTHORITY, veya ADMIN.
6. Yetkisiz erişim yanıtı → 403 (404 değil).
7. Response şekli → Join'lenmiş, okunabilir alanlar (ham ID'lerin yanında).
8. Overdue hesaplaması → Evet, `is_overdue` alanı eklenecek.
9. Varsayılan sıralama → En yeni önce (created_at DESC).
10. Coverage hedefi → 85%.
11. Performans hedefi → <300ms.
12. Kabul kriteri sahibi → Otomatik testler + /verify + /red-team yeterli, bu sefer ayrıca manuel Postman testi ZORUNLU değil (read-only, state değiştirmiyor).
