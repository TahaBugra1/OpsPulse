# Verify Report — request-comments
_Reference: atdd.md, plan.md, code_diff.md_

## Verification Gates

| # | Gate | Result | Evidence / Reason |
|---|------|--------|--------------------|
| 1 | Dosya konumu | PASS | `git status --short backend/` gösteriyor: 3 dosya değişmiş (`requests.service.js`, `requests.controller.js`, `requests.routes.js`) + 1 yeni test dosyası (`test/requests.comments.test.js`) — `code_diff.md`'nin iddia ettiğiyle birebir. |
| 2 | Build/derleme | PASS | `node -e "require('./server.js')"` → `IMPORT OK`, exit 0. |
| 3 | Lint | N/A | Proje linter tanımlamıyor. |
| 4 | Type check | N/A | Proje TypeScript kullanmıyor. |
| 5 | Unit testler | PASS | `npm test` → **47 pass, 0 fail** (36 önceki + 11 yeni). Bağımsız çalıştırdım. AC → Test Mapping aşağıda — 11/11 AC kapsanıyor (AC12 auth/request-service görevlerindeki gibi bilinçli atlandı). Code-smell pass: `addComment`/`listComments` sırasıyla ~35 ve ~20 satır, tek sorumluluk; magic number yok (2000 karakter sınırı açıkça isimlendirilmiş); en derin nesting 2 seviye; uzun parametre listesi yok. |
| 6 | E2E testler | N/A | Bu görevde e2e altyapısı yok. |
| 7 | Lighthouse (performans) | N/A | Web sayfası/UI yok. |
| 8 | Erişilebilirlik | N/A | Gate 7 ile aynı gerekçe. |
| 9 | Güvenlik taraması | PASS (sınırlı kapsam) | `npm audit` → **0 vulnerabilities**. `red-team`'in yerini tutmuyor — orada notification-alıcı mantığı ve `getRequestById` reuse'u ayrıca incelenecek. |
| 10 | AI code review | PENDING (red-team) | Kasıtlı olarak bu adımda yapılmıyor. |
| 11 | Görsel regresyon | N/A | Proje görsel-diff aracı kullanmıyor. |
| 12 | İnsan onayı | PENDING | ATDD kararınız gereği bu görev için manuel Postman testi zorunlu değildi — ama bu gate her zaman "pending" kalır. |

## Performans Doğrulaması (canlı ölçüm)

Isınmış durumda, transaction-wrapped `POST` dahil, <300ms hedefinin çok altında:

| Endpoint | Ölçülen aralık |
|---|---|
| `POST /api/requests/:id/comments` (addComment, transaction + koşullu notification) | ~8-11ms |
| `GET /api/requests/:id/comments` (listComments, JOIN'li) | ~5-9ms |

## AC → Test Mapping

| AC | Açıklama | Test | Sonuç |
|----|----------|------|-------|
| 1 [Critical] | Sahibi yorum yazar, doğru kaydedilir | `POST ... - creating EMPLOYEE gets 201, comment persisted correctly` | PASS |
| 2 [Critical] | Atanmış DEPARTMENT_AUTHORITY yorum yazar, sahibine bildirim | `POST ... - assigned matching-department authority gets 201, creator is notified` | PASS |
| 3 [High] | Yetkisiz yazma → 403 (iki senaryo) | `POST ... - unauthorized commenters get 403` | PASS |
| 4 [Critical] | OPEN talepte sahibi yorum yazar, bildirim OLUŞMAZ | `POST ... - creator comments on OPEN unassigned request, no notification created` | PASS |
| 5 [High] | Görüntüleme yetkisi olan listeler, kronolojik sıra, author_name | `GET ... - view-access actors get 200, chronological order, author_name populated` | PASS |
| 6 [High] | Yetkisiz listeleme → 403 | `GET ... - actor without view access gets 403` | PASS |
| 7 [High] | Boş/whitespace içerik → 400 | `POST ... - empty or whitespace-only content returns 400` | PASS |
| 8 [Medium] | 2000+ karakter → 400 | `POST ... - content longer than 2000 characters returns 400` | PASS |
| 9 [High] | Terminal durumda yorum çalışır (COMPLETED + REJECTED) | `POST ... - commenting on terminal-status requests still succeeds` | PASS |
| 10 [Medium] | Olmayan talep → 404 (POST + GET) | `POST and GET ... - nonexistent request id returns 404` | PASS |
| 11 [High] | ADMIN yazamaz (403), görüntüleyebilir (200) | `POST ... - ADMIN gets 403; GET ... - ADMIN gets 200` | PASS |
| 12 [Medium] | Transaction rollback | **Yok — bilinçli olarak atlandı** (auth/request-service görevlerindeki AC9/AC12 ile aynı gerekçe) | GAP (kabul edilmiş) |

## Coverage / Quality Notes

- 11/12 AC otomatik testle kapsanıyor, AC12 önceki iki görevle tutarlı bir şekilde bilinçli atlandı — `withTransaction` reuse edildiği için kod-review kanıtı zaten `code_diff.md`'de mevcut.
- `getRequestById`'in reuse edilmesi (yeniden implement edilmemesi), authorization mantığının tek bir yerde kalmasını sağlıyor — bu hem CAVEMAN hem correctness açısından güçlü bir tasarım kararı, testlerde de (AC3/AC6/AC11) request-read'deki davranışla tutarlı sonuçlar doğrulandı.
- Testler arası izolasyon sağlam: her test benzersiz employee/request üretiyor, FK sırasına uygun temizleniyor (notifications→comments→history→requests→user); bu raporun kendi test çalıştırması sonrası DB'de sıfır kalıntı satır, seed data sağlam.
- Mevcut 6 fonksiyona (`createRequest`, `claimRequest`, `changeRequestStatus`, `changePriority`, `listRequests`, `getRequestById`) code-copilot aşamasında tek satır dokunulmadığı diff ile doğrulanmıştı; 36 eski + 11 yeni test PASS sonucu bunu bir kez daha teyit ediyor.
