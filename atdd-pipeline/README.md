# ATDD Pipeline (atdd → jira-sync → plan → code-copilot → test-copilot → verify → red-team → commit)

Paylaşılabilir, kendi kendine yeten klasör — bu klasörü olduğu gibi başka
bir projeye/makineye kopyalayıp kur. **Sır içermez** — API anahtarı yok.
Kod/test yazımı bir alt ajana (Agent tool, `subagent_type: general-purpose`)
delege edilir; harici bir CLI'ye veya kimlik doğrulamasına bağımlı değildir.

## Akış

```
/atdd         ──► artifacts/<task-slug>/atdd.md          (8-12 adaptif soru → ATDD taslağı)
/jira-sync    ──► Jira issue → Saga task (opsiyonel, sadece Jira ID verildiyse)
/plan         ──► artifacts/<task-slug>/plan.md           (gerçek kod tabanını tarar, dosya listesi)
/code-copilot ──► artifacts/<task-slug>/code_diff.md      (alt ajan yazar, orkestratör sadece okuyup doğrular)
/test-copilot ──► test dosyaları                          (implementasyona karşı, alt ajan yazar)
/verify       ──► artifacts/<task-slug>/verify_report.md  (build/lint/type/unit/e2e gate'leri, PASS/FAIL)
/red-team     ──► artifacts/<task-slug>/red_team.json     (SADECE Claude çalıştırır, kod yazmaz)
/commit       ──► git commit + push                       (SADECE kullanıcı isteğiyle)
```

Her adım bir öncekinin ürettiği dosyayı referans alır. Kod/test yazımı bir
alt ajana (Agent tool) delege edilir — orkestratör bu pipeline'da
implementasyon dosyalarına `Write`/`Edit` yapmaz, sadece yönlendirir ve
okuyarak doğrular.

## Klasör yapısı

```
atdd-pipeline/
├── nasil_kullanilir.md       # iş akışı anlatımı — buradan başla
├── skills/
│   ├── atdd/SKILL.md
│   ├── jira-sync/SKILL.md
│   ├── plan/SKILL.md
│   ├── code-copilot/SKILL.md
│   ├── test-copilot/SKILL.md
│   ├── verify/SKILL.md
│   ├── red-team/SKILL.md
│   ├── commit/SKILL.md
│   ├── pipeline/SKILL.md              # orkestrasyon referansı — "sıradaki adım ne?"
│   ├── code/SKILL.md                  # DEPRECATED — code-copilot'a yönlendirir
│   └── test/SKILL.md                  # DEPRECATED — test-copilot'a yönlendirir
├── .github/prompts/
│   ├── atdd.prompt.md
│   ├── code.prompt.md
│   ├── test.prompt.md
│   ├── red-team.prompt.md
│   └── commit.prompt.md
└── .gitignore
```

## Kurulum

1. Bu klasörü hedef projenin köküne kopyala (örn. `<proje>/atdd-pipeline/`).
2. **Claude Code:**
   - `~/.claude/skills/` içine bu klasördeki `skills/`'i junction/symlink yap:
     ```powershell
     New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.claude\skills" -Target "<bu-klasör>\skills"
     ```
     Admin/Geliştirici Modu yoksa junction kullan (admin gerekmez):
     ```powershell
     cmd /c mklink /J "$env:USERPROFILE\.claude\skills" "<bu-klasör>\skills"
     ```
   - `~/.claude/commands/` altına her skill için bir komut dosyası ekle:
     ```markdown
     # /<isim>
     Kanonik talimat: `<bu-klasör>/skills/<isim>/SKILL.md`. Skill tool ile (`skill: "<isim>"`) çağır.
     ```
3. **Copilot:** Bu klasörün `.github/prompts/` alt klasörü repo kökünde olduğu sürece VS Code Copilot Chat otomatik algılar.
4. Başla: `/atdd <görev tanımı>` → sırayla `/plan` → `/code-copilot` → `/test-copilot` → `/verify` → `/red-team` → (istersen) `/commit`. Sıradaki adımdan emin değilsen `/pipeline`'a sor.

## Kurallar (özet)
- `atdd`: 8-12 adaptif soru zorunlu, atlanamaz.
- `plan`: read-only, dosya listesi çıkarır, kod yazmaz.
- `code-copilot`/`test-copilot`: kod/test yazımı SADECE bir alt ajanda (Agent tool), orkestratör Write/Edit yapmaz.
- `verify`: gerçek gate sonuçlarını (PASS/FAIL/N/A) raporlar, kod yazmaz/düzeltmez.
- `red-team`: SADECE Claude çalıştırır; kod değiştirmez, sadece bulgu raporu üretir.
- `commit`: otomatik tetiklenmez, push'tan önce her zaman onay ister.
