const { register, login } = require('../services/auth.service');

async function postRegister(req, res) {
  try {
    const { name, surname, email, password } = req.body;
    const result = await register({ name, surname, email, password });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Kayıt oluşturulamadı, lütfen tekrar deneyin' });
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

module.exports = { postRegister, postLogin };
