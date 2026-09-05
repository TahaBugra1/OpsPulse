const { listRequestTypes } = require('../services/requests.service');

async function getRequestTypes(req, res) {
  try {
    const result = await listRequestTypes();
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Talep türleri getirilemedi, lütfen tekrar deneyin' });
  }
}

module.exports = { getRequestTypes };
