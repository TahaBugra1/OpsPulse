const { getSummary, getSla, getEmployeeSummary, getEmployeeSla, getWorkload, getDistribution, getBottlenecks } = require('../services/analytics.service');

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

async function getMySummaryHandler(req, res) {
  if (req.user.role !== 'EMPLOYEE') {
    return res.status(403).json({ status: 'error', message: 'Bu işlem için yetkiniz yok' });
  }
  try {
    const result = await getEmployeeSummary(req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Özet getirilemedi, lütfen tekrar deneyin' });
  }
}

async function getMySlaHandler(req, res) {
  if (req.user.role !== 'EMPLOYEE') {
    return res.status(403).json({ status: 'error', message: 'Bu işlem için yetkiniz yok' });
  }
  try {
    const result = await getEmployeeSla(req.user);
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

async function getDistributionHandler(req, res) {
  try {
    const result = await getDistribution(req.query, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Dağılım verileri getirilemedi, lütfen tekrar deneyin' });
  }
}

async function getBottlenecksHandler(req, res) {
  try {
    const result = await getBottlenecks(req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Darboğaz verileri getirilemedi, lütfen tekrar deneyin' });
  }
}

module.exports = {
  getSummaryHandler,
  getSlaHandler,
  getMySummaryHandler,
  getMySlaHandler,
  getWorkloadHandler,
  getDistributionHandler,
  getBottlenecksHandler,
};
