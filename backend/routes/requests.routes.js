const { Router } = require('express');
const {
  postCreateRequest,
  postClaimRequest,
  patchRequestStatus,
  patchRequestPriority,
  getRequests,
  getRequestByIdHandler,
  postAddComment,
  getComments,
  getHistory,
} = require('../controllers/requests.controller');

const router = Router();

router.get('/', getRequests);
router.get('/:id', getRequestByIdHandler);
router.post('/', postCreateRequest);
router.post('/:id/assign', postClaimRequest);
router.patch('/:id/status', patchRequestStatus);
router.patch('/:id/priority', patchRequestPriority);
router.post('/:id/comments', postAddComment);
router.get('/:id/comments', getComments);
router.get('/:id/history', getHistory);

module.exports = router;
