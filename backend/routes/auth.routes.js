const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { postRegister, postLogin, postGoogleLogin } = require('../controllers/auth.controller');

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body.email || 'unknown',
});

router.post('/register', postRegister);
router.post('/login', loginLimiter, postLogin);
router.post('/google', postGoogleLogin);

module.exports = router;
