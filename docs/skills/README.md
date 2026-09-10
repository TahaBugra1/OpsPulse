# Skill'ler — Çalışma Yöntemi Rehberleri

Bu klasördeki `.md` dosyaları, projenin Claude Code'da kullanılan **skill**'lerinin
kopyalarıdır. Her biri tek bir markdown talimat dosyası — herhangi bir agent'a
"kural" / "context" olarak verilebilir. Kaynak: `~/.claude/skills/<isim>/SKILL.md`.

**Nasıl kullanılır (Antigravity vb.):** Kısa, her-zaman-açık kuralları workspace
rules'a koy (`.agents/rules/`). Bu klasördeki uzun rehberleri ise agent'a
gerektiğinde `@docs/skills/X.md` ile okut — hepsini rules'a tıkmaya çalışma.

---

## Pipeline skill'leri (özellik geliştirme akışı)

Sıra: `atdd → plan → code-copilot → test-copilot → verify → red-team → commit`
Auth / authorization / state-machine / realtime dokunan işlerde tam akış; mekanik
işlerde direkt kod (bkz. `docs/atdd_pipeline_usage_guide.md`).

| Dosya | İşi |
|---|---|
| `atdd.md` | Yeni özellikten önce 8-12 netleştirme sorusu → `artifacts/<slug>/atdd.md` (kabul kriterleri + test stratejisi) |
| `plan.md` | Salt-okunur; kodu okuyup dosya-etki planı + migration kontrolü → `plan.md` |
| `code-copilot.md` | İmplementasyonu yazma yönergesi (Claude Code'da ayrı subagent'a delege; Antigravity'de kendi executor'ı yazar — sadece "her diff'i bağımsız doğrula" prensibini koru) |
| `test-copilot.md` | Test yazma yönergesi |
| `verify.md` | Build/lint/type/test kapılarını gerçekten çalıştırıp PASS/FAIL/N/A raporla — asla sahte "geçti" deme |
| `red-team.md` | Commit öncesi bağımsız kod incelemesi → bulgu raporu + "commit'e hazır mı" verdict |
| `commit.md` | Kullanıcı onayı olmadan asla commit/push etme; kapsam gözden geçirme + Conventional Commit + push öncesi 2. onay |
| `pipeline.md` | Akışın genel orkestrasyon referansı |

## Tasarım rehberi skill'leri

Frontend tasarım pası için. **Ana çatı: `operational-expert-tool-ui`** (OpsPulse bir
B2B operasyon aracı — yoğunluk > whitespace, at-a-glance durum).

| Dosya | Ne zaman |
|---|---|
| `operational-expert-tool-ui.md` | **Ana çatı.** Bilgi yoğunluğu, kompakt satırlar (28-36px), workflow linearity, her zaman görünür durum |
| `component-family-consistency.md` | button/input/select/badge/card — tek radius/height/border/focus DNA'sı; concentric köşe matematiği |
| `color-mode-and-theme.md` | token/palet, light/dark; tema switcher ne zaman |
| `status-colors-and-errors.md` | Durum renkleri: **4 renk maks** (kırmızı=hata, amber=SADECE uyarı, yeşil=başarı, mavi=bilgi), her renk tek anlam; hata mesajı anatomisi |
| `form-design.md` | helper text / placeholder / validation üç katmanı; submit ne zaman aktif |
| `loading-states-and-perceived-performance.md` | spinner vs skeleton vs progress; öncelik sırasıyla yükleme |
| `modal-and-overlay-patterns.md` | modal / drawer / bottom sheet / popover — hangisi ne zaman |
| `notifications-and-recovery.md` | toast / inline error / banner rolleri; in-place editing |
| `data-display-and-selection.md` | grid/list/table görünümleri; satır seçim hit-area; mass action; sayı okunabilirliği |
| `wcag-accessibility.md` | WCAG 2.2 AA (EAA / EN 301 549) |

## Devir bağlamı

- `artifacts/frontend-design-pass/HANDOFF.md` — nerede kaldık, kalan iş, ortam
- `artifacts/frontend-design-pass/plan.md` — detaylı tasarım denetimi
- `artifacts/frontend-design-pass/screenshots/` — before / after / s2-after görseller
- (Not: `artifacts/` gitignore'da — yerel; `docs/` git'te.)
