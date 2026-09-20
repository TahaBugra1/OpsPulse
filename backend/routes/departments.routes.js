const { Router } = require('express');
const {
  getDepartments,
  postDepartment,
  patchDepartmentHandler,
  patchDeactivateDepartment,
  patchActivateDepartment,
} = require('../controllers/departments.controller');

const router = Router();
router.get('/', getDepartments);
router.post('/', postDepartment);
router.patch('/:id', patchDepartmentHandler);
router.patch('/:id/deactivate', patchDeactivateDepartment);
router.patch('/:id/activate', patchActivateDepartment);
module.exports = router;
