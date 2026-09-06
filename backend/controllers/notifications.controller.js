const {
  getUnreadCount,
  listNotifications,
  markAsRead,
  markAllAsRead,
} = require('../services/notifications.service');

async function getUnreadCountHandler(req, res) {
  try {
    const result = await getUnreadCount(req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Bildirim sayısı getirilemedi, lütfen tekrar deneyin' });
  }
}

async function getNotifications(req, res) {
  try {
    const result = await listNotifications(req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Bildirimler getirilemedi, lütfen tekrar deneyin' });
  }
}

async function patchMarkAsRead(req, res) {
  try {
    const result = await markAsRead(req.params.id, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Bildirim güncellenemedi, lütfen tekrar deneyin' });
  }
}

async function patchMarkAllAsRead(req, res) {
  try {
    await markAllAsRead(req.user);
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Bildirimler güncellenemedi, lütfen tekrar deneyin' });
  }
}

module.exports = { getUnreadCountHandler, getNotifications, patchMarkAsRead, patchMarkAllAsRead };
