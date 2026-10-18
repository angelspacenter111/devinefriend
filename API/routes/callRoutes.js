const express = require('express');
const router = express.Router();
const callApiController = require('../controllers/callApiController');
const { requireApiAuth } = require('../middleware/apiAuth');

// Public advisor status check & ICE servers config
router.get('/advisor-status', callApiController.getAdvisorStatus);
router.get('/ice-servers', callApiController.getIceServers);

// Protected routes
router.use(requireApiAuth);
router.post('/initiate', callApiController.initiateCall);
router.post('/end', callApiController.endCall);
router.post('/log-issue', callApiController.logCallIssue);
router.get('/history', callApiController.getCallHistory);
router.get('/:callId', callApiController.getCallDetails);

module.exports = router;
