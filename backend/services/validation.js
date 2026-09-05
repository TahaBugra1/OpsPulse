const NAME_MAX_LENGTH = 150;

// Ad: zorunlu. Trim edilmiş değeri döner; eksik, boş/whitespace veya
// 150 karakterden uzunsa geçersiz.
function normalizeName(value) {
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > NAME_MAX_LENGTH) return { ok: false };
  return { ok: true, value: trimmed };
}

// Soyad: opsiyonel ve nullable. Yoksa/boşsa null döner; string değilse veya
// 150 karakterden uzunsa geçersiz (reason ayırt eder, çağıran doğru mesajı seçer).
function normalizeSurname(value) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, reason: 'invalid_type' };
  const trimmed = value.trim();
  if (trimmed.length > NAME_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

module.exports = { normalizeName, normalizeSurname, NAME_MAX_LENGTH };
