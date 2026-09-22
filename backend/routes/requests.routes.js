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
  patchComment,
  deleteCommentHandler,
  getHistory,
  postSuggestClassification,
} = require('../controllers/requests.controller');
const aiRateLimiter = require('../middleware/aiRateLimiter.middleware');

const router = Router();

router.get('/', getRequests);
router.post('/suggest-classification', aiRateLimiter, postSuggestClassification);
router.get('/:id', getRequestByIdHandler);
router.post('/', postCreateRequest);
router.post('/:id/assign', postClaimRequest);
router.patch('/:id/status', patchRequestStatus);
router.patch('/:id/priority', patchRequestPriority);
router.post('/:id/comments', postAddComment);
router.get('/:id/comments', getComments);
router.patch('/:id/comments/:commentId', patchComment);
router.delete('/:id/comments/:commentId', deleteCommentHandler);
router.get('/:id/history', getHistory);

module.exports = router;
