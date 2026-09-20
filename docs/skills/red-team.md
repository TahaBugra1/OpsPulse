---
name: red-team
description: ATDD pipeline'ının commit'ten önceki son bağımsız inceleme adımı. atdd.md + code_diff.md + test_report.md'yi okur; security/correctness/architecture/maintainability/performance/reliability/readability + CAVEMAN karmaşıklık incelemesi + scope review + risk review yapar. Sadece Claude tarafından çalıştırılır, hiçbir dış modele bağımlı değildir. Gerçek kodu asla değiştirmez — sadece red_team.json bulgu raporu üretir ve commit'e hazır olup olmadığına dair bir "Ready To Commit" değerlendirmesiyle biter.
---

# Red-Team Skill

Red-team, commit'ten önceki son bağımsız incelemedir.

- Gerçek kod ASLA yazmaz.
- Gerçek kod ASLA düzenlemez.
- Sadece inceler ve bulgu raporlar.

## Kritik kural: sadece Claude çalıştırır
Bu adım **her koşulda Claude tarafından** yürütülür, hiçbir dış modele bağımlı değildir.

Aşağıdaki adımları doğrudan uygula. İstersen ayrı bir alt ajan (Agent tool, `subagent_type: general-purpose`) üzerinden de çalıştırabilirsin — gerçek kodu değiştirmez, sadece bulgu raporu döner.

## Ön Koşul
Aynı `<task-slug>` altında üçü de mevcut olmalı:
- `atdd.md`
- `code_diff.md`
- `test_report.md` (veya `verify_report.md` — hangisi varsa)

Biri eksikse dur, kullanıcıya hangi skill'in önce çalıştırılması gerektiğini söyle.

## İnceleme Alanları
1. **Security** — açık/gizli güvenlik zafiyeti, secrets sızıntısı, yetkilendirme boşluğu.
2. **Correctness** — kod ve testler atdd.md'deki Acceptance Criteria'yı gerçekten karşılıyor mu.
3. **Architecture** — proje deseniyle tutarlılık, katman ayrımı.
4. **Maintainability** — okunabilirlik, isimlendirme, tekrar.
5. **Performance** — atdd.md'nin benchmark hedefleriyle uyum.
6. **Reliability** — hata yönetimi, rollback davranışı, race condition.
7. **Readability** — kod kendini açıklıyor mu.
8. **CAVEMAN Review** — gereksiz karmaşıklık:
   - gereksiz soyutlamalar
   - gereksiz yardımcı fonksiyonlar
   - ölü kod
   - spekülatif mimari
   - kullanılmayan public API'ler
   - gereksiz dosyalar
   - gereksiz konfigürasyon
   - tekrar eden karmaşıklık

   Daha basit bir implementasyon mümkünse, bunu bulgu olarak raporla.

## Scope Review
Her uygulanan özelliğin atdd.md'de var olduğunu doğrula. atdd.md'nin dışında kalan her şeyi (kapsam genişlemesi) bulgu olarak raporla.

## Risk Review
Şunlara bak:
- breaking change'ler
- gizli varsayımlar
- eksik validasyon
- race condition
- hata yönetimi boşlukları
- güvenlik riskleri
- bakım riskleri

## Adımlar (Claude tarafında)
1. `atdd.md`, `code_diff.md`, `test_report.md`/`verify_report.md` dosyalarını (aynı `<task-slug>` altında) oku.
2. Yukarıdaki 8 inceleme alanı + Scope Review + Risk Review'u uygula. Gerçek kodu değiştirme — sadece bulgu üret.
3. Birleşik bulguları aşağıdaki JSON şemasıyla `artifacts/<task-slug>/red_team.json` dosyasına yaz:

```json
{
  "task": "<task-slug>",
  "reviewed_at": "<ISO tarih>",
  "summary": "<1-3 cümlelik genel değerlendirme>",
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "security|correctness|architecture|maintainability|performance|reliability|readability|caveman|scope|risk",
      "file": "path/to/file",
      "issue": "sorunun kısa tanımı",
      "better_approach": "önerilen daha iyi çözüm (varsa)",
      "reason": "neden daha iyi — somut gerekçe, dosya/atdd referansıyla"
    }
  ],
  "strengths": ["<implementasyonun iyi yaptığı şeyler, varsa>"],
  "risks": ["<Risk Review'dan çıkan maddeler, varsa>"],
  "caveman_review": {
    "complexity": "low|medium|high",
    "unnecessary_files": 0,
    "unnecessary_helpers": 0,
    "unnecessary_abstractions": 0
  },
  "scope_review": {
    "matches_atdd": true,
    "scope_expansion": false
  },
  "ready_to_commit": {
    "atdd_satisfied": true,
    "tests_passed": true,
    "no_critical_findings": true,
    "scope_respected": true,
    "caveman_satisfied": true,
    "security_acceptable": true,
    "maintainability_acceptable": true,
    "no_blocking_risks": true
  },
  "verdict": "approve|approve-with-changes|block"
}
```

4. `findings`/`strengths`/`risks` boşsa boş dizi yaz, uydurma bulgu ekleme. Her bulgu somut kanıt, dosya referansı ve atdd.md referansıyla desteklenmeli.
5. Kullanıcıya `red_team.json` yolunu, `verdict`'i ve `ready_to_commit` özetini bildir. Sonraki adımın (varsa `commit` skill'i) kullanıcı isteğiyle tetiklendiğini hatırlat — otomatik geçme.

## Verdict Kuralları
- **approve** — önemli bulgu yok.
- **approve-with-changes** — küçük/orta önem seviyesinde sorunlar var, commit engellenmez ama kullanıcıya bildirilir.
- **block** — kritik correctness, security veya ATDD ihlali var. Kullanıcıyı commit'ten önce açıkça uyar.

## Ready To Commit
Red-team sadece hata bulmakla kalmaz, commit'e hazır olup olmadığını da değerlendirir (`ready_to_commit` alanı). Bu sayede `commit` skill'i kaliteyi yeniden değerlendirmek zorunda kalmaz — sadece bu sonucu okur, kullanıcı onayını alır ve Git işlemlerini yapar.

Sorumluluk ayrımı:
- **verify** → teknik doğrulama (build, test, lint, coverage vb.)
- **red-team** → bağımsız kalite ve mimari inceleme + commit'e hazır olma değerlendirmesi
- **commit** → güvenli commit ve push

## Kural
- Bu skill kod düzenlemez, yazmaz, yeniden yazmaz, düzeltmez (Edit/Write yasak, sadece Read/Grep + JSON çıktısı).
- Bulgu uydurma — her bulgu kanıt, dosya referansı ve gerekçe içermeli.
- "block" verdict'i varsa, kullanıcıyı commit'ten önce uyar.
