const { listDepartments } = require('../services/departments.service');

async function getDepartments(req, res) {
  try {
    const result = await listDepartments(req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Departmanlar getirilemedi, lütfen tekrar deneyin' });
  }
}

module.exports = { getDepartments };
