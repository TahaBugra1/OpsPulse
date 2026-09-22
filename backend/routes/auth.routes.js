const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { postRegister, postLogin, postGoogleLogin, getPublicDepartments } = require('../controllers/auth.controller');

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body.email || 'unknown',
});

// No custom keyGenerator: registration has no reliable pre-existing identity
// to key by like login's email (an attacker can submit a different fake email
// on every attempt), so the default IP-based keyGenerator is the correct axis.
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

// Public on purpose: the register form needs the department list before any
// account or token exists, and /api/auth is the one prefix not behind authMiddleware.
router.get('/departments', getPublicDepartments);
router.post('/register', registerLimiter, postRegister);
router.post('/login', loginLimiter, postLogin);
router.post('/google', postGoogleLogin);

module.exports = router;
