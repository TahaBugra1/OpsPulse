# Plan — analytics-2b
_Reference: atdd.md_

## Files to Modify

| File | Why | Risk |
|------|-----|------|
| `backend/services/analytics.service.js` | Yeni `getDistribution(query, user)` fonksiyonu eklenecek. Mevcut `scopeToDepartment(user)` AYNEN reuse edilecek (EMPLOYEE → 403, DEPARTMENT_AUTHORITY → kendi departmanı, ADMIN → tüm sistem) — AC3/AC4. 4 kırılım (`status`, `requestType`, `department`, `priority`) + `volumeOverTime` zaman serisi tek fonksiyonda üretilecek (birden fazla sorgu çalıştırıp tek bir response nesnesinde birleştirerek, ya da tek bir büyük sorgu yerine — CAVEMAN'a göre en basit/okunur olan hangisiyse ona bırakılıyor, code-copilot karar verecek). `days` param validasyonu (`fail(400, ...)`, 1-90 aralığı, sayısal olmalı) burada yapılacak. | medium (yeni bir fonksiyon ama mevcut desenlerin (fail/scopeToDepartment/try-catch) doğrudan devamı, düşük mimari risk) |
| `backend/controllers/analytics.controller.js` | Yeni `getDistributionHandler` — mevcut 3 handler'ın (`getSummaryHandler` vb.) BİREBİR aynı ince try/catch şablonu (`req.query` üzerinden `days`'i servise geçirmek dışında). | low |
| `backend/routes/analytics.routes.js` | Yeni `router.get('/distribution', getDistributionHandler)` satırı, mevcut 3 route'un yanına. | low |

## New Files
Yok — atdd.md'nin "mevcut 3 dosyaya ekleme" kararıyla tutarlı, hiçbir yeni dosya gerekmiyor.

## Dependencies
- `backend/services/analytics.service.js`'in mevcut `fail(status, message)` helper'ı — servis dosyasının kendi lokal kopyası, proje konvansiyonu (paylaşılan bir utils modülü yok).
- `backend/services/analytics.service.js`'in mevcut `scopeToDepartment(user)` fonksiyonu — **DEĞİŞTİRİLMEDEN** reuse edilecek (plan aşamasında netleşen kritik karar: bu fonksiyon `getSummary`/`getSla`/`getWorkload` tarafından da kullanılıyor, burada değiştirmek onların davranışını da etkiler ve mevcut 2 EMPLOYEE-403 testini bozardı).
- `db/schema.sql`'deki `requests.status`/`.priority` CHECK değerleri (5 status, `HIGH`/`MEDIUM`/`LOW` priority) — `status`/`priority` kırılımlarının TÜM olası değerlerini (0 dahil) listelemesi için bu sabit listeler kod içinde bilinmeli (DB'den DISTINCT çekmek yerine — aksi halde sıfır-sayılı bir status/priority hiç görünmez, tam da AC8'in yasakladığı şey).
- `departments`/`request_types` tabloları — `department`/`requestType` kırılımlarının TÜM `is_active = true` satırlarını (0 dahil) listelemesi için bu tablolardan LEFT JOIN ile çekilmeli (analytics-2a'nın `getWorkload`'ının `departments d LEFT JOIN requests r` deseniyle birebir aynı yaklaşım — `requests` tablosundan DISTINCT çekmek yerine `departments`/`request_types`'tan başlayıp LEFT JOIN yapmak, sıfır-talepli departman/türün de listede 0 ile görünmesini garanti eder).
- `volumeOverTime` için: Postgres'in `generate_series(current_date - (days-1), current_date, '1 day')` deseni + `requests`'e LEFT JOIN — bu da aynı "sıfır güne rağmen görünür olsun" prensibinin zaman serisi karşılığı (analytics-2a'da hiç kullanılmamış yeni bir SQL deseni, ama aynı temel fikrin — LEFT JOIN'den başlayarak eksik satırları 0'a tamamlama — doğal bir uzantısı).

## Migration Required?
**Hayır.** Hiçbir yeni kolon/tablo gerekmiyor, tamamen türetilmiş salt-okunur sorgular.

## Risks
_(atdd.md'den taşınan + keşifte netleşenler)_
- **[Kritik keşif, kullanıcıyla netleşti]** atdd.md'nin ilk taslağı EMPLOYEE'nin kendi taleplerini görebileceğini varsaymıştı — gerçek kod (`scopeToDepartment`) bunu 403 ile engelliyor, analytics-2a'nın kendi bilinçli kararı. Kullanıcı onayıyla atdd.md düzeltildi (EMPLOYEE → 403). code-copilot bu konuda YANLIŞ bir varsayımla çalışmayacak.
- `status`/`priority` kırılımlarının "0 dahil tüm değerler" gereksinimi (AC1, AC8), DB'den `DISTINCT status FROM requests` gibi bir sorguyla YANLIŞ karşılanır (sıfır-sayılı değerler hiç görünmez) — code-copilot'a sabit listelerin (CHECK constraint'lerindeki 5 status, 3 priority) kod içinde tanımlanması gerektiği açıkça belirtilecek.
- `days` param validasyonu: `parseInt('abc')` gibi durumlar `NaN` üretir, `NaN` bir SQL parametresi olarak Postgres'e gönderilirse anlamsız bir hataya yol açar — code-copilot'a validasyonun SQL sorgusundan ÖNCE, açık bir `Number.isInteger` + aralık kontrolüyle yapılması gerektiği belirtilecek.

## Open Questions
Yukarıdaki EMPLOYEE erişim çelişkisi zaten kullanıcıyla çözüldü (bkz. Risks). Başka açık soru yok, mimari netleşti, code-copilot'a hazır.
