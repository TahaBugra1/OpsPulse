const pool = require('./db');

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

async function getUnreadCount(user) {
  let result;
  try {
    result = await pool.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [user.id]
    );
  } catch (dbErr) {
    fail(500, 'Bildirim sayısı getirilemedi, lütfen tekrar deneyin');
  }
  return result.rows[0];
}

async function listNotifications(user) {
  let result;
  try {
    result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [user.id]
    );
  } catch (dbErr) {
    fail(500, 'Bildirimler getirilemedi, lütfen tekrar deneyin');
  }
  return result.rows;
}

async function markAsRead(notificationId, user) {
  let result;
  try {
    result = await pool.query(
      'UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL RETURNING *',
      [notificationId, user.id]
    );
  } catch (dbErr) {
    fail(500, 'Bildirim güncellenemedi, lütfen tekrar deneyin');
  }

  if (result.rowCount === 0) {
    fail(404, 'Bildirim bulunamadı');
  }

  return result.rows[0];
}

async function markAllAsRead(user) {
  try {
    await pool.query(
      'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
      [user.id]
    );
  } catch (dbErr) {
    fail(500, 'Bildirimler güncellenemedi, lütfen tekrar deneyin');
  }
}

module.exports = { getUnreadCount, listNotifications, markAsRead, markAllAsRead };
