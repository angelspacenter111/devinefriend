/*
 * Admin Panel Views Router
 * Friend Routes
 */

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/auth');

// Public admin login pages
router.get('/login', adminController.getLogin);
router.post('/login', adminController.postLogin);
router.get('/logout', adminController.logout);

// Protected admin console routes
router.use(requireAdmin);

router.get('/dashboard', adminController.getDashboard);
router.get('/users', adminController.getUsers);
router.get('/calls', adminController.getCalls);
router.get('/transactions', adminController.getTransactions);
router.get('/credits', adminController.getCredits);
router.get('/pricing', adminController.getPricing);
router.get('/recharge-packs', adminController.getPricing);
router.get('/reports', adminController.getReports);
router.get('/settings', adminController.getSettings);
router.get('/call', adminController.getCall);

// Admin actions endpoints
router.get('/calls/:callId/details', adminController.getCallDetails);
router.post('/end-call', adminController.postEndCall);
router.post('/users/block/:id', adminController.postToggleBlock);
router.post('/users/update-wallet/:id', adminController.postUpdateCredits);

// Pricing configuration endpoints
router.post('/pricing/update/:id', adminController.postUpdatePricing);
router.post('/pricing/toggle/:id', adminController.postTogglePricing);
router.post('/pricing/add', adminController.postAddPricing);
router.post('/pricing/delete/:id', adminController.postDeletePricing);

module.exports = router;

