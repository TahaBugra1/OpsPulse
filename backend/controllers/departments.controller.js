const {
  listDepartments,
  createDepartment,
  updateDepartment,
  deactivateDepartment,
  activateDepartment,
} = require('../services/departments.service');

async function getDepartments(req, res) {
  try {
    const result = await listDepartments(req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Departmanlar getirilemedi, lütfen tekrar deneyin' });
  }
}

async function postDepartment(req, res) {
  try {
    const result = await createDepartment(req.body, req.user);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Departman oluşturulamadı, lütfen tekrar deneyin' });
  }
}

async function patchDepartmentHandler(req, res) {
  try {
    const result = await updateDepartment(req.params.id, req.body, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Departman güncellenemedi, lütfen tekrar deneyin' });
  }
}

async function patchDeactivateDepartment(req, res) {
  try {
    const result = await deactivateDepartment(req.params.id, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Departman pasife alınamadı, lütfen tekrar deneyin' });
  }
}

async function patchActivateDepartment(req, res) {
  try {
    const result = await activateDepartment(req.params.id, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Departman aktifleştirilemedi, lütfen tekrar deneyin' });
  }
}

module.exports = {
  getDepartments,
  postDepartment,
  patchDepartmentHandler,
  patchDeactivateDepartment,
  patchActivateDepartment,
};
