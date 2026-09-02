# Code Diff — analytics-2c
_Reference: atdd.md, plan.md_

## Files Created
Yok.

## Files Modified
- `backend/services/analytics.service.js` — `getSummary`/`getSla`/`getWorkload`/`getDistribution`/`parseDaysParam`/`scopeToDepartment`/`fail` **byte-for-byte değişmedi** (kod okunarak doğrulandı). Eklenen: `getBottlenecks(user)` — `scopeToDepartment(user)`'ı DEĞİŞTİRMEDEN reuse ediyor, TEK try/catch içinde 4 sorgu (analytics-2b'nin red-team dersi baştan uygulandı): (1) `slaBreachByDepartment`/`slaBreachByRequestType` — overdue koşulu `LEFT JOIN`'in `ON`'unda (plan.md'nin işaret ettiği kritik tuzak doğru kaçınıldı), (2) `stageDurations` — 3 `LEFT JOIN LATERAL` + `AVG(...) FILTER(...)`, veri yoksa SQL'in kendisi `NULL` döndürüyor, (3) `authorityWorkload` — `users` dimension tablosundan başlayan `LEFT JOIN`, aktif olmayan/EMPLOYEE'leri filtreleyen `WHERE`.
- `backend/controllers/analytics.controller.js` — `getBottlenecksHandler` eklendi, diğer 4 handler'la birebir aynı ince try/catch şablonu.
- `backend/routes/analytics.routes.js` — `router.get('/bottlenecks', getBottlenecksHandler)` eklendi.

## Acceptance Criteria Coverage (kod okunarak + npm test + canlı sanity check ile doğrulandı)

| AC | Status | Nasıl doğrulandı |
|----|--------|-------------------|
| 1 — ADMIN, SLA ihlali kırılımları (0 dahil) | ✅ | Canlı: `slaBreachByDepartment`/`slaBreachByRequestType` array, tüm sayılar ≥0 |
| 2 — stageDurations, 3 giriş, doğru sıra | ✅ | Canlı: tam 3 giriş, `OPEN_TO_ASSIGNED,ASSIGNED_TO_IN_PROGRESS,IN_PROGRESS_TO_COMPLETED` sırası |
| 3 — authorityWorkload, 0 dahil, azalan sıralı | ✅ | Canlı: ≥2 yetkili (seed IT+HR), `active_count DESC` sıralaması doğrulandı |
| 4 — EMPLOYEE → 403 | ✅ | Canlı: `scopeToDepartment` değişmedi, PASS |
| 5 — DEPARTMENT_AUTHORITY → sadece kendi departmanı (3 bölümde de) | ✅ | Canlı: IT authority, `slaBreachByDepartment` 1 satır, `authorityWorkload` 1 yetkili (seed'de IT'nin tek yetkilisi) |
| 6 — 0 aktif talepli yetkili → 0 ile görünür | ✅ | Canlı: throwaway Finance authority, `active_count: 0` |
| 7 — veri yok → avg_hours null | ✅ | Canlı: Finance (hiç talep yok) → 3 aşamanın hepsi `null` |
| 8 — sıfır veri kapsamı → tüm alanlar 0/null, hata yok | ✅ | Canlı: Finance senaryosu 200 döndü, hiçbir alan eksik/hata değil |

**Ayrıca doğrulandı**: `npm test` 2 ardışık çalıştırma, ikisinde de **82/82 PASS** (bu görevde henüz yeni test dosyası yok — test-copilot'un işi, mevcut testlerin bozulmadığı doğrulandı). Canlı sanity check (geçici script, silindi): **19/19 PASS**, DB'de kalıntı yok.

## Remaining Limitations
- Otomatik aksiyon/eşitleme, bildirim, frontend, özel tarih aralığı yok (kapsam dışı, atdd.md kararı).

## Assumptions
- Response şekli: `{slaBreachByDepartment, slaBreachByRequestType, stageDurations, authorityWorkload}` — plan.md'de netleşmiş alan adları birebir kullanıldı.

## CAVEMAN Review
- **Files added**: 0.
- **New abstractions**: `roundOrNull` — `getSla`'nın zaten var olan yuvarlama mantığının (2 ondalık, `null` korunarak) küçük bir inline closure'a çıkarılmış hali, paylaşılan bir util'e taşınmamış (CAVEMAN'ın "erken soyutlama yapma" ilkesine uygun).
- **New helper functions**: yukarıdaki + 0 başka.
- **New public APIs**: `getBottlenecks` — AC'nin doğrudan gerektirdiği, fazlası yok.
- **Complexity justification**: 4 sorgu, AC'nin gerektirdiği 4 farklı görünüme (SLA-departman, SLA-tür, aşama-süresi, yetkili-yükü) birebir karşılık geliyor — hiçbiri gereksiz değil. `stageDurations`'ın 3 LATERAL join'i plan.md'nin verdiği tam şekille birebir aynı, code-copilot kendi başına daha karmaşık bir yapı icat etmemiş.

## Addendum — red-team follow-up fix (aynı task-slug, code-copilot ikinci tur)
`artifacts/analytics-2c/red_team.json`'ın 1 bulgusu düzeltildi (`backend/services/analytics.service.js`, başka dosya değişmedi):

**[Low/Maintainability, düzeltildi]** `getBottlenecks`'teki 4 ayrı ama birebir aynı içerikli params değişkeni (`slaDeptParams`/`slaTypeParams`/`stageParams`/`workloadParams`) tek bir `params` değişkenine konsolide edildi — 4 sorgu da aynı değişkeni kullanıyor. Davranış birebir aynı.

**Doğrulama (orkestratör tarafından bağımsız):**
- Dosya okundu, tek `params` değişkeni doğrulandı (satır 223); başka hiçbir dosya değişmemiş (`git status --short`).
- `npm test`: 2 ardışık çalıştırma, ikisinde de **88/88 PASS, 0 FAIL** (davranış değişmedi, sadece kod tekrarı azaldı).
