# ATDD Pipeline — OpsPulse için Kullanım Kılavuzu

Bu kılavuz genel README'nin tekrarı değil — bu pipeline'ı **bu projede, bu 20 günde, seçici olarak** nasıl kullanacağını anlatıyor.

---

## 0. Kurulum (bir kere)

1. `atdd-pipeline/` klasörünü yeni reponun köküne kopyala (`opspulse/atdd-pipeline/`).
2. `CLAUDE.md`'yi ve `db/schema.sql` + `db/schema.dbml`'i de repo köküne/`db/` altına koy — pipeline'ın `plan`/`code-copilot` adımları bunları okuyacak.
3. Claude Code'da skill'leri bağla:
   ```powershell
   cmd /c mklink /J "%USERPROFILE%\.claude\skills" "<repo-yolu>\atdd-pipeline\skills"
   ```
4. `~/.claude/commands/` altına kısayollar ekle (README'de tam format var) — `/atdd`, `/plan`, `/code-copilot`, `/test-copilot`, `/verify`, `/red-team`, `/commit`.
5. `jira-sync`'i hiç kullanma — Jira/Saga instance'ın yok, bu skill'i görmezden gel, `jira-sync` çağırma.

Kontrol: Claude Code'da `/pipeline` yaz, zincirin tanındığını gör.

---

## 1. Karar: tam pipeline mi, direkt kod mu?

Her göreve başlamadan önce bu tabloya bak:

| Görev | Yaklaşım |
|---|---|
| Postgres kurulumu, `schema.sql`'i çalıştırma | **Direkt** — pipeline'a gerek yok, `plan` adımı zaten "keşfedilecek kod tabanı yok" der |
| Express iskeleti, `.env`, DB bağlantısı | **Direkt** |
| `seed.js` | **Direkt** (mekanik, tek doğru cevabı var) |
| Email/şifre auth (bcrypt, JWT, `is_active` kontrolü) | **Tam pipeline** |
| Google OAuth (account linking) | **Tam pipeline** |
| Merkezi request service (state machine, atomik claim, history) | **Tam pipeline** |
| Basit liste/filtre endpoint'leri (pattern oturduktan sonra) | **Direkt**, iş bitince tek başına `/red-team` |
| Object-level authorization gerektiren her endpoint | **Tam pipeline** ya da en azından `/red-team` |
| Analitik sorguları (2A — özet kartlar) | **Direkt** (sadece SELECT, düşük risk) |
| Real-time (Socket.io, room-scoping) | **Tam pipeline** — güvenlik riski en yüksek katman |
| AI classification/summary (DB doğrulama, rate limit) | **Tam pipeline** |

Kural: **veri bütünlüğü, yetkilendirme veya güvenlik dokunuyorsa tam pipeline; sadece mekanik/tek-yollu bir işse direkt kod + isteğe bağlı tek başına `/red-team`.**

---

## 2. CLAUDE.md'ye referans verme numarası

`/atdd` skill'i, mesajında zaten netleşmiş kategoriyi tekrar sormuyor. Bunu kullan — göreve her zaman `CLAUDE.md`'nin ilgili bölümüne işaret ederek başla, aksi halde her seferinde aynı 12 soruyu yeniden cevaplarsın.

**Kötü** (her şeyi sıfırdan sorduracak):
```
/atdd "Kullanıcı girişi ekle"
```

**İyi** (çoğu kategori zaten netleşmiş, skill sadece göreve özgü kısmı soracak):
```
/atdd "Email/şifre ile kayıt ve giriş. CLAUDE.md'deki Roles, Security ve
Backend Architecture bölümlerine göre: kayıtta rol seçilemez, herkes
EMPLOYEE olur (privilege escalation koruması), bcrypt hash, JWT —
rememberMe işaretliyse 7 gün + localStorage, değilse 1 saat +
sessionStorage, is_active her authenticated istekte DB'den tekrar
kontrol edilmeli (JWT payload'ına güvenme). db/schema.sql'deki users
tablosu zaten hazır, migration gerekmiyor."
```

Bu ikinci örnekte persona, roller, kısıt, dependency (schema hazır) zaten belirtilmiş — `/atdd` muhtemelen sadece happy-path senaryosunu, 2 edge case'i, benchmark hedefini ve rollback beklentisini soracak, 12 değil 5-6 soru.

---

## 3. Uçtan uca örnek — Email/Şifre Auth

Bunu ilk **tam pipeline** göreviniz olarak takip et.

### Adım 1 — `/atdd`

Yukarıdaki "iyi" örnek gibi bir görev tanımıyla çağır. Gelecek soru tiplerine örnek:
- "Happy path: kullanıcı hangi alanları girip Create Account'a basıyor, backend hangi sırayla ne kontrol ediyor?"
- "Edge case 1: aynı email ile ikinci kayıt denemesi — ne dönmeli?" "Edge case 2: yanlış şifre kaç denemeden sonra rate-limit'e takılmalı?"
- "Benchmark: coverage hedefi kaç %, login endpoint'i için kabul edilebilir yanıt süresi var mı?"
- "Kapsam dışı: bu görevde email doğrulama (verification link) dahil mi?" — **hayır de**, `CLAUDE.md`'de bu bilinen, çözülmemiş bir risk olarak işaretli, bu görevde çözmüyorsun.

Cevapları ver → `artifacts/email-password-auth/atdd.md` yazılır.

### Adım 2 — `/plan`

Henüz `backend/` boşsa bile çalıştır — bu sefer "keşfedilecek" bir şey azdır ama `routes/`, `controllers/`, `services/`, `middleware/` için önerilen dosya listesini üretir, `CLAUDE.md`'deki katman kuralına (Controller ince, Service iş kuralını taşır) göre.

### Adım 3 — `/code-copilot`

`atdd.md` + `plan.md`'yi bir alt ajana devreder. Sen kod yazmazsın, Claude Code da orkestratör olarak yazmaz — sonucu `artifacts/email-password-auth/code_diff.md`'de okursun.

### Adım 4 — `/test-copilot`

Aynı görev için, implementasyona karşı testler — ayrı bir çağrı, ayrı bir alt ajan.

### Adım 5 — `/verify`

Gerçek `npm run build`, varsa lint/typecheck, `npm test`. Web UI olmadığı için Lighthouse/erişilebilirlik gate'leri **N/A** işaretlenecek, bu normal — sahte PASS değil, gerçek N/A.

### Adım 6 — `/red-team`

Burada en çok değer bulacağın adım. Beklenecek gerçek bulgular:
- Rate-limit login endpoint'ine gerçekten uygulanmış mı, yoksa unutulmuş mu
- `is_active` kontrolünün JWT middleware'inde her istekte tekrar DB'den okunup okunmadığı (CLAUDE.md'de açıkça yazılı kural)
- Şifre hash'lemenin gerçekten bcrypt olup olmadığı, plaintext sızıntısı var mı
- CAVEMAN: gereksiz bir "AuthStrategy" soyutlaması, kullanılmayan bir helper eklenmiş mi

`red_team.json`'daki `verdict`'e bak: `block` ise commit'e geçme, önce düzelt.

### Adım 7 — `/commit`

Sadece sen isteyince. `red_team.json`'da `block` varsa uyarı alırsın.

---

## 4. Hızlı Referans

| Komut | Ne zaman | Girdi | Çıktı |
|---|---|---|---|
| `/atdd "<görev>"` | Yeni bir yüksek-riskli görev | Görev tanımı (CLAUDE.md'ye referansla) | `atdd.md` |
| `/plan` | atdd.md hazır olunca | `atdd.md` + gerçek repo | `plan.md` |
| `/code-copilot` | plan hazır (ya da atdd tek başına yeterliyse) | `atdd.md` + `plan.md` | implementasyon + `code_diff.md` |
| `/test-copilot` | implementasyon bitince | `atdd.md` + `code_diff.md` | test dosyaları |
| `/verify` | testler yazılınca | kod + testler | `verify_report.md` |
| `/red-team` | verify PASS olunca (ya da tek başına, direkt-kod sonrası) | `atdd.md` + `code_diff.md` + `verify_report.md` | `red_team.json` |
| `/commit` | sen istediğinde | `red_team.json` | git commit + push (onaylı) |
| `/pipeline` | "nerede kaldık" | mevcut `artifacts/` klasörü | durum özeti |

**Direkt-kod + tek başına red-team kısayolu** (mekanik görevler için): kodu Claude Code'a normal şekilde yazdır, iş bitince manuel olarak `red_team.json`'ın beklediği üç dosyayı (kaba bir `atdd.md` — ne yapmak istediğini 5 satırda yaz, gerçek `code_diff.md` yerine `git diff` çıktısı, `verify_report.md` yerine çalıştırdığın test komutunun çıktısı) hazırlayıp `/red-team`'i buna karşı çalıştırabilirsin. Tam ATDD sürecine girmeden yine bağımsız bir kalite kontrolü almış olursun.

---

## 5. Bir gate/red-team `block` derse ne yapmalısın

1. Panik yapma, bu sistemin işe yaradığının kanıtı.
2. `red_team.json`'daki `findings` listesine bak — her bulgu dosya + gerekçe içeriyor olmalı, uydurma değil.
3. Kritik olanı (severity: critical/high) önce düzelt, düzelttikten sonra **yeniden `/verify` + `/red-team` çalıştır**, önceki raporu güncel say ma.
4. `/commit`'e sadece `ready_to_commit` alanındaki maddelerin hepsi `true` olduğunda geç.

---

## 6. Bu projeye özgü hatırlatmalar

- `jira-sync`'i hiç çağırma.
- İskelet aşamasında (`Postgres kur`, `Express başlat`, `seed.js`) pipeline'ı zorlamana gerek yok.
- Her `/atdd` çağrısında `CLAUDE.md`'ye referans ver — hem soru sayısını azaltır hem de projenin kilitli kararlarının (reopen yok, 20 gün kısıtı, department_id server-derived, vs.) yanlışlıkla yeniden tartışılmasını engeller.
- Real-time (Socket.io) görevinde `/atdd` sorularına room-scoping/JWT-handshake gereksinimini mutlaka açıkça yaz — bu, `CLAUDE.md`'de "henüz çözülmemiş, baştan tasarlanmalı" diye işaretli tek güvenlik maddesi.
