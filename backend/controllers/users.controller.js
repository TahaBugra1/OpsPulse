const { getMyProfile, updateMyProfile, completeDepartment, listUsers, listMyTeam, createDepartmentAuthority, deactivateUser } = require('../services/users.service');

async function getMe(req, res) {
  try {
    const result = await getMyProfile(req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Profil getirilemedi, lütfen tekrar deneyin' });
  }
}

async function patchMe(req, res) {
  try {
    const result = await updateMyProfile(req.body, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Profil güncellenemedi, lütfen tekrar deneyin' });
  }
}

async function patchDepartment(req, res) {
  try {
    const result = await completeDepartment(req.body, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Departman kaydedilemedi, lütfen tekrar deneyin' });
  }
}

async function getUsers(req, res) {
  try {
    const result = await listUsers(req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Kullanıcılar getirilemedi, lütfen tekrar deneyin' });
  }
}

async function getMyTeam(req, res) {
  try {
    const result = await listMyTeam(req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Ekip listesi getirilemedi, lütfen tekrar deneyin' });
  }
}

async function postUser(req, res) {
  try {
    const result = await createDepartmentAuthority(req.body, req.user);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Kullanıcı oluşturulamadı, lütfen tekrar deneyin' });
  }
}

async function patchDeactivate(req, res) {
  try {
    const result = await deactivateUser(req.params.id, req.user);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Kullanıcı pasife alınamadı, lütfen tekrar deneyin' });
  }
}

module.exports = { getMe, patchMe, patchDepartment, getUsers, getMyTeam, postUser, patchDeactivate };
