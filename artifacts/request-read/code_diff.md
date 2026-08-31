# Code Diff — request-read
_Reference: atdd.md, plan.md_

## Files Created
Yok — üçü de mevcut dosyalara ek.

## Files Modified
- `backend/services/requests.service.js` — `REQUEST_LIST_SELECT` (paylaşılan SQL fragment), `VALID_STATUSES`, `listRequests`, `getRequestById` eklendi. Mevcut 4 write fonksiyonuna (`createRequest`, `claimRequest`, `changeRequestStatus`, `changePriority`) ve helper'lara (`fail`, `computeSlaDueAt`, `withTransaction`, `VALID_TRANSITIONS`, `SLA_HOURS`) **tek satır bile dokunulmadı** — diff ile doğrulandı (sadece dosya sonuna ekleme).
- `backend/controllers/requests.controller.js` — `getRequests`, `getRequestByIdHandler` eklendi (isim çakışmasını önlemek için servis fonksiyonundan farklı adlandırıldı).
- `backend/routes/requests.routes.js` — `GET /` ve `GET /:id` eklendi.

## Acceptance Criteria Coverage (independently verified — live end-to-end testing against the real DB)

| AC | Status | How verified |
|----|--------|--------------|
| 1 — EMPLOYEE sadece kendi talepleri | ✅ | Canlı: EMP1'in listesinde 1 talep, EMP2'nin listesinde 0 |
| 2 — DEPARTMENT_AUTHORITY kendi departmanının tümü (atanmamış dahil) | ✅ | Canlı: IT authority OPEN (atanmamış) talebi görebildi, HR authority göremedi |
| 3 — ADMIN sistem geneli | ✅ | Canlı: ADMIN tüm talepleri gördü |
| 4 — `?status=` filtresi (geçerli/geçersiz) | ✅ | Canlı: `?status=OPEN` → doğru filtrelendi, `?status=FOO` → `400 "Geçersiz status değeri"` |
| 5 — sahibi kendi talebinin detayını görür | ✅ | Canlı: `200` |
| 6 — aynı departmandaki authority (atanmamış olsa da) detayı görür | ✅ | Canlı: `200` |
| 7 — ADMIN her detayı görür | ✅ | Canlı: `200` |
| 8 — yetkisiz erişim → 403 | ✅ | Canlı: hem başka bir employee hem farklı departman authority'si için `403` |
| 9 — olmayan id → 404 | ✅ | Canlı: `404 "Talep bulunamadı"` |
| 10 — `is_overdue` hesaplaması (DB `now()` ile, terminal state'te her zaman false) | ✅ | Canlı: `sla_due_at` geçmişe çekilip OPEN'da `is_overdue:true` doğrulandı; sonra COMPLETED yapılıp `is_overdue:false`'a döndüğü (süre hâlâ geçmiş olmasına rağmen) doğrulandı |
| 11 — join'lenmiş alanlar (`request_type_name`, `department_name`, `created_by_name`, `assigned_to_name`) | ✅ | Canlı: tümü doğru geldi; `assigned_to_name` claim öncesi `null`, claim sonrası `"IT Yetkilisi"` |

Ayrıca doğrulandı: mevcut 25 test hâlâ PASS, `/health` ve tüm yazma endpoint'leri (create/claim/status/priority) bozulmadı.

## Remaining Limitations
- Pagination, alternatif sıralama, `request_comments`/`notifications` okuma endpoint'leri — hepsi kapsam dışı, eksiklik değil.

## Assumptions
- `getRequestById`'in SQL sorgusu rol bazlı bir WHERE filtresi içermiyor (tek satırı `id`'ye göre çekip yetki kontrolünü JS'de yapıyor) — bu, mevcut `claimRequest`/`changeRequestStatus`/`changePriority`'nin zaten kullandığı "önce SELECT, sonra JS'de yetki kontrolü" deseniyle tutarlı, yeni bir risk değil.
- Geçersiz formatlı bir `id` (UUID olmayan bir string) gönderilirse, Postgres'in "invalid input syntax for uuid" hatası genel `catch` bloğuna düşüp sanitize edilmiş 500 döner — bu da mevcut write fonksiyonlarının aynı senaryodaki davranışıyla tutarlı (400 yerine 500 dönmesi, bu görevin kapsamında yeni bir davranış değil, projenin var olan konvansiyonu).

## CAVEMAN Review
- **Files added**: 0.
- **New abstractions**: `REQUEST_LIST_SELECT` — tek bir paylaşılan SQL string sabiti, hem `listRequests` hem `getRequestById` tarafından kullanılıyor; gerçek ve mevcut bir tekrarı (12 satırlık SELECT/JOIN bloğu) önlüyor, spekülatif değil.
- **New helper functions**: yok, sadece 2 gerekli servis fonksiyonu + 2 gerekli controller fonksiyonu.
- **New public APIs**: `listRequests`, `getRequestById` (servis), `getRequests`, `getRequestByIdHandler` (controller) — hepsi spec'in istediği, fazlası yok.
- **Complexity justification**: query-builder soyutlaması yok, düz `pool.query()` + `$n` placeholder deseni (mevcut stille tutarlı), transaction yok (doğru — salt okunur).
