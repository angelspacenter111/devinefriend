const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  const Call = require('../models/Call');
  const CallLog = require('../models/CallLog');

  const calls = await Call.find({
    status: { $ne: 'Completed' },
    $or: [
      { failureReason: { $exists: false } },
      { failureReason: '' },
      { failureReason: null }
    ]
  });

  console.log('Found calls without failureReason:', calls.length);

  for (const c of calls) {
    let reason = '';
    let stage = '';
    let code = '';

    if (c.status === 'Cancelled') {
      if (!c.acceptedTime) {
        reason = 'Caller cancelled the call before advisor answered (phone was ringing)';
        stage = 'ringing';
        code = 'CALLER_CANCELLED_WHILE_RINGING';
      } else {
        reason = 'Media connection could not be established during WebRTC handshake (Dubai/strict firewall or network timeout)';
        stage = 'handshake';
        code = 'WEBRTC_HANDSHAKE_FAILED';
      }
    } else if (c.status === 'Missed') {
      reason = 'Advisor did not answer within ringing timeout (90s)';
      stage = 'ringing';
      code = 'RINGING_TIMEOUT';
    } else if (c.status === 'Rejected') {
      reason = 'Advisor declined the call request';
      stage = 'ringing';
      code = 'CALL_DECLINED';
    } else if (c.status === 'Failed') {
      reason = 'WebRTC peer connection failed (UDP/Firewall blockage between networks)';
      stage = 'handshake';
      code = 'CONNECTION_FAILED';
    }

    if (reason) {
      c.failureReason = reason;
      c.failedAtStage = stage;
      c.errorCode = code;
      await c.save();

      // Check if diagnostic log exists, if not add one
      const existingLogs = await CallLog.countDocuments({ callId: c.callId, eventType: code });
      if (existingLogs === 0) {
        await new CallLog({
          callId: c.callId,
          call: c._id,
          user: c.user,
          admin: c.admin,
          role: 'system',
          eventType: code,
          severity: (c.status === 'Failed' || code === 'WEBRTC_HANDSHAKE_FAILED') ? 'error' : 'warn',
          stage: stage,
          errorName: code,
          errorMessage: reason,
          details: {
            status: c.status,
            acceptedTime: c.acceptedTime,
            connectedTime: c.connectedTime
          },
          timestamp: c.endTime || c.updatedAt || new Date()
        }).save();
      }

      console.log(`Updated ${c.callId} (${c.status}) -> ${reason}`);
    }
  }

  console.log('Migration complete!');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
