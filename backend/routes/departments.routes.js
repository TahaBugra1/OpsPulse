const { Router } = require('express');
const { getDepartments } = require('../controllers/departments.controller');

const router = Router();
router.get('/', getDepartments);
module.exports = router;
