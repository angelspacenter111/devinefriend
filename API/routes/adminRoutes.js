const express = require('express');
const router = express.Router();
const adminApiController = require('../controllers/adminApiController');
const { requireApiAdmin } = require('../middleware/apiAuth');

// Public Admin Login
router.post('/login', adminApiController.login);

// Protected Admin Endpoints
router.use(requireApiAdmin);

router.get('/dashboard', adminApiController.getDashboard);
router.get('/users', adminApiController.getUsers);
router.post('/users/:id/block', adminApiController.toggleUserBlock);
router.post('/users/:id/credits', adminApiController.updateUserCredits);

router.get('/calls', adminApiController.getCalls);
router.get('/transactions', adminApiController.getTransactions);

router.get('/pricing', adminApiController.getPricing);
router.post('/pricing/add', adminApiController.addPricing);
router.post('/pricing/:id/toggle', adminApiController.togglePricing);

module.exports = router;
