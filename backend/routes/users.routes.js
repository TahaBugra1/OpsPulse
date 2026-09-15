const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const {
  getMe,
  patchMe,
  patchDepartment,
  patchMyPassword,
  getUsers,
  getMyTeam,
  postUser,
  postResetPassword,
  patchDeactivate,
} = require('../controllers/users.controller');

const router = Router();

// Per-user: authMiddleware runs before this router, so req.user is set.
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
});

router.get('/me', getMe);
router.patch('/me', patchMe);
router.patch('/me/department', patchDepartment);
router.patch('/me/password', passwordChangeLimiter, patchMyPassword);
router.get('/', getUsers);
router.get('/team', getMyTeam);
router.post('/', postUser);
router.patch('/:id/deactivate', patchDeactivate);
router.post('/:id/reset-password', postResetPassword);

module.exports = router;
