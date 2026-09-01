# Code Diff — analytics-2b
_Reference: atdd.md, plan.md_

## Files Created
Yok.

## Files Modified
- `backend/services/analytics.service.js` — `getSummary`/`getSla`/`getWorkload`/`scopeToDepartment`/`fail` **byte-for-byte değişmedi** (kod okunarak doğrulandı). Eklenenler: `parseDaysParam(query)` (SQL'e gitmeden ÖNCE `days` validasyonu — `Number.isInteger` + 1-90 aralığı, yoksa `fail(400, ...)`, param yoksa varsayılan 30) ve `getDistribution(query, user)` (mevcut `scopeToDepartment(user)`'ı DEĞİŞTİRMEDEN reuse ediyor). 4 sorgu çalıştırıyor: status/priority sabit-liste `COUNT(*) FILTER` (DISTINCT değil, 0 dahil tüm değerler garanti), department/requestType `LEFT JOIN`'i ilgili dimension tablosundan başlatıyor (`getWorkload`'ın aynı deseni, sıfır-talepli departman/tür de 0 ile görünüyor), `volumeOverTime` `generate_series` + `LEFT JOIN` (boş günler de 0 ile görünüyor, kronolojik sıralı).
- `backend/controllers/analytics.controller.js` — `getDistributionHandler` eklendi, diğer 3 handler'la birebir aynı ince try/catch şablonu.
- `backend/routes/analytics.routes.js` — `router.get('/distribution', getDistributionHandler)` eklendi.

## Acceptance Criteria Coverage (kod okunarak + npm test + canlı sanity check ile doğrulandı)

| AC | Status | Nasıl doğrulandı |
|----|--------|-------------------|
| 1 — ADMIN, tüm kırılımlar, 0 dahil tüm değerler | ✅ | Canlı: `status` 5 satır, `priority` 3 satır (sabit liste, DISTINCT değil) |
| 2 — volumeOverTime, varsayılan 30 gün, kronolojik | ✅ | Canlı: 30 giriş, `date[0] < date[29]` |
| 3 — EMPLOYEE → 403 | ✅ | Canlı: `EMPLOYEE -> 403` PASS, `scopeToDepartment` değişmedi |
| 4 — DEPARTMENT_AUTHORITY → sadece kendi departmanı | ✅ | Canlı: IT authority, `department` kırılımında sadece 1 departman |
| 5 — `?days=7` → 7 veri noktası | ✅ | Canlı: PASS |
| 6 — geçersiz `days` → 400 | ✅ | Canlı: `days=abc`, `days=-5`, `days=91` üçü de 400 |
| 7 — sınır değerleri (1, 90) kabul edilir | ✅ | Canlı: `days=90` → 200 |
| 8 — sıfır veri → tüm kategoriler/günler 0 ile | ✅ | Kod incelemesi: sabit liste + dimension-table LEFT JOIN + generate_series, üçü de "eksik satır" riski taşımıyor |
| 9 — `days` verilmezse varsayılan 30 | ✅ | Canlı: param'sız çağrıda 30 giriş |

**Ayrıca doğrulandı**: `npm test` 2 ardışık çalıştırma, ikisinde de **75/75 PASS** (bu görevde henüz yeni test dosyası yok — test-copilot'un işi, mevcut testlerin bozulmadığı doğrulandı). Canlı sanity check (geçici script, silindi): **17/17 PASS**, DB'de kalıntı yok.

## Remaining Limitations
- Frontend chart/UI yok (kapsam dışı, atdd.md kararı).
- Özel tarih aralığı (`from`/`to`) yok, sadece "son N gün" (kapsam dışı).
- Çapraz filtreleme (ör. sadece bir request_type'ın zaman serisi) yok (kapsam dışı).
- DEPARTMENT_AUTHORITY'nin kendi departmanı `is_active=false` ise (çok uç bir durum, hiçbir AC bunu kapsamıyor) departman kırılımında hiç görünmeyebilir — bilinen, dokümante edilmemiş küçük bir edge case, blocking değil.

## Assumptions
- DEPARTMENT_AUTHORITY için `requestType` kırılımı, sadece KENDİ departmanının aktif türlerini gösteriyor (sistem geneli türleri 0 ile zorlamak yerine) — plan.md'nin "en basit/tutarlı olan" serbestliğiyle alınmış bir karar.
- Response şekli: her kırılım `{kategori, count}` nesnelerinin dizisi (`getWorkload`'ın array-of-rows stiliyle tutarlı).

## CAVEMAN Review
- **Files added**: 0.
- **New abstractions**: 1 — `parseDaysParam`, AC6'nın "SQL'e gitmeden önce doğrula" gereksinimini karşılamak için gerekli, düz bir fonksiyon (sınıf/modül değil).
- **New helper functions**: yukarıdaki + 0 başka.
- **New public APIs**: `getDistribution` — AC'nin doğrudan gerektirdiği, fazlası yok.
- **Complexity justification**: 4 sorgunun hepsi dosyada zaten var olan desenleri (`fail()`, try/catch, `whereClause`/`params`, dimension-table LEFT JOIN) kullanıyor — yeni bir sorgu stili icat edilmedi. `scopeToDepartment`/`getSummary`/`getSla`/`getWorkload` hiç dokunulmadan bırakıldı.

## Addendum — red-team follow-up fix (aynı task-slug, code-copilot ikinci tur)
`artifacts/analytics-2b/red_team.json`'ın 1 bulgusu düzeltildi (`backend/services/analytics.service.js`, başka dosya değişmedi):

**[Low/Maintainability, düzeltildi]** `getDistribution`'daki 4 ayrı try/catch bloğu (hepsi birebir aynı `fail(500, 'Dağılım verileri getirilemedi...')` mesajını fırlatıyordu) tek bir try/catch'e konsolide edildi — 4 sorgu da aynı sırada, aynı SQL/param'larla, tek bir catch bloğunun içinde çalışıyor. Davranış birebir aynı (herhangi bir sorgu hatası yine 500 döner).

**Doğrulama (orkestratör tarafından bağımsız):**
- Dosya okundu, tek try/catch yapısı doğrulandı (satır 137-193); başka hiçbir dosya değişmemiş (`git status --short`).
- `npm test`: 2 ardışık çalıştırma, ikisinde de **82/82 PASS, 0 FAIL** (davranış değişmedi, sadece kod tekrarı azaldı).
