const {
  createRequest,
  claimRequest,
  changeRequestStatus,
  changePriority,
  listRequests,
  getRequestById,
  addComment,
  listComments,
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

async function getRequests(req, res) {
  try {
    const result = await listRequests({ status: req.query.status }, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Talepler getirilemedi, lütfen tekrar deneyin' });
  }
}

async function getRequestByIdHandler(req, res) {
  try {
    const result = await getRequestById(req.params.id, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Talep getirilemedi, lütfen tekrar deneyin' });
  }
}

async function postAddComment(req, res) {
  try {
    const result = await addComment(req.params.id, req.body.content, req.user);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Yorum eklenemedi, lütfen tekrar deneyin' });
  }
}

async function getComments(req, res) {
  try {
    const result = await listComments(req.params.id, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Yorumlar getirilemedi, lütfen tekrar deneyin' });
  }
}

module.exports = {
  postCreateRequest,
  postClaimRequest,
  patchRequestStatus,
  patchRequestPriority,
  getRequests,
  getRequestByIdHandler,
  postAddComment,
  getComments,
};
