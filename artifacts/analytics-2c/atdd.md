---
task_slug: analytics-2c
jira_id: null
saga_task_id: null
priority: medium
coverage_target: 85
performance_target: "<300ms"
memory_target: null
test_strategy:
  unit: 70
  integration: 20
  e2e: 10
affected_modules:
  - backend/services/analytics.service.js (modify — yeni getBottlenecks fonksiyonu)
  - backend/controllers/analytics.controller.js (modify — yeni getBottlenecksHandler)
  - backend/routes/analytics.routes.js (modify — yeni GET /bottlenecks satırı)
---

# ATDD — analytics-2c

## Jira Kaynağı
Jira'ya bağlı değil — yerel görev.

## Persona
- **EMPLOYEE**: bu görevde erişimi yok (analytics-2a/2b ile tutarlı, `403`).
- **DEPARTMENT_AUTHORITY**: kendi departmanının darboğaz/aşırı yüklenme görünümünü görür (SLA ihlali yoğunluğu, aşama-içi süreler, kendi departmanındaki yetkililerin iş yükü karşılaştırması).
- **ADMIN**: sistem geneli darboğaz/aşırı yüklenme görünümünü görür.

## Hedef (Neden)
CLAUDE.md'nin upgrade layer sırasındaki son analytics katmanı — "bottleneck/overload detection". Analytics 2A (özet/SLA/iş yükü) ve 2B (dağılım/hacim) operasyonel görünürlük sağlıyordu; bu görev bunun üstüne "nerede tıkanıyoruz, kim aşırı yüklü" sorularına doğrudan cevap veren türetilmiş bir görünüm ekliyor — CLAUDE.md'nin fallback sırasında Real-Time 3C'den daha korunaklı bir katman olarak işaretlendiği için önceliklendirildi.

## User Story
As a kimliği doğrulanmış bir DEPARTMENT_AUTHORITY veya ADMIN
I want kendi kapsamımdaki SLA ihlali yoğunluğunu, taleplerin hangi aşamada en çok beklediğini ve hangi yetkilinin en çok aktif talebi olduğunu görebilmek
So that darboğazları ve aşırı yüklenmiş kişileri erken fark edip operasyonel önlem alabileyim

## Acceptance Criteria (Given-When-Then, önceliklendirilmiş)

1. [Critical] Given kimliği doğrulanmış bir ADMIN, When `GET /api/analytics/bottlenecks` çağrılırsa, Then 200 döner ve response `slaBreachByDepartment` (her aktif departmanın, `sla_due_at < now() AND status NOT IN ('COMPLETED','REJECTED')` koşuluna uyan talep sayısı, 0 dahil tüm departmanlar) ve `slaBreachByRequestType` (her aktif request_type için aynı sayı, 0 dahil) içerir.

2. [Critical] Given aynı istek, When çağrılırsa, Then response ayrıca `stageDurations` içerir: tam olarak 3 giriş (`OPEN_TO_ASSIGNED`, `ASSIGNED_TO_IN_PROGRESS`, `IN_PROGRESS_TO_COMPLETED`), her biri `avg_hours` alanıyla (o aşama için gerçekleşmiş TÜM geçişlerin ortalama süresi, saat cinsinden, 2 ondalık basamağa yuvarlanmış — `getSla`'nın `avg_resolution_hours` yuvarlama deseniyle birebir aynı).

3. [Critical] Given aynı istek, When çağrılırsa, Then response ayrıca `authorityWorkload` içerir: kapsamdaki HER `DEPARTMENT_AUTHORITY` için `{authority_name, department_name, active_count}` (aktif = `status IN ('ASSIGNED','IN_PROGRESS')` olan, o yetkiliye atanmış talep sayısı), `active_count`'a göre azalan sırada, 0 aktif talebi olan yetkililer de dahil.

4. [Critical] Given kimliği doğrulanmış bir EMPLOYEE, When `GET /api/analytics/bottlenecks` çağrılırsa, Then `403` döner (analytics-2a/2b'nin `scopeToDepartment()` davranışıyla birebir aynı, DEĞİŞTİRİLMEDEN reuse edilir).

5. [Critical] Given kimliği doğrulanmış bir DEPARTMENT_AUTHORITY, When aynı endpoint çağrılırsa, Then `slaBreachByDepartment` tam olarak 1 satır (kendi departmanı), `slaBreachByRequestType` sadece kendi departmanının aktif türleri, `authorityWorkload` sadece kendi departmanındaki yetkililer içerir.

6. [High] Given bir DEPARTMENT_AUTHORITY'nin hiç aktif (ASSIGNED/IN_PROGRESS) talebi yoksa, When `authorityWorkload` hesaplanırsa, Then bu yetkili yine listede `active_count: 0` ile görünür (eksik anahtar yok).

7. [High] Given bir aşama geçişi (ör. `IN_PROGRESS_TO_COMPLETED`) için hiç gerçekleşmiş geçiş yoksa (kapsamda hiç tamamlanmış talep yok), When `stageDurations` hesaplanırsa, Then o aşamanın `avg_hours` değeri `null` döner (0 değil — `getSla`'nın `avg_resolution_hours: null` deseniyle tutarlı), hata fırlatılmaz.

8. [Medium] Given kapsamda (departman/sistem) hiç talep yoksa, When endpoint çağrılırsa, Then 200 döner, `slaBreachByDepartment`/`slaBreachByRequestType` tüm kategorilerde 0, `stageDurations`'ın 3 aşaması da `null`, `authorityWorkload` (varsa yetkili) 0 ile listelenir — hata fırlatılmaz.

## Test Strategy
Unit: 70% — `getBottlenecks`'in kırılım/aşama-süre/iş yükü hesaplama mantığı
Integration: 20% — gerçek Postgres'e karşı rol-bazlı kapsam senaryoları (EMPLOYEE/DEPARTMENT_AUTHORITY/ADMIN), sıfır-veri senaryosu
E2E: 10% — N/A (frontend henüz yok)

## Benchmark / Başarı Ölçütü
Coverage Target: 85%
Performance Target: <300ms (analytics-2a/2b ile aynı)
Memory: belirtilmedi
Diğer ölçülebilir kriterler: yok

## Kapsam Dışı
- Otomatik eşitleme/aksiyon (ör. aşırı yüklü yetkiliye otomatik talep yönlendirme) — CLAUDE.md'nin genel "otomatik/cron-based SLA escalation" kapsam dışı kararıyla aynı ruhta, bu salt görünürlük sağlar, aksiyon almaz.
- Bildirim/uyarı (ör. yöneticiye "departman tıkandı" bildirimi) — Real-Time 3B'nin bildirim altyapısına bağlamak kapsam dışı, ayrı bir konu.
- Frontend chart/UI bileşeni — frontend henüz yok.
- Özel tarih aralığı/filtreleme — bu görev "an itibarıyla" anlık bir görünüm, analytics-2b'deki gibi tarih aralığı seçimi yok.
- Manuel doğrulama — bu salt-okunur, state değiştirmeyen bir endpoint, otomatik testler yeterli kabul edildi (analytics-2b ile aynı karar).

## Etkilenen Dosyalar/Modüller (bilinen)
- `backend/services/analytics.service.js` — yeni `getBottlenecks(user)` fonksiyonu (mevcut `getSummary`/`getSla`/`getWorkload`/`getDistribution`'ın yanına).
- `backend/controllers/analytics.controller.js` — yeni `getBottlenecksHandler`.
- `backend/routes/analytics.routes.js` — yeni `router.get('/bottlenecks', getBottlenecksHandler)` satırı.
- Migration YOK — hiçbir şema değişikliği gerekmiyor (mevcut `requests`/`request_history`/`users` tablolarından türetiliyor).

## Rollback Beklentisi
Salt-okunur bir endpoint — hiçbir veri yazılmıyor, hata durumunda (DB sorgu hatası) uygun HTTP status kodu (500) ve hata mesajı döner, mevcut `fail()` desenine uygun. Rollback kavramı bu görev için geçerli değil.

## Risks
- analytics-2a/2b'den devralınan desenler yeterli kabul edildi, bu görevde yeni bir risk tanımlanmadı (kullanıcı kararı).

## Assumptions
- `stageDurations`'ın hesaplanması `request_history`'nin `STATUS_CHANGED` satırlarına dayanır: `OPEN_TO_ASSIGNED` = claim anındaki `STATUS_CHANGED (OPEN→ASSIGNED)` satırının `created_at`'i eksi `requests.created_at`; `ASSIGNED_TO_IN_PROGRESS` ve `IN_PROGRESS_TO_COMPLETED` de ardışık `STATUS_CHANGED` satırları arasındaki fark — plan.md aşamasında kesin SQL netleşecek.
- Response şekli (alan adları: `slaBreachByDepartment`, `slaBreachByRequestType`, `stageDurations`, `authorityWorkload`) burada kavramsal olarak belirtildi, plan.md'de kesinleşecek.
- `authorityWorkload`'ın `department_name` alanı ADMIN görünümünde departmanlar arası ayrım için var; DEPARTMENT_AUTHORITY görünümünde tüm satırlar zaten aynı departmana ait olacak (redundant ama tutarlılık için kaldırılmadı).

## Unknowns
- Yok — 12 soru ile tüm kategoriler netleşti.

## Sorular ve Cevaplar (ham kayıt)
1. Darboğaz tanımı → SLA ihlali yoğunluğu + aşama-içi süre (ikisi de).
2. Aşırı yükleme tanımı → Kişi bazında (DEPARTMENT_AUTHORITY'nin aktif talep sayısı).
3. Endpoint adı → `GET /api/analytics/bottlenecks`.
4. Rol bazlı kapsam → analytics-2a/2b ile aynı desen (`scopeToDepartment()` reuse).
5. Happy path → ADMIN, sistem geneli darboğaz+aşırı yükleme görünümü.
6. Sıfır yük edge case → 0 aktif talepli yetkililer 0 ile listelenir.
7. Veri yok edge case (aşama süresi) → `null` (getSla'nın avg_resolution_hours deseniyle tutarlı).
8. Benchmark → analytics-2a/2b ile aynı (<300ms, %85, 70/20/10).
9. Kapsam dışı → otomatik aksiyon, bildirim, frontend, özel tarih aralığı — hepsi kapsam dışı.
10. Kabul kriteri sahibi → Otomatik testler yeterli, manuel doğrulama gerekmiyor.
11. Etkilenen dosyalar → Mevcut 3 dosyaya ekleme (yeni dosya yok).
12. Bilinen risk/varsayım → analytics-2a/2b'den devralınanlar yeterli, yeni risk yok.
