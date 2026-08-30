/*
 * User Panel Views Router
 * Friend Routes
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireAuth } = require('../middleware/auth');

// Protect all user routes
router.use(requireAuth);

router.get('/dashboard', userController.getDashboard);
router.get('/wallet', userController.getWallet);
router.get('/buy-credits', userController.getBuyCredits);
router.post('/buy-credits', userController.postBuyCredits);

router.get('/call', userController.getCall);
router.post('/end-call', userController.postEndCall);

router.get('/call-history', userController.getCallHistory);
router.get('/transactions', userController.getTransactions);

router.get('/profile', userController.getProfile);
router.post('/profile', userController.postProfile);
router.post('/change-password', userController.postChangePassword);

module.exports = router;
