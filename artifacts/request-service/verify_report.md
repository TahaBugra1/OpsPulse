# Verify Report — request-service
_Reference: atdd.md, plan.md, code_diff.md_

## Verification Gates

| # | Gate | Result | Evidence / Reason |
|---|------|--------|--------------------|
| 1 | Dosya konumu | PASS | `git status --short backend/` gösteriyor: 4 yeni dosya (`requests.service.js`, `requests.controller.js`, `requests.routes.js`, `test/requests.routes.test.js`) + `seed.js` + expected modifications (`server.js`, `package.json`) exactly where `code_diff.md` claims. |
| 2 | Build/derleme | PASS | No bundler in this project. Import-sanity: `node -e "require('./server.js')"` → `IMPORT OK`, exit 0 — confirms all `require()`s resolve (including the new `requests.routes.js`/`auth.middleware.js` wiring in `server.js`), no port bound as a side effect. |
| 3 | Lint | N/A | Proje hiçbir linter tanımlamıyor (auth görevindeki gibi). |
| 4 | Type check | N/A | Proje TypeScript kullanmıyor. |
| 5 | Unit testler | PASS | `npm test` → **25 pass, 0 fail** (12 önceki auth testi + 13 yeni request-service testi), `duration_ms 2813`. Bağımsız olarak kendim çalıştırdım. AC → Test Mapping aşağıda — AC12 (DB outage) hariç her Acceptance Criteria en az bir testle kapsanıyor, ayrıca code-review'da bulunan race-condition düzeltmesi için özel bir regresyon testi de var. Code-smell pass: `requests.service.js`'deki 4 fonksiyon da ~20-45 satır arası, tek sorumluluk; `VALID_TRANSITIONS`/`SLA_HOURS` düz veri map'leri (magic number yok, isimlendirilmiş sabitler); en derin nesting 3 seviye (if içinde transaction callback içinde if) — kabul edilebilir; uzun parametre listesi yok (hepsi ≤3 parametre, çoğu destructured obje). |
| 6 | E2E testler | N/A | Bu görevde e2e altyapısı yok (auth görevindeki gibi, frontend'e ertelendi). |
| 7 | Lighthouse (performans) | N/A | Web sayfası/UI yok, sadece backend API. |
| 8 | Erişilebilirlik | N/A | Gate 7 ile aynı gerekçe. |
| 9 | Güvenlik taraması | PASS (sınırlı kapsam) | `npm audit` → **0 vulnerabilities**. `red-team` adımının yerini tutmuyor, orada ayrıca bağımsız bir inceleme yapılacak. |
| 10 | AI code review | PENDING (red-team) | Kasıtlı olarak bu adımda yapılmıyor. |
| 11 | Görsel regresyon | N/A | Proje görsel-diff aracı kullanmıyor. |
| 12 | İnsan onayı | PENDING | ATDD kararınız gereği ("yine manuel Postman testim de gerekli") bu görev için de ayrıca manuel doğrulamanız bekleniyor — bu rapor onu kapsamıyor. |

## Performans Doğrulaması (canlı ölçüm)

Isınmış (warmed-up) durumda, gerçek seed data + gerçek DB'ye karşı, 4 endpoint için de <300ms hedefinin çok altında:

| Endpoint | Ölçülen aralık |
|---|---|
| `POST /api/requests` (createRequest) | ~16-19ms |
| `POST /api/requests/:id/assign` (claimRequest) | ~15-81ms (ilk çağrı ısınma dahil, sonrakiler ~15-17ms) |
| `PATCH /api/requests/:id/status` (changeRequestStatus) | ~6-26ms |
| `PATCH /api/requests/:id/priority` (changePriority) | ~7-17ms |

Tüm dört fonksiyon transaction-wrapped olmasına rağmen (BEGIN/COMMIT/ROLLBACK + birden fazla INSERT) hedefin çok altında kalıyor.

## AC → Test Mapping

| AC | Açıklama | Test | Sonuç |
|----|----------|------|-------|
| 1 [Critical] | createRequest happy path, server-derived department_id, exact sla_due_at | `POST /api/requests - valid creation returns 201...` | PASS |
| 2 [Critical] | claimRequest happy path | `POST .../assign - correct-department authority claims OPEN request` | PASS |
| 3 [Critical] | claim conflict → 409 | `POST .../assign - claiming an already-assigned request returns 409` | PASS |
| 4 [High] | cross-department claim → 403 | `POST .../assign - different-department authority is forbidden` | PASS |
| 5 [High] | ASSIGNED→IN_PROGRESS by assigned officer | `PATCH .../status - assigned officer moves ASSIGNED to IN_PROGRESS` | PASS |
| 6 [Critical] | geçersiz/reopen geçişleri reddi | `PATCH .../status - backwards transition...` + `...COMPLETED request returns 400` | PASS (2 test) |
| 7 [High] | REJECTED note zorunluluğu | `PATCH .../status - rejecting without a note returns 400` | PASS |
| 8 [High] | reject yetki modeli (OPEN: department genel, sonrası: sadece atanan) | `PATCH .../status - rejection authorization: ...` | PASS |
| 9 [High] | priority değişimi, sla_due_at orijinal created_at'e anchor | `PATCH .../priority - assigned officer changes priority...` | PASS |
| 10 [High] | OPEN request'te priority değişimi → 403 | `PATCH .../priority - changing priority on an OPEN request returns 403` | PASS |
| 11 [Medium] | geçersiz/inactive request_type_id | `POST /api/requests - nonexistent request_type_id returns 404, inactive one returns 400` | PASS |
| 12 [Medium] | Transaction rollback | Kalıcı test suite'inde yok (auth görevindeki AC9 ile aynı gerekçe — gerçek DB outage simülasyonu pratik değil), ama **geçici bir mock-based unit test ile bir kerelik doğrulandı** (`t.mock.method` ile `pool.connect`/`pool.query` mock'lanarak `request_history` INSERT'i başarısız kılındı): ROLLBACK çağrıldığı, COMMIT çağrılmadığı, `client.release()`'in yine de çalıştığı ve ham DB hatasının değil sanitize edilmiş 500 mesajının çağırana sızdığı doğrulandı — hem izole hem 26 testlik tam suite içinde PASS. Doğrulama sonrası proje konvansiyonuna uygun olarak test dosyası silindi, suite 25'e geri döndü. | PASS (bir kerelik, kalıcı değil) |
| — | Regresyon: COMPLETED request'te priority değişimi (code-review'da bulunan race-condition fix'i) | `PATCH .../priority - ...COMPLETED request is forbidden (regression)` | PASS |

## Coverage / Quality Notes

- **AC12 kalıcı suite'te yok** ama bir kerelik mock-based test ile PASS olarak doğrulandı (yukarıda) — kod (her fonksiyonun `withTransaction` sarmalayıcısı) hem code_diff.md'de satır satır incelenmiş hem artık bir gerçek test çalıştırmasıyla da kanıtlanmış durumda; kalıcı suite'e eklenmedi çünkü proje mock-based DB-outage testlerini kalıcı suite'te istemiyor (auth görevindeki AC9 kararıyla tutarlı).
- Test pyramid: 25 testin tamamı fiilen integration (gerçek Postgres'e karşı, `supertest` ile `app`'e istek atarak) — auth görevindeki 5 izole middleware unit testi hariç, bu görevde ayrı bir unit test dosyası açılmadı çünkü servisin iç yardımcıları (`fail`, `computeSlaDueAt`, `withTransaction`, `VALID_TRANSITIONS`) export edilmiyor, private implementasyon detayı — test-copilot'un gerekçesi (auth.service.js'in private helper'larıyla aynı durum) makul.
- Testler arası izolasyon sağlam: her test benzersiz employee/request üretiyor, `t.after()` ile FK sırasına uygun temizleniyor (notifications→history→requests→user); bu raporun kendi test çalıştırması sonrası DB'de sıfır kalıntı satır doğrulandı, seed data (3 department, 2 authority) sağlam kaldı.
- Code-copilot aşamasında bulunup düzeltilen 2 bulgu (changePriority race-condition guard'ı, sla_due_at/created_at timestamp tutarlılığı) artık hem canlı testlerle (code_diff.md) hem otomatik regresyon testiyle (bu görev) iki kez doğrulanmış durumda.
