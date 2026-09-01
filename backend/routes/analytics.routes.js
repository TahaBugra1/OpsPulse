const { Router } = require('express');
const { getSummaryHandler, getSlaHandler, getWorkloadHandler, getDistributionHandler } = require('../controllers/analytics.controller');

const router = Router();
router.get('/summary', getSummaryHandler);
router.get('/sla', getSlaHandler);
router.get('/workload', getWorkloadHandler);
router.get('/distribution', getDistributionHandler);

module.exports = router;
