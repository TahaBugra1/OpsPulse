---
name: atdd
description: Tool-independent ATDD skill — asks 8-12 adaptive clarification questions (skips categories the user already answered), writes atdd.md with YAML frontmatter (task_slug, priority, coverage_target, performance_target, test_strategy, affected_modules) + Markdown body (Persona, Goal, User Story, prioritized Acceptance Criteria, Risks/Assumptions/Unknowns, Test Strategy, Benchmark). Does NOT talk to Jira/Saga (see jira-sync) and does NOT chain into other pipeline steps (see pipeline).
---

# ATDD Skill

Bu skill, sonraki pipeline adımlarının (`plan`/`code-copilot`/`test-copilot`/
`verify`/`red-team`) referans aldığı **tek gerçek kaynağı** (`atdd.md`)
üretir. Tek işi budur — Jira/Saga senkronizasyonu **`jira-sync`** skill'inde,
adımlar arası geçiş **`pipeline`** skill'inde. Bu üçünü karıştırma: burada
Saga çağrısı yapma, burada bir sonraki skill'e otomatik geçme.

## Adımlar

1. **Görev slug'ı belirle.** Kullanıcının isteğinden kısa bir `kebab-case`
   slug türet (örn. `pdf-export-butonu`). Kullanıcıya onaylat.
2. **Jira bağlamı gerekiyorsa `jira-sync` skill'ini çağır, kendin sorgulama.**
   Kullanıcı bir Jira ID verdiyse (örn. "KAN-14'ten devam") önce `jira-sync`
   ile issue'yu çek + Saga task'ı oluştur/güncelle, dönen bilgiyi (özet, AC,
   öncelik, `saga_task_id`) burada kullan. Jira'ya ikinci kez sorgu atma.
3. **Kullanıcının mesajında zaten netleşmiş kategorileri tespit et.** Aşağıdaki
   9 kategoriyi gözden geçir; kullanıcı bir kategoriyi zaten somut ve
   belirsizlik bırakmayacak şekilde yanıtlamışsa (mesajında veya jira-sync'in
   getirdiği AC'lerde) o kategori için **yeniden sorma** — mevcut bilgiyi
   "Sorular ve Cevaplar" bölümüne `(kullanıcı mesajından)` notuyla yaz.
4. **Adaptif olarak 8-12 soru sor** (minimum 8, maksimum 12 — kaç kategori
   zaten netse o kadar az sor, hiçbiri netse üst sınıra çık). Kategoriler:
   - Kullanıcı rolü / persona ("kim kullanacak?")
   - Ana hedef / "neden" (bu özellik hangi sorunu çözüyor?)
   - Happy path senaryosu (adım adım, somut girdi/çıktı)
   - En az 2 edge case / hata senaryosu
   - Başarı ölçütü / benchmark (ölçülebilir: süre, doğruluk, coverage,
     performans, hata oranı vb. — sayısal hedef iste, "iyi olsun" yetmez)
   - Kapsam dışı (explicitly out of scope — ne YAPILMAYACAK)
   - Bağımlılıklar / etkilenen mevcut dosyalar-modüller
   - Performans/güvenlik kısıtı varsa
   - Geri dönüş/rollback beklentisi (hata olursa ne olmalı)
   - Kabul kriteri sahibi kimin onayı yeterli (kullanıcı mı, otomatik test mi)
   - Test stratejisi oranı (unit/integration/e2e yüzdeleri) — kullanıcı
     bilmiyorsa proje tipine göre makul bir varsayılan öner (örn. backend
     API: 70/20/10) ve onaylat, "belirtilmedi" bırakma
   - Bilinen riskler/varsayımlar/bilinmeyenler (varsa)
   - Claude'da: `AskUserQuestion` tool'unu kullan (tek çağrıda max 4 soru
     olduğundan gerekirse 2-3 ayrı çağrıda toplam 8-12'ye tamamla).
   - Copilot'ta: `AskUserQuestion` yok — soruları numaralı liste halinde tek
     mesajda sor, kullanıcının cevabını bekle, cevap gelmeden taslağa geçme.
5. **ATDD taslağını doldur** (şablon aşağıda), cevapları birebir kullanarak —
   soru sorup cevabı görmezden gelme, önceden netleşmiş kategorileri de dahil et.
6. **Kaydet.** `artifacts/<task-slug>/atdd.md` yoluna yaz (klasör
   yoksa oluştur). Var olan bir dosyayı sessizce ezme — üzerine yazmadan önce
   kullanıcıya söyle.
7. Kaydettikten sonra kullanıcıya dosya yolunu ver. Kendi kendine
   `plan`/`code-copilot` adımlarına geçme — pipeline'ın sonraki adımı ayrı bir
   kullanıcı isteği veya `pipeline` skill'i ile başlar.

## ATDD Şablonu (atdd.md içeriği — YAML frontmatter + Markdown)

```markdown
---
task_slug: <task-slug>
jira_id: <JIRA-ID veya null>
saga_task_id: <id veya null>
priority: critical | high | medium | low
coverage_target: <yüzde, örn. 85>
performance_target: <örn. "<200ms" veya null>
memory_target: <örn. "<100MB" veya null>
test_strategy:
  unit: <yüzde>
  integration: <yüzde>
  e2e: <yüzde>
affected_modules:
  - <modül/dosya yolu>
---

# ATDD — <task-slug>

## Jira Kaynağı
(jira-sync'ten geldiyse) [<JIRA-ID> — <tam başlık>](https://.../browse/<JIRA-ID>)
User Story (Jira'dan birebir): "..."
AC (Jira'dan birebir): Given ..., When ..., Then ...
(jira-sync çağrılmadıysa: "Jira'ya bağlı değil — yerel görev")

## Persona
<kim, hangi bağlamda kullanıyor>

## Hedef (Neden)
<bu iş neden yapılıyor>

## User Story
As a <persona>
I want <capability>
So that <benefit>

## Acceptance Criteria (Given-When-Then, önceliklendirilmiş)
1. [Critical] Given <bağlam>, When <eylem>, Then <beklenen sonuç>
2. [High] ...
3. [Medium] ...
(en az happy path [Critical] + 2 edge case olacak şekilde; test-copilot
Critical olanları önce yazabilsin diye öncelik etiketi zorunlu)

## Test Strategy
Unit: <yüzde>% — <hangi katman/fonksiyonlar>
Integration: <yüzde>% — <hangi akışlar>
E2E: <yüzde>% — <varsa hangi senaryolar>

## Benchmark / Başarı Ölçütü
Coverage Target: <yüzde>%
Performance Target: <varsa>
Memory: <varsa>
Diğer ölçülebilir kriterler: <...>

## Kapsam Dışı
<açıkça yapılmayacaklar>

## Etkilenen Dosyalar/Modüller (bilinen)
<varsa>

## Rollback Beklentisi
<hata durumunda davranış>

## Risks
- <bilinen risk, varsa>

## Assumptions
- <varsayım — kullanıcı onaylamadıysa açıkça "varsayım" olarak işaretli>

## Unknowns
- <henüz netleşmemiş, ileride tekrar sorulması gereken>

## Sorular ve Cevaplar (ham kayıt)
1. Soru → Cevap (veya "kullanıcı mesajından, tekrar sorulmadı")
2. ...
```

## Kural
- 8 sorudan az soru sorup taslağı doldurma; hiçbir kategori netleşmemişse
  12'ye kadar çık. Adaptif olmak "atla" demek değil — sadece zaten cevaplanmış
  kategoriyi tekrar sorma, geri kalanları sor.
- Taslağı doldururken kullanıcı cevaplarında olmayan varsayım ekleme;
  belirsizse **Assumptions** veya **Unknowns** bölümüne yaz, "belirtilmedi"
  diye gizleme.
- Jira bağlamı `jira-sync`'ten geldiyse sonuçları (ID, URL, açıklama, AC)
  **birebir** atdd.md'ye göm — sonraki skill'ler bir daha Jira'ya sorgu
  atmamalı, hepsi atdd.md'den okumalı.
- Acceptance Criteria'da öncelik etiketi ([Critical]/[High]/[Medium]) zorunlu.
- `test_strategy` yüzdeleri toplamı 100 olmalı; kullanıcı vermediyse proje
  tipine göre makul bir varsayılan öner ve **onaylat**, sessizce icat etme.
