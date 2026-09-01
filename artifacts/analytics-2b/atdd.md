---
task_slug: analytics-2b
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
  - backend/services/analytics.service.js (modify — yeni getDistribution fonksiyonu)
  - backend/controllers/analytics.controller.js (modify — yeni getDistributionHandler)
  - backend/routes/analytics.routes.js (modify — yeni GET /distribution satırı)
---

# ATDD — analytics-2b

## Jira Kaynağı
Jira'ya bağlı değil — yerel görev.

## Persona
- **EMPLOYEE**: bu görevde erişimi yok — analytics-2a'nın kendi kararıyla tutarlı ("analytics bir yönetim/gözetim özelliği"), `403` döner. (plan.md aşamasında keşfedildi: mevcut `scopeToDepartment()` zaten bunu uyguluyor, `getSummary`/`getSla`/`getWorkload` ile paylaşılıyor.)
- **DEPARTMENT_AUTHORITY**: kendi departmanına ait taleplerin dağılımını görür.
- **ADMIN**: sistem geneli tüm taleplerin dağılımını görür.

## Hedef (Neden)
CLAUDE.md'nin upgrade layer sırasında Real-Time 3B'den (garanti kapsamın tamamlanması) sonraki ilk "upside" katman. Analytics 2A (summary/sla/workload) zaten operasyonel görünürlük sağlıyordu; bu görev buna görsel-hazır kırılım verisi (dağılım grafikleri için) ve zaman içindeki hacim trendini ekliyor — CLAUDE.md'nin API Design Principles'ta zaten öngördüğü `GET /api/analytics/distribution` yüzeyini hayata geçiriyor.

## User Story
As a kimliği doğrulanmış bir kullanıcı (EMPLOYEE/DEPARTMENT_AUTHORITY/ADMIN)
I want kendi kapsamımdaki taleplerin durum/tür/departman/öncelik dağılımını ve son N günlük hacim trendini görebilmek
So that hangi kategori talebin öne çıktığını ve hacmin nasıl değiştiğini anlayabileyim

## Acceptance Criteria (Given-When-Then, önceliklendirilmiş)

1. [Critical] Given kimliği doğrulanmış bir ADMIN, When `GET /api/analytics/distribution` (query param'sız) çağrılırsa, Then 200 döner ve response şu 4 kırılımı içerir: `status` (OPEN/ASSIGNED/IN_PROGRESS/COMPLETED/REJECTED sayıları), `requestType` (her aktif request_type'ın sayısı), `department` (her departmanın sayısı), `priority` (HIGH/MEDIUM/LOW sayıları) — HER kategorideki TÜM olası değerler, sayı 0 olsa bile listede yer alır.

2. [Critical] Given aynı endpoint, When çağrılırsa, Then response ayrıca `volumeOverTime` alanında son 30 gün (varsayılan) için günlük talep oluşturma sayısını (kronolojik sırayla, en eskiden en yeniye) içerir — her gün için bir veri noktası, o gün 0 talep olsa bile.

3. [Critical] Given kimliği doğrulanmış bir EMPLOYEE, When `GET /api/analytics/distribution` çağrılırsa, Then `403` döner (analytics-2a'nın `summary`/`sla`/`workload` endpoint'leriyle birebir aynı, paylaşılan `scopeToDepartment()` davranışı — `code-copilot`, plan.md'nin bulgusuyla düzeltildi).

4. [Critical] Given kimliği doğrulanmış bir DEPARTMENT_AUTHORITY, When aynı endpoint çağrılırsa, Then SADECE kendi departmanına ait taleplerin dağılımı/hacmi döner.

5. [High] Given `?days=7` query param'ı, When çağrılırsa, Then `volumeOverTime` tam olarak 7 günlük veri noktası içerir (7 gün öncesinden bugüne).

6. [High] Given geçersiz bir `days` değeri (`days=abc`, `days=-5`, `days=0`, `days=91`), When çağrılırsa, Then 400 döner, net bir hata mesajıyla (sessizce varsayılana düşülmez).

7. [High] Given `days=1` veya `days=90` (sınır değerleri), When çağrılırsa, Then ikisi de kabul edilir, 400 dönmez.

8. [High] Given bir kullanıcının (veya departmanın) kapsamında HİÇ talep yoksa, When endpoint çağrılırsa, Then tüm dağılım kategorileri VE tüm `volumeOverTime` günleri 0 değeriyle listelenir — hiçbir anahtar eksik olmaz (analytics-2a'nın "sıfır talepli departman" dersiyle tutarlı).

9. [Medium] Given `days` query param'ı verilmezse, When çağrılırsa, Then varsayılan 30 gün kullanılır.

## Test Strategy
Unit: 70% — `getDistribution` servis fonksiyonunun kırılım/zaman-serisi mantığı, `days` validasyonu
Integration: 20% — gerçek Postgres'e karşı rol-bazlı kapsam senaryoları (EMPLOYEE/DEPARTMENT_AUTHORITY/ADMIN), sıfır-veri senaryosu
E2E: 10% — N/A (frontend henüz yok)

## Benchmark / Başarı Ölçütü
Coverage Target: 85%
Performance Target: <300ms (analytics-2a ile aynı)
Memory: belirtilmedi
Diğer ölçülebilir kriterler: yok

## Kapsam Dışı
- Frontend chart/UI bileşeni — frontend henüz yok, bu görev sadece backend türetilmiş sorgular.
- Özel tarih aralığı seçimi (`from`/`to` parametreleri) — sadece "son N gün" var.
- Gerçek zamanlı/canlı güncelleme (WebSocket) — bu salt REST/pull-based bir analitik endpoint'i, Real-Time 3C/sonrası ayrı bir konu.
- Çapraz filtreleme (ör. sadece belirli bir request_type'ın zaman serisi) — `volumeOverTime` TOPLAM hacim, kırılımlı zaman serisi değil.
- Manuel doğrulama — bu salt-okunur, state değiştirmeyen bir endpoint (realtime görevlerinin WebSocket yetkilendirme riski burada yok), otomatik testler yeterli kabul edildi (kullanıcı kararı).

## Etkilenen Dosyalar/Modüller (bilinen)
- `backend/services/analytics.service.js` — yeni `getDistribution(query, user)` fonksiyonu (mevcut `getSummary`/`getSla`/`getWorkload`'ın yanına).
- `backend/controllers/analytics.controller.js` — yeni `getDistributionHandler`.
- `backend/routes/analytics.routes.js` — yeni `router.get('/distribution', getDistributionHandler)` satırı.
- Migration YOK — hiçbir şema değişikliği gerekmiyor (CLAUDE.md'nin "layers 2-10 hiçbiri şema değişikliği gerektirmez" kuralıyla tutarlı).

## Rollback Beklentisi
Salt-okunur bir endpoint — hiçbir veri yazılmıyor, hata durumunda (DB sorgu hatası, geçersiz param) sadece uygun HTTP status kodu (400/500) ve hata mesajı döner, analytics-2a'daki `fail()` desenine uygun. Rollback kavramı bu görev için geçerli değil (yazma işlemi yok).

## Risks
- analytics-2a'dan devralınan desenler yeterli kabul edildi, bu görevde yeni bir risk tanımlanmadı (kullanıcı kararı).

## Assumptions
- Günlük gruplama, veritabanının kendi `created_at::date` (UTC, Postgres varsayılanı) değerine göre yapılacak — kullanıcı zaman dilimi/lokal saat ayrımı istemedi, bu teknik bir varsayım olarak işaretleniyor.
- `requestType`/`department` kırılımları, ilgili tablolardaki TÜM `is_active` request_type'ları/departmanları kapsar (pasif olanlar dahil değil) — analytics-2a'nın workload endpoint'iyle tutarlı bir varsayım, açıkça sorulmadı.
- Response şekli (alan adları: `status`, `requestType`, `department`, `priority`, `volumeOverTime`) plan.md aşamasında kesinleşecek, burada kavramsal olarak belirtildi.

## Unknowns
- Yok — 12 soru ile tüm kategoriler netleşti.

## Sorular ve Cevaplar (ham kayıt)
1. Dağılım boyutu → Status + Request Type + Departman + Priority (hepsi).
2. Zaman serisi → Günlük talep oluşturma sayısı, son N gün.
3. Endpoint yapısı → Tek endpoint: `GET /api/analytics/distribution` (CLAUDE.md'nin API listesindeki isimle birebir).
4. Rol bazlı kapsam → analytics-2a ile aynı desen istendi; plan.md aşamasında kod keşfiyle netleşti ki 2A'nın gerçek davranışı EMPLOYEE'yi TAMAMEN dışarıda bırakıyor (403, paylaşılan `scopeToDepartment()`) — kullanıcıya bu çelişki gösterildi, "2A ile aynı: EMPLOYEE 403 alır" seçeneği onaylandı (AC3 buna göre düzeltildi).
5. N gün hedefi → Varsayılan 30, query param ile 1-90 arası ayarlanabilir.
6. Geçersiz param → 400, net hata mesajı.
7. Boş veri → Tüm kategoriler 0 ile listelenir, eksik anahtar yok.
8. Benchmark → analytics-2a ile aynı (<300ms, %85 coverage, 70/20/10).
9. Kapsam dışı → Frontend UI, özel tarih aralığı, canlı güncelleme, çapraz filtreleme — hepsi kapsam dışı.
10. Kabul kriteri sahibi → Otomatik testler yeterli, manuel doğrulama gerekmiyor (salt-okunur, düşük risk).
11. Bilinen risk/varsayım → analytics-2a'dan devralınanlar yeterli, yeni risk yok.
12. Etkilenen dosyalar → Mevcut 3 dosyaya ekleme (yeni dosya yok).
