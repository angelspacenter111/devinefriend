const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { requireAuth } = require('../middleware/auth');

// Public Webhook endpoint (verified via cryptographic HMAC signature)
router.post('/webhook', paymentController.handleWebhook);

// Protected endpoints for authenticated users
router.post('/create-order', requireAuth, paymentController.createOrder);
router.post('/verify', requireAuth, paymentController.verifyPayment);
router.get('/history', requireAuth, paymentController.getPaymentHistory);
router.get('/balance', requireAuth, paymentController.getCreditBalance);
router.get('/transactions', requireAuth, paymentController.getCreditTransactions);
router.get('/check-access', requireAuth, paymentController.checkCallAccess);

module.exports = router;
