const { getMyProfile, updateMyProfile } = require('../services/users.service');

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

module.exports = { getMe, patchMe };
