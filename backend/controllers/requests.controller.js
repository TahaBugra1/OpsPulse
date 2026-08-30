const {
  createRequest,
  claimRequest,
  changeRequestStatus,
  changePriority,
} = require('../services/requests.service');

async function postCreateRequest(req, res) {
  try {
    const { title, description, request_type_id, priority } = req.body;
    const result = await createRequest({ title, description, request_type_id, priority }, req.user);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Talep oluşturulamadı, lütfen tekrar deneyin' });
  }
}

async function postClaimRequest(req, res) {
  try {
    const result = await claimRequest(req.params.id, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Talep üstlenilemedi, lütfen tekrar deneyin' });
  }
}

async function patchRequestStatus(req, res) {
  try {
    const { status, note } = req.body;
    const result = await changeRequestStatus(req.params.id, { status, note }, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Durum güncellenemedi, lütfen tekrar deneyin' });
  }
}

async function patchRequestPriority(req, res) {
  try {
    const { priority } = req.body;
    const result = await changePriority(req.params.id, { priority }, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Öncelik güncellenemedi, lütfen tekrar deneyin' });
  }
}

module.exports = { postCreateRequest, postClaimRequest, patchRequestStatus, patchRequestPriority };
