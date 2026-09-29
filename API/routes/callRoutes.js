const express = require('express');
const router = express.Router();
const callApiController = require('../controllers/callApiController');
const { requireApiAuth } = require('../middleware/apiAuth');

// Public advisor status check
router.get('/advisor-status', callApiController.getAdvisorStatus);

// Protected routes
router.use(requireApiAuth);
router.post('/initiate', callApiController.initiateCall);
router.post('/end', callApiController.endCall);
router.get('/history', callApiController.getCallHistory);
router.get('/:callId', callApiController.getCallDetails);

module.exports = router;
