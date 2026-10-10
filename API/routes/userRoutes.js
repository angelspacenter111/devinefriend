const express = require('express');
const router = express.Router();
const userApiController = require('../controllers/userApiController');
const { requireApiAuth } = require('../middleware/apiAuth');

router.use(requireApiAuth);

router.get('/dashboard', userApiController.getDashboard);
router.get('/profile', userApiController.getProfile);
router.put('/profile', userApiController.updateProfile);
router.post('/change-password', userApiController.changePassword);
router.post('/push-token', userApiController.updatePushToken);

module.exports = router;
