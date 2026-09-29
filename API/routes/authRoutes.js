const express = require('express');
const router = express.Router();
const authApiController = require('../controllers/authApiController');
const { requireApiAuth } = require('../middleware/apiAuth');

router.post('/register', authApiController.register);
router.post('/login', authApiController.login);
router.get('/me', requireApiAuth, authApiController.getMe);
router.post('/forgot-password', authApiController.forgotPassword);

module.exports = router;
