const Call = require('../../models/Call');
const callService = require('../../services/callService');

const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// GET /api/calls/advisor-status
exports.getAdvisorStatus = (req, res) => {
  try {
    const info = callService.getAdvisorPresenceInfo();
    return res.json({
      success: true,
      data: info
    });
  } catch (error) {
    console.error('[API Advisor Status Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve advisor status.' });
  }
};

// POST /api/calls/initiate
exports.initiateCall = async (req, res) => {
  try {
    const user = req.user;

    if (user.credits < 1) {
      return res.status(402).json({
        success: false,
        code: 'INSUFFICIENT_CREDITS',
        message: 'Insufficient credits. You need at least 1 credit to initiate a call.',
        credits: user.credits
      });
    }

    const { callType } = req.body;
    const call = await callService.initiateCall({
      user,
      callType: callType || 'Voice'
    });

    return res.status(201).json({
      success: true,
      message: 'Call initiated successfully.',
      call: {
        id: call._id,
        callId: call.callId,
        roomId: call.callId,
        user: {
          id: user._id,
          name: user.name
        },
        receiverName: call.receiverName,
        callType: call.callType,
        status: call.status,
        startTime: call.startTime,
        initialCredits: user.credits
      }
    });
  } catch (error) {
    console.error('[API Call Initiate Error]', error);
    if (error.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        success: false,
        code: 'INSUFFICIENT_CREDITS',
        message: 'Insufficient credits to start a call.'
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error initiating call.'
    });
  }
};

// POST /api/calls/end
exports.endCall = async (req, res) => {
  try {
    const { callId, reason } = req.body;
    const user = req.user;

    if (!callId) {
      return res.status(400).json({ success: false, message: 'callId is required.' });
    }

    const existingCall = await Call.findOne({ callId });
    if (!existingCall) {
      return res.status(404).json({ success: false, message: 'Call record not found.' });
    }

    if (existingCall.user.toString() !== user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this call.' });
    }

    const result = await callService.finalizeCall(callId, { reason: reason || 'Completed' });

    return res.json({
      success: true,
      message: 'Call finalized successfully.',
      data: {
        callId: result.call.callId,
        status: result.call.status,
        duration: result.call.duration,
        durationSeconds: result.call.durationSeconds,
        creditsDeducted: result.creditsDeducted,
        creditStatus: result.call.creditStatus,
        remainingCredits: result.remainingCredits
      }
    });
  } catch (error) {
    console.error('[API End Call Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to finalize call.'
    });
  }
};

// GET /api/calls/history
exports.getCallHistory = async (req, res) => {
  try {
    const user = req.user;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const skip = (page - 1) * limit;

    const { status, q } = req.query;
    const conditions = [{ user: user._id }];

    if (status && status !== 'All' && status !== 'all') {
      conditions.push({ status: status });
    }

    if (q && q.trim() !== '') {
      const searchRegex = new RegExp(escapeRegex(q.trim()), 'i');
      conditions.push({
        $or: [
          { callId: searchRegex },
          { receiverName: searchRegex }
        ]
      });
    }

    const filter = conditions.length > 1 ? { $and: conditions } : conditions[0];

    const [calls, totalCount] = await Promise.all([
      Call.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit),
      Call.countDocuments(filter)
    ]);

    return res.json({
      success: true,
      data: {
        calls,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit) || 1
        }
      }
    });
  } catch (error) {
    console.error('[API Call History Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch call history.'
    });
  }
};

// GET /api/calls/:callId
exports.getCallDetails = async (req, res) => {
  try {
    const { callId } = req.params;
    const user = req.user;

    const call = await Call.findOne({ callId, user: user._id });
    if (!call) {
      return res.status(404).json({ success: false, message: 'Call not found.' });
    }

    return res.json({
      success: true,
      call
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving call.' });
  }
};
