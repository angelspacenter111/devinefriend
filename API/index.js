const express = require('express');
const router = express.Router();

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const callRoutes = require('./routes/callRoutes');
const walletRoutes = require('./routes/walletRoutes');
const adminRoutes = require('./routes/adminRoutes');
const callService = require('../services/callService');

// Quick health check
router.get('/health', (req, res) => {
  res.json({
    status: 'online',
    app: 'Friend Emotional Support API',
    version: '1.0.0',
    timestamp: new Date()
  });
});

// Real-time Advisor Online Status API
router.get('/advisor-status', (req, res) => {
  res.json({
    success: true,
    ...callService.getAdvisorPresenceInfo()
  });
});

// Mount Submodules
router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/calls', callRoutes);
router.use('/wallet', walletRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
