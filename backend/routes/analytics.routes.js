const { Router } = require('express');
const { getSummaryHandler, getSlaHandler, getWorkloadHandler } = require('../controllers/analytics.controller');

const router = Router();
router.get('/summary', getSummaryHandler);
router.get('/sla', getSlaHandler);
router.get('/workload', getWorkloadHandler);

module.exports = router;
