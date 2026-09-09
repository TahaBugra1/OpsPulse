const { Router } = require('express');
const {
  getUnreadCountHandler,
  getNotifications,
  patchMarkAsRead,
  patchMarkAllAsRead,
} = require('../controllers/notifications.controller');

const router = Router();

router.get('/unread-count', getUnreadCountHandler);
router.get('/', getNotifications);
router.patch('/read-all', patchMarkAllAsRead);
router.patch('/:id/read', patchMarkAsRead);

module.exports = router;
