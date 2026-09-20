const { Router } = require('express');
const {
  getRequestTypes,
  getAllRequestTypes,
  postRequestType,
  patchRequestType,
  patchDeactivateRequestType,
  patchActivateRequestType,
} = require('../controllers/requestTypes.controller');

const router = Router();

router.get('/', getRequestTypes);
router.get('/all', getAllRequestTypes);
router.post('/', postRequestType);
router.patch('/:id', patchRequestType);
router.patch('/:id/deactivate', patchDeactivateRequestType);
router.patch('/:id/activate', patchActivateRequestType);

module.exports = router;
