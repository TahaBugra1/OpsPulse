const { checkDatabaseConnection } = require('../services/health.service');

async function getHealth(req, res) {
  try {
    await checkDatabaseConnection();
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
}

module.exports = { getHealth };
