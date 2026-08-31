---
task_slug: request-comments
jira_id: null
saga_task_id: null
priority: high
coverage_target: 85
performance_target: "<300ms"
memory_target: null
test_strategy:
  unit: 70
  integration: 20
  e2e: 10
affected_modules:
  - backend/routes/requests.routes.js (modify — add POST /:id/comments, GET /:id/comments)
  - backend/controllers/requests.controller.js (modify — addCommentHandler, getCommentsHandler)
  - backend/services/requests.service.js (modify — addComment, listComments)
---

# ATDD — request-comments

## Jira Kaynağı
Jira'ya bağlı değil — yerel görev.

## Persona
- **EMPLOYEE**: kendi talebine soru sorar/açıklama ekler.
- **DEPARTMENT_AUTHORITY**: kendi departmanındaki (atanmış olsun olmasın) bir talebe süreç hakkında bilgi verir.
- **ADMIN**: sadece görüntüler, yorum yazamaz (request-service görevindeki "ADMIN write yapamaz" kararının devamı).

## Hedef (Neden)
`request_comments` tablosu şemada baştan beri var ama hiç kullanılmıyordu; `notifications.type`'daki `COMMENT_ADDED` de request-service görevinde bilinçli olarak kapsam dışı bırakılmıştı. Bu görev, taleplere iletişim/audit katmanı ekliyor — CLAUDE.md'nin Real-Time 3A katmanı ("Request Detail live status/priority/comment updates") bu tabloya doğrudan bağımlı, o yüzden bu görev ön koşul.

## User Story
As a çalışan veya departman yetkilisi
I want bir talebe yorum ekleyip geçmiş yorumları görebilmek
So that talep hakkında ek bilgi/soru/açıklama paylaşılabilsin

## Acceptance Criteria (Given-When-Then, önceliklendirilmiş)

1. [Critical] Given talebi oluşturan EMPLOYEE, When `POST /api/requests/:id/comments` `{content}` ile çağrılır, Then `request_comments`'e `author_id=req.user.id` ile INSERT edilir, request'in `assigned_to`'su varsa ona `COMMENT_ADDED` notification'ı oluşturulur (kendi kendine değil) — **her ikisi de tek DB transaction'ı içinde** — 201 ile oluşan yorum döner.

2. [Critical] Given kendi departmanındaki bir talebe (atanmış olsun olmasın) yorum yazan bir DEPARTMENT_AUTHORITY, When `POST /api/requests/:id/comments` çağrılır, Then yorum eklenir, talebi oluşturan EMPLOYEE'ye `COMMENT_ADDED` notification'ı oluşturulur, 201 döner.

3. [High] Given yetkisiz bir kullanıcı (talebi görme yetkisi olmayan bir EMPLOYEE veya farklı departmandan bir DEPARTMENT_AUTHORITY, ya da herhangi bir ADMIN), When `POST /api/requests/:id/comments` çağrılır, Then `403` döner, hiçbir satır eklenmez.

4. [Critical] Given bir talebi görüntüleme yetkisi olan herhangi biri (sahibi/kendi departmanındaki authority/ADMIN — request-read'deki `getRequestById` ile aynı kurallar), When `GET /api/requests/:id/comments` çağrılır, Then o talebe ait tüm yorumlar (en eski önce, kronolojik) döner.

5. [High] Given görüntüleme yetkisi olmayan biri, When `GET /api/requests/:id/comments` çağrılır, Then `403` döner.

6. [High] Given boş veya sadece boşluk karakterlerinden oluşan bir `content`, When `POST /api/requests/:id/comments` çağrılır, Then `400` döner, satır eklenmez.

7. [Medium] Given 2000 karakterden uzun bir `content`, When `POST /api/requests/:id/comments` çağrılır, Then `400` döner.

8. [High] Given `COMPLETED` veya `REJECTED` (terminal) durumdaki bir talep, When görüntüleme yetkisi olan biri yorum eklerse, Then normal şekilde `201` ile başarılı olur — state machine'i etkilemez, yorum her zaman eklenebilir.

9. [High] Given var olmayan bir talep `id`'si, When `POST` veya `GET .../comments` çağrılır, Then `404` döner.

10. [Medium] Given `addComment`'in transaction'ı içinde bir adımda (yorum INSERT veya notification INSERT) DB hatası oluşursa, When `POST /api/requests/:id/comments` çağrılır, Then transaction tamamen ROLLBACK edilir, `500` generic mesajıyla döner, yarım kalan state oluşmaz.

11. [High] Given ADMIN rolündeki bir kullanıcı, When `POST /api/requests/:id/comments` çağrılır (görüntüleme yetkisi olsa bile), Then `403` döner — ADMIN bu görevde de write yapamaz.

## Test Strategy
Unit: 70% — yetki/validasyon mantığı (mocked DB ile)
Integration: 20% — gerçek Postgres'e karşı `POST`/`GET .../comments`, üç rol + terminal-state + notification-alıcı senaryoları
E2E: 10% — şimdilik **N/A** (frontend henüz yok)

## Benchmark / Başarı Ölçütü
Coverage Target: 85%
Performance Target: <300ms
Memory: belirtilmedi
Diğer ölçülebilir kriterler: yok

## Kapsam Dışı
- Yorum düzenleme/silme — şema bunu desteklemiyor (`request_comments`'te `updated_at`/soft-delete kolonu yok), bilinçli bir tasarım kararı, bu görevde de eklenmiyor.
- Yorumlarda pagination — request-read görevindeki "veri az, pagination ayrı bir göreve" kararıyla tutarlı, burada da yok.
- Yorum içinde dosya eki, mention/etiketleme, zengin metin — proje genelinde kapsam dışı (dosya eki) veya hiç istenmemiş (mention/rich text).
- Real-Time 3A'nın kendisi (canlı yorum güncellemesi/Socket.io) — bu görev sadece REST CRUD'u sağlıyor, Real-Time 3A ayrı bir görev.

## Etkilenen Dosyalar/Modüller (bilinen)
- `backend/services/requests.service.js` (mevcut — `addComment`, `listComments` eklenecek, mevcut 6 fonksiyona dokunulmayacak)
- `backend/controllers/requests.controller.js` (mevcut — 2 yeni controller)
- `backend/routes/requests.routes.js` (mevcut — `POST /:id/comments`, `GET /:id/comments` eklenecek)
- Migration YOK — `request_comments` ve `notifications` tabloları zaten hazır.

## Rollback Beklentisi
`addComment`'in yorum INSERT + notification INSERT adımları tek DB transaction'ı içinde (AC10) — `requests.service.js`'deki mevcut `withTransaction` helper'ı reuse edilecek.

## Risks
- Notification alıcısının belirlenmesi: "karşı taraf" tanımı request'in `assigned_to` alanına bağlı — `OPEN` (henüz atanmamış) bir talebe sahibi yorum yazarsa, bildirilecek belirli bir "karşı taraf" yok (bkz. Assumptions).
- `withTransaction` helper'ının çağrı sırası — yorum yazan kişi aynı zamanda notification alıcısı olmamalı (kendi kendine bildirim gitmemeli), bu servis katmanında açıkça kontrol edilmeli.

## Assumptions
- Talep `OPEN` (henüz kimseye atanmamış) durumdayken sahibi (EMPLOYEE) yorum yazarsa, bildirilecek belirli bir departman yetkilisi olmadığı için **hiçbir notification oluşturulmaz** (department'a broadcast yapılmaz — mevcut `notifications` şeması tek bir `user_id`'ye bağlı, broadcast desteklemiyor). Bu, kullanıcıya sorulmadı, mantıklı bir varsayım olarak işaretleniyor.
- `GET .../comments` response'unda, request-read görevindeki `created_by_name` deseniyle tutarlı olması için her yorumun yazarının adı da (`author_name`) join'lenerek dönecek — kullanıcıya açıkça sorulmadı, established pattern'den çıkarım.
- Yorumlar kronolojik (en eski önce, `created_at ASC`) sıralanacak — bir sohbet/audit akışı için doğal sıralama, kullanıcıya sorulmadı ama request-read'in "en yeni önce" listesinden farklı olarak burada "konuşma akışı" mantığı daha uygun.

## Unknowns
- Yok.

## Sorular ve Cevaplar (ham kayıt)
1. Yorum yazma yetkisi → Standart: talebi görebilen (sahibi + kendi departmanındaki authority) yorum yapabilir.
2. ADMIN yorum yazabilir mi → Hayır, sadece görüntüler.
3. Yorum görüntüleme yetkisi → request-read'deki aynı kurallar.
4. Terminal durumda yorum → Evet, hâlâ yapılabilir.
5. İçerik validasyonu → Boş olamaz, max 2000 karakter.
6. Yorum bildirimi → Evet, karşı tarafa (kendi kendine değil).
7. Endpoint tasarımı → POST/GET /api/requests/:id/comments.
8. Transaction beklentisi → Tek transaction (yorum + notification).
9. Coverage hedefi → 85%.
10. Performans hedefi → <300ms.
11. Test stratejisi → 70/20/10 onaylandı.
12. Kabul kriteri sahibi → Otomatik testler + /verify + /red-team yeterli, manuel Postman testi zorunlu değil.
