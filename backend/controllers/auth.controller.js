const { register, login, loginWithGoogle } = require('../services/auth.service');
const { listActiveDepartments } = require('../services/departments.service');

async function postRegister(req, res) {
  try {
    const { name, surname, email, password, department_id } = req.body;
    const result = await register({ name, surname, email, password, department_id });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Kayıt oluşturulamadı, lütfen tekrar deneyin' });
  }
}

async function getPublicDepartments(req, res) {
  try {
    const result = await listActiveDepartments();
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Departmanlar getirilemedi, lütfen tekrar deneyin' });
  }
}

async function postLogin(req, res) {
  try {
    const { email, password, rememberMe } = req.body;
    const result = await login({ email, password, rememberMe });
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Giriş yapılamadı' });
  }
}

async function postGoogleLogin(req, res) {
  try {
    const { id_token, rememberMe } = req.body;
    const result = await loginWithGoogle({ id_token, rememberMe });
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Giriş yapılamadı' });
  }
}

module.exports = { postRegister, postLogin, postGoogleLogin, getPublicDepartments };
