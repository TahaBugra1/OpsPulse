# Nasıl Kullanılır — ATDD Pipeline

Bu klasör (`atdd-pipeline/`) tamamen taşınabilir: içinde sır yok, tüm
scriptler ve skill'ler klasörün kendi içinde. Başka bir bilgisayara/projeye
kopyalayıp kurabilirsin.

## 1. İçerik haritası

```
atdd-pipeline/
├── skills/
│   ├── atdd/               ← 1. adım: 8-12 soru → ATDD taslağı
│   ├── jira-sync/           ← EK: Jira/Saga entegrasyonu (opsiyonel, sadece Jira ID verildiyse)
│   ├── plan/                ← 2. adım: read-only dosya-etki planı
│   ├── code-copilot/        ← 3. adım: implementasyonu bir alt ajan yazar
│   ├── test-copilot/        ← 4. adım: testleri bir alt ajan yazar
│   ├── verify/               ← 5. adım: build/lint/type/unit/e2e gate'leri
│   ├── red-team/            ← 6. adım: güvenlik/kalite incelemesi (sadece Claude, dış modele bağımlı değil)
│   ├── commit/               ← 7. adım (opsiyonel): commit+push
│   ├── code/                 ← DEPRECATED, code-copilot'a yönlendirir
│   └── test/                 ← DEPRECATED, test-copilot'a yönlendirir
├── .github/prompts/      ← VS Code Copilot Chat için /atdd /code /test /red-team /commit
└── .gitignore
```

**Çekirdek pipeline** (`atdd → code-copilot → test-copilot → red-team → commit`)
her projede olduğu gibi çalışır, hiçbir düzenleme gerektirmez.

## 2. Çekirdek pipeline nasıl çalışır

```
/atdd "<görev tanımı>"
  → 8-12 adaptif soru sorar (AskUserQuestion / numaralı liste)
  → artifacts/<task-slug>/atdd.md yazar

/jira-sync  (opsiyonel, sadece bir Jira ID verildiyse)
  → issue'yu çeker + Saga task oluşturur/günceller

/plan
  → atdd.md'yi ve gerçek kod tabanını referans alır (read-only)
  → artifacts/<task-slug>/plan.md yazar

/code-copilot
  → atdd.md + plan.md'yi referans alır, implementasyonu bir alt ajan (Agent tool) yazar
  → artifacts/<task-slug>/code_diff.md yazar

/test-copilot
  → atdd.md + code_diff.md'yi referans alır, testleri bir alt ajan yazar

/verify
  → build/lint/type/unit/e2e gate'lerini gerçekten çalıştırır
  → artifacts/<task-slug>/verify_report.md yazar

/red-team
  → atdd.md + code_diff.md + verify_report.md'yi inceler — SADECE Claude
    çalıştırır, hiçbir dış modele bağımlı değildir
  → nihai verdict (approve / approve-with-changes / block)
  → artifacts/<task-slug>/red_team.json yazar

/commit  (SADECE kullanıcı isterse, otomatik tetiklenmez)
  → git status/diff özetler, red_team.json'daki "block" varsa uyarır
  → commit mesajını Claude kendisi üretir (dış modele bağımlı değil)
  → push'tan ÖNCE mutlaka kullanıcı onayı ister
```

## 3. Kurulum (yeni makine/proje)

1. Bu klasörü hedef projenin köküne kopyala.
2. Claude Code: `~/.claude/skills/` altına `skills/`'i symlink/junction yap
   (README.md'de tam komutlar var), `~/.claude/commands/` altına
   `atdd.md`/`code-copilot.md`/... kısayol dosyaları ekle.
3. VS Code Copilot Chat: `.github/prompts/` repo kökünde olduğu sürece
   otomatik algılanır.
4. Başla: `/atdd <görev tanımı>` → sırayla `/plan` → `/code-copilot` →
   `/test-copilot` → `/verify` → `/red-team` → (istersen) `/commit`.

Detaylı kurulum adımları için [README.md](README.md)'ye bak — bu dosya
sadece "hangi skill ne işe yarar" akış anlatımı içindir.

## 4. jira-sync — ne zaman devreye girer

`jira-sync`, pipeline'ın Jira/Saga entegrasyon skill'idir; kullanıcı bir
Jira ID verdiğinde (`atdd` çağırır) veya "nerede kaldık" diye sorulduğunda
devreye girer. Kendi Jira/Saga instance'ına ait proje/epic ID'lerini
`skills/jira-sync/SKILL.md`'nin "Configuration" bölümüne göre kendi
ortamınla doldur — dosya bunları sabit olarak içermez, ilk kullanımda
Jira/Saga MCP araçlarıyla doğrula.
