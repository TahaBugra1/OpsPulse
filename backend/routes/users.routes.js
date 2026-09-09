const { Router } = require('express');
const { getMe, patchMe, getUsers, postUser, patchDeactivate } = require('../controllers/users.controller');

const router = Router();

router.get('/me', getMe);
router.patch('/me', patchMe);
router.get('/', getUsers);
router.post('/', postUser);
router.patch('/:id/deactivate', patchDeactivate);

module.exports = router;
