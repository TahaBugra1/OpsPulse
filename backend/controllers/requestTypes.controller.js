const {
  listRequestTypes,
  listAllRequestTypes,
  createRequestType,
  updateRequestType,
  deactivateRequestType,
  activateRequestType,
} = require('../services/requestTypes.service');

async function getRequestTypes(req, res) {
  try {
    const result = await listRequestTypes();
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Talep türleri getirilemedi, lütfen tekrar deneyin' });
  }
}

// ADMIN-only: every row including inactive ones, plus is_active — for the
// catalog management page. getRequestTypes above is UNCHANGED and stays the
// one every role (including EMPLOYEE, for NewRequest.tsx) calls.
async function getAllRequestTypes(req, res) {
  try {
    const result = await listAllRequestTypes(req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Talep türleri getirilemedi, lütfen tekrar deneyin' });
  }
}

async function postRequestType(req, res) {
  try {
    const result = await createRequestType(req.body, req.user);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Talep türü oluşturulamadı, lütfen tekrar deneyin' });
  }
}

async function patchRequestType(req, res) {
  try {
    const result = await updateRequestType(req.params.id, req.body, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Talep türü güncellenemedi, lütfen tekrar deneyin' });
  }
}

async function patchDeactivateRequestType(req, res) {
  try {
    const result = await deactivateRequestType(req.params.id, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Talep türü pasife alınamadı, lütfen tekrar deneyin' });
  }
}

async function patchActivateRequestType(req, res) {
  try {
    const result = await activateRequestType(req.params.id, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Talep türü aktifleştirilemedi, lütfen tekrar deneyin' });
  }
}

module.exports = {
  getRequestTypes,
  getAllRequestTypes,
  postRequestType,
  patchRequestType,
  patchDeactivateRequestType,
  patchActivateRequestType,
};
