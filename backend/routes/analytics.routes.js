const { Router } = require('express');
const { getSummaryHandler, getSlaHandler, getWorkloadHandler, getDistributionHandler, getBottlenecksHandler } = require('../controllers/analytics.controller');

const router = Router();
router.get('/summary', getSummaryHandler);
router.get('/sla', getSlaHandler);
router.get('/workload', getWorkloadHandler);
router.get('/distribution', getDistributionHandler);
router.get('/bottlenecks', getBottlenecksHandler);

module.exports = router;
