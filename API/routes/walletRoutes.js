const express = require('express');
const router = express.Router();
const walletApiController = require('../controllers/walletApiController');
const { requireApiAuth } = require('../middleware/apiAuth');

// Public plans list
router.get('/plans', walletApiController.getPlans);

// Protected routes
router.use(requireApiAuth);
router.get('/balance', walletApiController.getBalance);
router.get('/transactions', walletApiController.getTransactions);
router.post('/create-order', walletApiController.createOrder);
router.post('/verify-payment', walletApiController.verifyPayment);

module.exports = router;
