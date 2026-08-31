const { getSummary, getSla, getWorkload } = require('../services/analytics.service');

async function getSummaryHandler(req, res) {
  try {
    const result = await getSummary(req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Özet getirilemedi, lütfen tekrar deneyin' });
  }
}

async function getSlaHandler(req, res) {
  try {
    const result = await getSla(req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'SLA verileri getirilemedi, lütfen tekrar deneyin' });
  }
}

async function getWorkloadHandler(req, res) {
  try {
    const result = await getWorkload(req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'İş yükü verileri getirilemedi, lütfen tekrar deneyin' });
  }
}

module.exports = {
  getSummaryHandler,
  getSlaHandler,
  getWorkloadHandler,
};
