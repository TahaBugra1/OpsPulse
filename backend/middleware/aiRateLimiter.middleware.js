const rateLimit = require('express-rate-limit');

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: { status: 'error', message: 'Çok fazla öneri isteği gönderildi, lütfen biraz sonra tekrar deneyin' },
});

module.exports = aiRateLimiter;
