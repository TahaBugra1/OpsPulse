const { Router } = require('express');
const { getRequestTypes } = require('../controllers/requestTypes.controller');

const router = Router();

router.get('/', getRequestTypes);

module.exports = router;
