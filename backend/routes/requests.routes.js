const { Router } = require('express');
const {
  postCreateRequest,
  postClaimRequest,
  patchRequestStatus,
  patchRequestPriority,
} = require('../controllers/requests.controller');

const router = Router();

router.post('/', postCreateRequest);
router.post('/:id/assign', postClaimRequest);
router.patch('/:id/status', patchRequestStatus);
router.patch('/:id/priority', patchRequestPriority);

module.exports = router;
