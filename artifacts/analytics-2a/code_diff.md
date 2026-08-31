# Code Diff — analytics-2a
_Reference: atdd.md, plan.md_

## Files Created
- `backend/services/analytics.service.js` — `getSummary`, `getSla`, `getWorkload`, ortak `scopeToDepartment(user)` helper'ı ile (403 kontrolü + department filtresi tek yerde)
- `backend/controllers/analytics.controller.js` — 3 thin controller
- `backend/routes/analytics.routes.js` — `GET /summary`, `GET /sla`, `GET /workload`

## Files Modified
- `backend/server.js` — `/api/analytics`'i `authMiddleware` arkasında mount etti. Tek satır ekleme + import, başka hiçbir şey değişmedi.

## Acceptance Criteria Coverage (independently verified — live end-to-end testing against a controlled, known-value scenario)

Bilinen bir senaryo kuruldu: IT departmanında 1 OPEN + 1 zamanında tamamlanmış talep, HR departmanında 1 geç tamamlanmış talep (`request_history`'nin `COMPLETED` satırı elle `sla_due_at`'in 1 saat sonrasına çekildi), Finance departmanında hiç talep yok.

| AC | Status | How verified |
|----|--------|--------------|
| 1 — summary ADMIN, sistem geneli | ✅ | Canlı: `{open:1, completed:2, ...}` — beklenen tam eşleşti |
| 2 — summary DEPARTMENT_AUTHORITY, departman scope'lu | ✅ | Canlı: IT authority `{open:1, completed:1}`, HR authority `{completed:1}` — ikisi de doğru |
| 3 — summary EMPLOYEE → 403 | ✅ | Canlı: `403` |
| 4 — sla ADMIN, `request_history`'den hesaplama | ✅ | Canlı: 2 completed, 1 zamanında + 1 geç → `compliance_rate:50`, `avg_resolution_hours:36.5` — elle hesaplanan beklenen değerle birebir |
| 5 — sla DEPARTMENT_AUTHORITY scope'lu | ✅ | Canlı: IT authority `compliance_rate:100`; HR authority `compliance_rate:0, avg_resolution_hours:73` (LOW=72h SLA + 1h gecikme = 73h — matematik doğrulandı) |
| 6 — sla, 0 completed → 0'a bölme koruması | ✅ | Canlı: geçici bir Finance authority ile test edildi, `{compliance_rate:0, avg_resolution_hours:null}`, `200` (hata yok) |
| 7 — workload ADMIN, boş departmanlar dahil | ✅ | Canlı: Finance `{open:0,...,rejected:0}` olarak listede göründü (LEFT JOIN çalışıyor) |
| 8 — workload DEPARTMENT_AUTHORITY, tek satır | ✅ | Canlı: IT authority sadece IT satırını gördü |
| 9 — sla/workload EMPLOYEE → 403 | ✅ | Canlı: her ikisi de `403` |
| 10 — DB hatası → generic 500 | ✅ (kod incelemesi) | Her 3 fonksiyon da tek `pool.query` çağrısını try/catch içine alıp `fail(500, ...)`'a çeviriyor, mevcut `requests.service.js` deseniyle birebir tutarlı |
| 11 — performans <300ms | ✅ | Canlı: 3 endpoint de ısınmış durumda ~3-27ms |

Ayrıca doğrulandı: mevcut 48 test hâlâ PASS, `/health` ve `/api/requests/*`/`/api/auth/*` bozulmadı.

## Post-Red-Team Fixes
Red-team review (`red_team.json`) found 1 low-severity test-coverage gap, addressed by the same subagent and independently re-verified (58/58 tests pass, 3 consecutive runs, no regressions):
- `test/analytics.test.js`: added a test proving a `DEPARTMENT_AUTHORITY` of a zero-request department (Finance) gets a correct single all-zero row from `GET /api/analytics/workload` — reuses the throwaway-Finance-authority pattern already established by the AC6 (`sla`) test in the same file.

## Remaining Limitations
- Tarih aralığı filtresi, dağılım grafikleri, caching — hepsi kapsam dışı, Analytics 2B/2C'nin işi.
- `getSla`'nın `LATERAL JOIN`'i, teorik olarak `COMPLETED` ama karşılık gelen `request_history` satırı olmayan bir talebi sessizce dışarıda bırakır — ama `changeRequestStatus` her zaman bu satırı yazdığı için pratikte bu durum oluşmuyor (subagent'ın kendi raporunda da belirtilmiş).

## Assumptions
- `compliance_rate`/`avg_resolution_hours` 2 ondalık basamağa yuvarlanıyor — atdd.md kesin bir yuvarlama kuralı vermemişti, makul bir seçim.
- `scopeToDepartment(user)` helper'ı, dosya içinde (cross-file değil) 3 fonksiyon arasında paylaşılan bir yardımcı — CAVEMAN'ın "paylaşılan utils modülü yok" kuralını ihlal etmiyor çünkü tek dosyaya özel, projenin `fail()` deseniyle aynı mantık.

## CAVEMAN Review
- **Files added**: tam olarak plan.md'nin öngördüğü 3 dosya.
- **New abstractions**: `scopeToDepartment(user)` — 3 fonksiyonun da aynı ADMIN/DEPARTMENT_AUTHORITY/EMPLOYEE dallanmasını (+ 403 kontrolünü) tekrarlamaması için, tek dosya içinde, gerekçeli.
- **New helper functions**: dosyaya özel `fail()` (proje konvansiyonu, her service dosyası kendi kopyasını tutuyor) + `scopeToDepartment()` — fazlası yok.
- **New public APIs**: tam olarak 3 route, spec'in istediği kadar.
- **Complexity justification**: `getSla`'daki `LATERAL JOIN`, "resolution time" tanımının (request_history'den, en son COMPLETED satırı) gerektirdiği minimum SQL tekniği — spekülatif değil, zorunlu.
