# Verify Report — request-read
_Reference: atdd.md, plan.md, code_diff.md_

## Verification Gates

| # | Gate | Result | Evidence / Reason |
|---|------|--------|--------------------|
| 1 | Dosya konumu | PASS | `git status --short backend/` gösteriyor: 3 dosya değişmiş (`requests.service.js`, `requests.controller.js`, `requests.routes.js`) + 1 yeni test dosyası (`test/requests.read.test.js`) — `code_diff.md`'nin iddia ettiğiyle birebir. |
| 2 | Build/derleme | PASS | `node -e "require('./server.js')"` → `IMPORT OK`, exit 0. |
| 3 | Lint | N/A | Proje linter tanımlamıyor. |
| 4 | Type check | N/A | Proje TypeScript kullanmıyor. |
| 5 | Unit testler | PASS | `npm test` → **36 pass, 0 fail** (25 önceki + 11 yeni). Bağımsız çalıştırdım. AC → Test Mapping aşağıda — 11/11 AC kapsanıyor. Code-smell pass: `listRequests`/`getRequestById` sırasıyla ~35 ve ~20 satır, tek sorumluluk; `REQUEST_LIST_SELECT` paylaşılan SQL sabiti gerçek tekrarı önlüyor; magic number yok; en derin nesting 2 seviye; uzun parametre listesi yok. |
| 6 | E2E testler | N/A | Bu görevde e2e altyapısı yok. |
| 7 | Lighthouse (performans) | N/A | Web sayfası/UI yok. |
| 8 | Erişilebilirlik | N/A | Gate 7 ile aynı gerekçe. |
| 9 | Güvenlik taraması | PASS (sınırlı kapsam) | `npm audit` → **0 vulnerabilities**. `red-team`'in yerini tutmuyor — orada join sorgularının authorization mantığı ayrıca incelenecek. |
| 10 | AI code review | PENDING (red-team) | Kasıtlı olarak bu adımda yapılmıyor. |
| 11 | Görsel regresyon | N/A | Proje görsel-diff aracı kullanmıyor. |
| 12 | İnsan onayı | PENDING | ATDD kararınız gereği bu görev için manuel Postman testi zorunlu değildi (salt okunur, state değiştirmiyor) — ama bu gate her zaman "pending" kalır, verify/red-team bunu veremez. |

## Performans Doğrulaması (canlı ölçüm)

Isınmış durumda, join'li sorgulara rağmen <300ms hedefinin çok altında:

| Endpoint | Ölçülen aralık |
|---|---|
| `GET /api/requests` (listRequests, 4-way JOIN) | ~5-7ms |
| `GET /api/requests/:id` (getRequestById, 4-way JOIN) | ~5-6ms |

## AC → Test Mapping

| AC | Açıklama | Test | Sonuç |
|----|----------|------|-------|
| 1 [Critical] | EMPLOYEE sadece kendi talepleri | `GET /api/requests - EMPLOYEE sees only their own requests` | PASS |
| 2 [Critical] | DEPARTMENT_AUTHORITY departman geneli (OPEN dahil) | `GET /api/requests - DEPARTMENT_AUTHORITY sees all requests in their department, including unassigned OPEN ones` | PASS |
| 3 [Critical] | ADMIN sistem geneli | `GET /api/requests - ADMIN sees requests across different departments and creators` | PASS |
| 4 [High] | `?status=` filtresi (geçerli/geçersiz) | `GET /api/requests?status= - narrows results within scope, invalid status returns 400` | PASS |
| 5 [Critical] | Sahibi kendi detayını görür | `GET /api/requests/:id - creating EMPLOYEE gets 200 with full body` | PASS |
| 6 [High] | Aynı departman authority'si (atanmamış da) detayı görür | `GET /api/requests/:id - matching-department authority gets 200 for an unassigned request` | PASS |
| 7 [High] | ADMIN her detayı görür | `GET /api/requests/:id - ADMIN gets 200 for a request created by someone else` | PASS |
| 8 [High] | Yetkisiz erişim → 403 (iki senaryo) | `GET /api/requests/:id - unauthorized actors get 403` | PASS |
| 9 [Medium] | Olmayan id → 404 | `GET /api/requests/:id - nonexistent UUID returns 404` | PASS |
| 10 [High] | `is_overdue` (terminal state'te her zaman false) | `GET /api/requests/:id and list - is_overdue reflects SLA breach only while non-terminal` | PASS |
| 11 [High] | Join'lenmiş alanlar + assigned_to_name claim sonrası | `GET /api/requests/:id - joined display fields are correct, assigned_to_name populates after claim` | PASS |

## Coverage / Quality Notes

- Tüm 11 AC otomatik testle kapsanıyor — auth/request-service görevlerindeki gibi "bilinçli atlanan" bir AC bu görevde yok (salt okunur olduğu için transaction-rollback tipi bir boşluk da söz konusu değil).
- Test-copilot aşamasında bir kalıntı veri sorunu bulundu (subagent'ın kendi düzeltme öncesi test denemesinden kalma, mevcut kodun kendisi değil) — iki kez tekrar test edilerek mevcut kodun residue bırakmadığı doğrulandı, kalıntı elle temizlendi. Bu raporun kendi test çalıştırması sonrası DB'de sıfır kalıntı satır, seed data (3 department, 2 authority) sağlam.
- Mevcut 4 write fonksiyonuna (`createRequest`, `claimRequest`, `changeRequestStatus`, `changePriority`) code-copilot aşamasında tek satır bile dokunulmadığı diff ile doğrulanmıştı; bu raporun 25 eski + 11 yeni test PASS sonucu bunu bir kez daha teyit ediyor (regresyon yok).
