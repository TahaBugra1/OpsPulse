# Plan — analytics-2c
_Reference: atdd.md_

## Files to Modify

| File | Why | Risk |
|------|-----|------|
| `backend/services/analytics.service.js` | Yeni `getBottlenecks(user)` fonksiyonu eklenecek. Mevcut `scopeToDepartment(user)` AYNEN reuse edilecek (EMPLOYEE → 403, DEPARTMENT_AUTHORITY → kendi departmanı, ADMIN → sistem geneli) — AC4/AC5. 3 bölüm (`slaBreachByDepartment`, `slaBreachByRequestType`, `stageDurations`, `authorityWorkload` — 4 bölüm) tek fonksiyonda üretilecek, `getDistribution`'ın (analytics-2b) "tek try/catch içinde ardışık sorgular" desenine uygun (red-team'in 2b'de düzelttiği ders: aynı hata mesajını fırlatan sorgular ayrı try/catch'lere bölünmemeli). | medium (yeni bir fonksiyon, `stageDurations` sorgusu diğerlerinden daha karmaşık — aşağıda tam SQL şekli verildi) |
| `backend/controllers/analytics.controller.js` | Yeni `getBottlenecksHandler` — mevcut 4 handler'ın (`getSummaryHandler` vb.) BİREBİR aynı ince try/catch şablonu. | low |
| `backend/routes/analytics.routes.js` | Yeni `router.get('/bottlenecks', getBottlenecksHandler)` satırı, mevcut 4 route'un yanına. | low |

## New Files
Yok — atdd.md'nin "mevcut 3 dosyaya ekleme" kararıyla tutarlı.

## Dependencies

### `scopeToDepartment(user)` — DEĞİŞTİRİLMEDEN reuse
analytics-2b'de olduğu gibi, bu paylaşılan fonksiyon 4 mevcut fonksiyon tarafından da kullanılıyor — burada da aynen çağrılacak, gövdesi değişmeyecek.

### `slaBreachByDepartment` / `slaBreachByRequestType`
`getDistribution`'ın `department`/`requestType` kırılımlarıyla BİREBİR AYNI dimension-table LEFT JOIN deseni (`getWorkload`'dan miras), tek fark WHERE koşulu:
```sql
-- departman:
SELECT d.name AS department_name, COUNT(r.id)::int AS count
FROM departments d
LEFT JOIN requests r ON r.department_id = d.id
  AND r.sla_due_at < now() AND r.status NOT IN ('COMPLETED', 'REJECTED')
WHERE d.is_active = true [AND d.id = $1]
GROUP BY d.id, d.name ORDER BY d.name
-- request_type: aynı desen, request_types rt + rt.department_id = $1 (DEPARTMENT_AUTHORITY için)
```
(Kritik detay: overdue koşulu LEFT JOIN'in ON'unda olmalı, WHERE'de DEĞİL — aksi halde LEFT JOIN'in "sıfır satır" garantisi bozulur, sadece overdue'su olan departmanlar görünür, 0'lı departmanlar kaybolur. Bu, `getWorkload`'ın FILTER deseninden farklı bir tuzak, code-copilot'a açıkça vurgulanacak.)

### `stageDurations`
`getSla`'nın `JOIN LATERAL` + `EXTRACT(EPOCH FROM (...)) / 3600` deseninin 3 aşamaya genişletilmiş hali. Her talep için 3 zaman damgası LATERAL join'lerle çekilecek:
```sql
SELECT
  AVG(EXTRACT(EPOCH FROM (t_assigned.created_at - r.created_at)) / 3600)
    FILTER (WHERE t_assigned.created_at IS NOT NULL) AS open_to_assigned_avg,
  AVG(EXTRACT(EPOCH FROM (t_in_progress.created_at - t_assigned.created_at)) / 3600)
    FILTER (WHERE t_assigned.created_at IS NOT NULL AND t_in_progress.created_at IS NOT NULL) AS assigned_to_in_progress_avg,
  AVG(EXTRACT(EPOCH FROM (t_completed.created_at - t_in_progress.created_at)) / 3600)
    FILTER (WHERE t_in_progress.created_at IS NOT NULL AND t_completed.created_at IS NOT NULL) AS in_progress_to_completed_avg
FROM requests r
LEFT JOIN LATERAL (
  SELECT created_at FROM request_history
  WHERE request_id = r.id AND action = 'STATUS_CHANGED' AND new_value = 'ASSIGNED'
  ORDER BY created_at ASC LIMIT 1
) t_assigned ON true
LEFT JOIN LATERAL (
  SELECT created_at FROM request_history
  WHERE request_id = r.id AND action = 'STATUS_CHANGED' AND new_value = 'IN_PROGRESS'
  ORDER BY created_at ASC LIMIT 1
) t_in_progress ON true
LEFT JOIN LATERAL (
  SELECT created_at FROM request_history
  WHERE request_id = r.id AND action = 'STATUS_CHANGED' AND new_value = 'COMPLETED'
  ORDER BY created_at ASC LIMIT 1
) t_completed ON true
[WHERE r.department_id = $1]
```
`AVG(...) FILTER (WHERE ...)` deseni, ilgili geçiş hiç gerçekleşmemiş talepleri ortalamadan otomatik dışlıyor — sonuç `NULL` olur (SQL `AVG` üzerinde hiç satır yoksa zaten `NULL` döner), bu da AC7'nin "veri yoksa `null`" gereksinimini DOĞRUDAN karşılıyor, JS tarafında ekstra bir "totalCompleted === 0" kontrolüne (getSla'daki gibi) gerek KALMIYOR — ama `getSla`'nın 2-ondalık yuvarlama deseni (`Math.round((x + Number.EPSILON) * 100) / 100`, `null` ise atlanır) JS tarafında uygulanacak.

### `authorityWorkload`
`getWorkload`'ın "dimension-table'dan başla, LEFT JOIN ile 0'ları koru" deseninin `users` tablosuna uygulanmış hali:
```sql
SELECT
  TRIM(CONCAT(u.name, ' ', COALESCE(u.surname, ''))) AS authority_name,
  d.name AS department_name,
  COUNT(r.id)::int AS active_count
FROM users u
JOIN departments d ON d.id = u.department_id
LEFT JOIN requests r ON r.assigned_to = u.id AND r.status IN ('ASSIGNED', 'IN_PROGRESS')
WHERE u.role = 'DEPARTMENT_AUTHORITY' AND u.is_active = true [AND u.department_id = $1]
GROUP BY u.id, u.name, u.surname, d.name
ORDER BY active_count DESC, authority_name ASC
```
(`u.is_active = true` filtresi: deaktive edilmiş bir yetkilinin iş yükü görünümünde görünmesi operasyonel olarak anlamsız — `getDistribution`'ın `is_active = true` filtre deseniyle tutarlı bir uzantı, atdd.md'de açıkça sorulmadı ama mevcut projedeki `is_active` felsefesinin doğal bir devamı.)

## Migration Required?
**Hayır.** Tamamen mevcut `requests`/`request_history`/`users`/`departments`/`request_types` tablolarından türetilmiş salt-okunur sorgular.

## Risks
_(atdd.md'den taşınan + keşifte netleşenler)_
- **[Kritik SQL tuzağı]** `slaBreachByDepartment`/`slaBreachByRequestType`'ın overdue koşulu LEFT JOIN'in `ON` koşulunda olmalı, `WHERE`'de değil — aksi halde 0-ihlalli departmanlar/türler response'tan tamamen kaybolur (AC1'in "0 dahil tüm departmanlar" gereksinimini ihlal eder). code-copilot'a yukarıda örnek SQL ile açıkça gösterildi.
- `getDistribution`'ın (analytics-2b) red-team'de düzeltilen dersi (aynı hata mesajını fırlatan sorgular TEK try/catch'te olmalı, 4 ayrı değil) bu görevde BAŞTAN uygulanacak — code-copilot'a açıkça belirtildi.
- `stageDurations` sorgusu 3 LATERAL join içeriyor — veri ölçeği küçük olduğu için (mevcut projede toplam birkaç düzine talep) performans riski yok, ama code-copilot'un sorguyu gereksiz yere daha karmaşık hale getirmemesi (ör. ayrı ayrı 3 sorgu yerine tek sorguda 3 LATERAL) için yukarıdaki tam şekil verildi.

## Open Questions
Yok — mimari netleşti (3 sorgu deseni tam olarak yukarıda verildi), code-copilot'a hazır.
