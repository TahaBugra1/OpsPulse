---
task_slug: analytics-2a
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
  - backend/routes/analytics.routes.js (new)
  - backend/controllers/analytics.controller.js (new)
  - backend/services/analytics.service.js (new)
  - backend/server.js (modify — mount /api/analytics behind authMiddleware)
---

# ATDD — analytics-2a

## Jira Kaynağı
Jira'ya bağlı değil — yerel görev.

## Persona
- **ADMIN**: sistem geneli özet/istatistik görür (CLAUDE.md: "system-wide dashboard").
- **DEPARTMENT_AUTHORITY**: sadece kendi departmanının özet/istatistiğini görür.
- **EMPLOYEE**: bu görevde erişimi yok — analytics bir yönetim/gözetim özelliği.

## Hedef (Neden)
CLAUDE.md'nin garanti/korunan kapsamının bir parçası (Core'dan sonraki ilk katman). Şu ana kadar sistemde ne olduğunu görmenin tek yolu DB'ye elle sorgu atmaktı — bu görev, dashboard için gereken sayısal özetleri (kaç açık talep, SLA uyumu, departman iş yükü) API üzerinden sunuyor. Şema değişikliği yok, sadece mevcut `requests`/`request_history`/`departments` tablolarından türetilen salt-okunur sorgular.

## User Story
As a ADMIN veya DEPARTMENT_AUTHORITY
I want sistem genelinde veya kendi departmanımda kaç talep hangi durumda, SLA uyumu ne durumda, hangi departman ne kadar yüklü görebilmek
So that operasyonel durumu tek bakışta değerlendirebileyim

## Acceptance Criteria (Given-When-Then, önceliklendirilmiş)

1. [Critical] Given ADMIN, When `GET /api/analytics/summary` çağrılır, Then sistem genelinde (filtresiz) `{ total_open, total_assigned, total_in_progress, total_completed, total_rejected, total_overdue }` döner — `total_overdue`, request-read'deki `is_overdue` mantığıyla tutarlı (`sla_due_at < now() AND status NOT IN ('COMPLETED','REJECTED')`).

2. [Critical] Given DEPARTMENT_AUTHORITY, When `GET /api/analytics/summary` çağrılır, Then aynı şekil, ama sadece `department_id = user.department_id` olan taleplere göre hesaplanır.

3. [High] Given EMPLOYEE, When `GET /api/analytics/summary` çağrılır, Then `403` döner.

4. [Critical] Given ADMIN, When `GET /api/analytics/sla` çağrılır, Then sistem genelinde `{ compliance_rate, avg_resolution_hours }` döner — SADECE `COMPLETED` talepler üzerinden hesaplanır; "tamamlanma anı" `requests.updated_at`'ten DEĞİL, `request_history`'deki en son `action='STATUS_CHANGED' AND new_value='COMPLETED'` satırının `created_at`'inden alınır. `compliance_rate` = (tamamlanma anı `sla_due_at`'i geçmemiş COMPLETED talep sayısı / toplam COMPLETED talep sayısı) × 100. `avg_resolution_hours` = ortalama (tamamlanma anı − `created_at`) saat cinsinden.

5. [High] Given DEPARTMENT_AUTHORITY, When `GET /api/analytics/sla` çağrılır, Then aynı hesaplama, sadece kendi departmanının `COMPLETED` talepleri üzerinden.

6. [Medium] Given ilgili scope'ta (sistem geneli veya departman) hiç `COMPLETED` talep yoksa, When `GET /api/analytics/sla` çağrılır, Then `{ compliance_rate: 0, avg_resolution_hours: null }` döner — 0'a bölme hatası oluşmaz.

7. [Critical] Given ADMIN, When `GET /api/analytics/workload` çağrılır, Then her departman için `{ department_name, open, assigned, in_progress, completed, rejected }` içeren bir dizi döner (tüm departmanlar, sistem geneli).

8. [High] Given DEPARTMENT_AUTHORITY, When `GET /api/analytics/workload` çağrılır, Then dizi sadece kendi departmanının satırını içerir.

9. [High] Given EMPLOYEE, When `GET /api/analytics/sla` veya `GET /api/analytics/workload` çağrılır, Then her ikisi de `403` döner (AC3'ün aynısı, diğer iki endpoint için).

10. [Medium] Given bir DB hatası (bağlantı sorunu vb.), When bu 3 endpoint'ten biri çağrılır, Then generic `500` mesajı döner, ham driver hatası asla client'a sızmaz — mevcut `fail()`/sanitizasyon deseniyle tutarlı.

11. [Medium] Given mevcut veri hacmi, When bu 3 endpoint çağrılır, Then yanıt süresi <300ms olmalı (aggregate/GROUP BY sorguları index'li kolonlar — `status`, `department_id` — üzerinden çalışıyor).

## Test Strategy
Unit: 70% — scope/hesaplama mantığı (mocked DB ile), özellikle SLA'nın `request_history`'den doğru satırı seçmesi ve 0-completed edge case'i
Integration: 20% — gerçek Postgres'e karşı 3 endpoint, ADMIN/DEPARTMENT_AUTHORITY/EMPLOYEE senaryoları
E2E: 10% — şimdilik **N/A** (frontend henüz yok)

## Benchmark / Başarı Ölçütü
Coverage Target: 85%
Performance Target: <300ms
Memory: belirtilmedi
Diğer ölçülebilir kriterler: yok

## Kapsam Dışı
- Dağılım grafikleri, zaman içinde hacim (`distribution`) — Analytics 2B'nin kapsamı, bu görevde yok.
- Tarih aralığı filtresi (`?from=`/`?to=`) — bu görevde tüm zamanlar üzerinden hesaplanıyor, tarih filtresi ayrı bir göreve bırakıldı.
- Herhangi bir caching katmanı — her çağrıda taze sorgu, ekstra bir altyapı eklenmiyor.
- Darboğaz/aşırı yüklenme tespiti (bottleneck detection) — Analytics 2C'nin kapsamı.
- AI destekli yorumlama/öneri — bu görevin kapsamında değil.

## Etkilenen Dosyalar/Modüller (bilinen)
- `backend/services/analytics.service.js` (yeni — `getSummary`, `getSla`, `getWorkload`)
- `backend/controllers/analytics.controller.js` (yeni)
- `backend/routes/analytics.routes.js` (yeni — `GET /summary`, `GET /sla`, `GET /workload`)
- `backend/server.js` (mevcut — `/api/analytics`'i `authMiddleware` arkasında mount etmek için düzenlenecek)
- Migration YOK — `requests`, `request_history`, `departments` tabloları zaten hazır.

## Rollback Beklentisi
Salt okunur, transaction/rollback kavramı yok. DB hatası olursa generic 500 (AC10).

## Risks
- SLA hesaplamasının `request_history`'ye bağımlı olması — eğer bir COMPLETED talebin history'sinde (teorik olarak, hiçbir kod yolu bunu üretmese de) ilgili `STATUS_CHANGED` satırı eksikse, o talep SLA hesaplamasından sessizce düşer. Mevcut `changeRequestStatus` her zaman bu satırı yazdığı için pratikte risk düşük.
- Departman bazlı workload sorgusu, departman sayısı arttıkça büyür ama mevcut ölçekte (3 departman) önemsiz.

## Assumptions
- Kabul kriteri sahibi: request-read görevindeki emsal kararla tutarlı olarak, otomatik testler + `/verify` + `/red-team` yeterli sayılacak — ayrıca manuel Postman testi zorunlu değil (salt okunur, state değiştirmiyor). Kullanıcıya bu görevde ayrıca sorulmadı, önceki emsale dayanarak varsayıldı.
- `avg_resolution_hours` ondalıklı bir sayı olarak dönecek (örn. `4.5`), yuvarlama kuralı belirtilmedi — makul bir varsayım olarak DB'nin `EXTRACT(EPOCH FROM ...)` çıktısı doğrudan kullanılacak, ekstra yuvarlama yapılmayacak.

## Unknowns
- Yok.

## Sorular ve Cevaplar (ham kayıt)
1. EMPLOYEE erişimi → Hayır, 403.
2. Summary alanları → Standart: total_open/assigned/in_progress/completed/rejected/overdue.
3. SLA hesaplaması → Standart: compliance_rate + avg_resolution_hours, sadece COMPLETED, request_history'den.
4. Workload kırılımı → Departman + status.
5. DEPARTMENT_AUTHORITY scope'u → Sadece kendi departmanı.
6. Zaman aralığı → Tüm zamanlar (tarih filtresi yok).
7. SLA'da 0 COMPLETED edge case → compliance_rate: 0, avg_resolution_hours: null.
8. Coverage hedefi → 85%.
9. Performans hedefi → <300ms.
10. Test stratejisi → 70/20/10 onaylandı.
