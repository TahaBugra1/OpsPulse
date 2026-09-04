const { Router } = require('express');
const { getMe, patchMe } = require('../controllers/users.controller');

const router = Router();

router.get('/me', getMe);
router.patch('/me', patchMe);

module.exports = router;
