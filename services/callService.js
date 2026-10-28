const mongoose = require('mongoose');
const Call = require('../models/Call');
const CallLog = require('../models/CallLog');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

/**
 * Helper to format seconds into MM:SS or HH:MM:SS
 */
function formatDuration(seconds) {
  if (isNaN(seconds) || seconds <= 0) return "00:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const pad = (n) => (n < 10 ? "0" + n : n);
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/**
 * Generate a unique Call ID
 */
function generateCallId() {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(1000 + Math.random() * 9000);
  return `CALL-${timestamp}${random}`;
}

/**
 * Generate a unique Transaction ID
 */
function generateTxnId() {
  const timestamp = Date.now().toString().slice(-4);
  const random1 = Math.floor(1000 + Math.random() * 9000);
  const random2 = Math.floor(10 + Math.random() * 90);
  return `TXN-${timestamp}${random1}${random2}`;
}

/**
 * Structured Logger for Production Call Lifecycle Events
 */
function logStructured(eventType, data) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${eventType}]`, JSON.stringify(data));
}

/**
 * 1. Initiate a Call (Server Source of Truth)
 * Creates a Call document in 'Initiated' state after verifying user balance.
 */
async function initiateCall({ user, callType = 'Voice' }) {
  if (!user || !user._id) {
    logStructured('CALL_FAILED', { reason: 'User is required to initiate a call' });
    throw new Error('User is required to initiate a call');
  }

  // Reload user to ensure latest credits
  const freshUser = await User.findById(user._id);
  if (!freshUser) {
    logStructured('CALL_FAILED', { reason: 'User not found in database', userId: user._id });
    throw new Error('User not found');
  }

  const isVideo = (callType === 'Video');
  const creditRate = isVideo ? 2 : 1; // Video calls consume 2 coins/minute, Voice calls 1 coin/minute
  const minRequired = creditRate;

  if (freshUser.credits < minRequired) {
    logStructured('CALL_FAILED', { reason: 'INSUFFICIENT_CREDITS', userId: freshUser._id, credits: freshUser.credits, required: minRequired });
    const err = new Error(`Insufficient coins to initiate a ${isVideo ? 'video' : 'voice'} call (minimum ${minRequired} coins required)`);
    err.code = 'INSUFFICIENT_CREDITS';
    throw err;
  }

  const callId = generateCallId();
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: true });

  const call = new Call({
    callId,
    user: freshUser._id,
    callerName: freshUser.name || 'Caller',
    receiverName: 'Talk With Ashu',
    callType: isVideo ? 'Video' : 'Voice',
    date: now,
    time: timeStr,
    startTime: now,
    duration: '00:00',
    durationSeconds: 0,
    durationMinutes: 0,
    creditRate: creditRate,
    credits: 0,
    creditStatus: 'none',
    status: 'Initiated',
    finalized: false
  });

  await call.save();
  logStructured('CALL_CREATED', {
    callId,
    userId: freshUser._id,
    callerName: freshUser.name,
    credits: freshUser.credits,
    status: 'Initiated'
  });
  return call;
}

/**
 * 2. Accept Call
 * Invoked when an admin/advisor accepts the call.
 */
async function acceptCall({ callId, admin }) {
  if (!callId) return null;
  const call = await Call.findOne({ callId });
  if (!call) {
    logStructured('CALL_FAILED', { action: 'acceptCall', callId, reason: 'Call not found' });
    return null;
  }

  if (call.finalized || ['Cancelled', 'Rejected', 'Missed', 'Completed', 'Failed', 'Auto-Disconnected (No Credits)'].includes(call.status)) {
    logStructured('CALL_FAILED', {
      action: 'acceptCall',
      callId,
      reason: `Cannot accept call in terminal state: ${call.status}`
    });
    return null;
  }

  if (admin && admin._id) {
    call.admin = admin._id;
    call.receiverName = admin.name || 'Ashu';
  }
  call.acceptedTime = new Date();
  call.status = 'Ringing';
  await call.save();

  logStructured('CALL_ACCEPTED', {
    callId,
    adminId: admin ? admin._id : null,
    receiverName: call.receiverName,
    status: call.status
  });
  return call;
}

/**
 * 3. Connect Call
 * Invoked when WebRTC peer connection is established and media streaming begins.
 * Billing timer starts here.
 */
async function connectCall({ callId }) {
  if (!callId) return null;
  const call = await Call.findOne({ callId });
  if (!call) {
    logStructured('CALL_FAILED', { action: 'connectCall', callId, reason: 'Call not found' });
    return null;
  }

  if (call.finalized || ['Cancelled', 'Rejected', 'Missed', 'Completed', 'Failed', 'Auto-Disconnected (No Credits)'].includes(call.status)) {
    logStructured('CALL_FAILED', {
      action: 'connectCall',
      callId,
      reason: `Cannot connect call in terminal state: ${call.status}`
    });
    return null;
  }

  if (!call.connectedTime) {
    call.connectedTime = new Date();
    call.status = 'In Progress';
    await call.save();
    logStructured('CALL_CONNECTED', {
      callId,
      connectedTime: call.connectedTime.toISOString(),
      status: call.status
    });
  }

  return call;
}

/**
 * 4. Finalize Call (Centralized, Idempotent, Atomic)
 * The single source of truth for:
 * - Authoritative duration calculation
 * - Authoritative credit calculation
 * - Exactly-once credit deduction
 * - Credit transaction ledger entry
 * - Final call status
 */
async function finalizeCall(callId, {
  reason = 'Completed',
  forcedEndTime = null,
  failureReason = '',
  errorCode = '',
  failedAtStage = '',
  errorDetails = ''
} = {}) {
  if (!callId) {
    console.warn('[CallService] finalizeCall called without callId');
    return null;
  }

  // Check if call exists first
  const existingCall = await Call.findOne({ callId });
  if (!existingCall) {
    console.warn(`[CallService] finalizeCall - Call not found: ${callId}`);
    return null;
  }

  // Idempotency check: if already finalized, return immediately without re-deducting
  if (existingCall.finalized) {
    const populated = await Call.findOne({ callId }).populate('user').populate('admin').populate('transaction');
    logStructured('CREDIT_ALREADY_DEDUCTED', {
      callId,
      credits: populated ? populated.credits : 0,
      status: populated ? populated.status : 'Unknown'
    });
    return {
      success: true,
      alreadyFinalized: true,
      call: populated,
      creditsDeducted: populated ? populated.credits : 0,
      remainingCredits: populated && populated.user ? populated.user.credits : 0
    };
  }

  // Atomic lock: Set finalized to true atomically to prevent race conditions
  const lockedCall = await Call.findOneAndUpdate(
    { callId, finalized: false },
    { $set: { finalized: true } },
    { returnDocument: 'after' }
  );

  // If another thread locked it simultaneously
  if (!lockedCall) {
    const populated = await Call.findOne({ callId }).populate('user').populate('admin').populate('transaction');
    logStructured('CREDIT_ALREADY_DEDUCTED', {
      callId,
      reason: 'Concurrent finalization resolved',
      credits: populated ? populated.credits : 0
    });
    return {
      success: true,
      alreadyFinalized: true,
      call: populated,
      creditsDeducted: populated ? populated.credits : 0,
      remainingCredits: populated && populated.user ? populated.user.credits : 0
    };
  }

  const endTime = forcedEndTime || new Date();
  let durationSeconds = 0;
  let durationMinutes = 0;
  let creditsToDeduct = 0;
  let finalStatus = reason;

  // Calculate billable duration if call was connected
  if (lockedCall.connectedTime) {
    const elapsedMs = Math.max(0, endTime.getTime() - lockedCall.connectedTime.getTime());
    durationSeconds = Math.floor(elapsedMs / 1000);
    durationMinutes = Math.ceil(durationSeconds / 60);

    if (durationSeconds > 0) {
      const rate = lockedCall.creditRate || (lockedCall.callType === 'Video' ? 2 : 1);
      creditsToDeduct = durationMinutes * rate;
    }

    if (reason === 'Auto-Disconnected (No Credits)') {
      finalStatus = 'Auto-Disconnected (No Credits)';
    } else if (durationSeconds > 0) {
      finalStatus = (reason === 'Failed') ? 'Failed' : 'Completed';
    } else if (reason === 'Cancelled') {
      finalStatus = 'Cancelled';
    } else if (reason === 'Rejected') {
      finalStatus = 'Rejected';
    } else if (reason === 'Missed') {
      finalStatus = 'Missed';
    } else if (reason === 'Failed') {
      finalStatus = 'Failed';
    } else {
      finalStatus = 'Completed';
    }
  } else {
    // Call never connected -> Zero billable duration
    durationSeconds = 0;
    durationMinutes = 0;
    creditsToDeduct = 0;

    if (reason === 'Rejected') {
      finalStatus = 'Rejected';
    } else if (reason === 'Cancelled') {
      finalStatus = 'Cancelled';
    } else if (reason === 'Missed') {
      finalStatus = 'Missed';
    } else if (reason === 'Failed') {
      finalStatus = 'Failed';
    } else {
      finalStatus = 'Cancelled';
    }
  }

  logStructured('CREDIT_CALCULATED', {
    callId,
    connectedTime: lockedCall.connectedTime ? lockedCall.connectedTime.toISOString() : null,
    endTime: endTime.toISOString(),
    durationSeconds,
    durationMinutes,
    creditsToDeduct,
    finalStatus
  });

  const formattedDuration = formatDuration(durationSeconds);

  // Deduct credits atomically and log transaction
  let userDoc = null;
  let txnDoc = null;

  if (creditsToDeduct > 0) {
    const beforeUser = await User.findById(lockedCall.user);
    if (beforeUser) {
      const balanceBefore = beforeUser.credits;
      const actualDeduction = Math.min(balanceBefore, creditsToDeduct);

      // Atomic decrement prevents race condition overspending
      userDoc = await User.findOneAndUpdate(
        { _id: lockedCall.user },
        { $inc: { credits: -actualDeduction } },
        { returnDocument: 'after' }
      );
      const balanceAfter = userDoc ? userDoc.credits : Math.max(0, balanceBefore - actualDeduction);

      // Create traceable Transaction record
      txnDoc = new Transaction({
        txnId: generateTxnId(),
        user: lockedCall.user,
        desc: `Call Charges (${lockedCall.callId})`,
        type: 'debit',
        credits: actualDeduction,
        amount: 'AED 0',
        status: 'Completed',
        callId: lockedCall.callId,
        call: lockedCall._id,
        balanceBefore: balanceBefore,
        balanceAfter: balanceAfter,
        referenceType: 'CALL',
        referenceId: lockedCall.callId
      });
      await txnDoc.save();

      lockedCall.credits = actualDeduction;
      lockedCall.creditStatus = 'deducted';
      lockedCall.transaction = txnDoc._id;
      logStructured('CREDIT_DEDUCTED', {
        callId,
        userId: lockedCall.user,
        creditsDeducted: actualDeduction,
        balanceBefore,
        remainingCredits: balanceAfter,
        txnId: txnDoc.txnId
      });
    }
  } else {
    lockedCall.credits = 0;
    lockedCall.creditStatus = (finalStatus === 'Completed' ? 'waived' : 'none');
  }

  // Update Call record with final metrics
  lockedCall.duration = formattedDuration;
  lockedCall.durationSeconds = durationSeconds;
  lockedCall.durationMinutes = durationMinutes;
  lockedCall.status = finalStatus;
  lockedCall.endTime = endTime;

  // Intelligently infer diagnosis if call ended without connecting or without explicit failure reason
  let effectiveFailureReason = failureReason || lockedCall.failureReason || '';
  let effectiveErrorCode = errorCode || lockedCall.errorCode || '';
  let effectiveFailedStage = failedAtStage || lockedCall.failedAtStage || '';

  if (!effectiveFailureReason && (!lockedCall.connectedTime || finalStatus !== 'Completed')) {
    if (finalStatus === 'Cancelled') {
      if (!lockedCall.acceptedTime) {
        effectiveFailureReason = 'Caller cancelled the call before advisor answered (phone was ringing)';
        effectiveFailedStage = 'ringing';
        effectiveErrorCode = 'CALLER_CANCELLED_WHILE_RINGING';
      } else {
        effectiveFailureReason = 'Media connection could not be established during WebRTC handshake (Dubai/strict firewall or network timeout)';
        effectiveFailedStage = 'handshake';
        effectiveErrorCode = 'WEBRTC_HANDSHAKE_FAILED';
      }
    } else if (finalStatus === 'Missed') {
      effectiveFailureReason = 'Advisor did not answer within ringing timeout (90 seconds)';
      effectiveFailedStage = 'ringing';
      effectiveErrorCode = 'RINGING_TIMEOUT';
    } else if (finalStatus === 'Rejected') {
      effectiveFailureReason = 'Advisor declined the call request';
      effectiveFailedStage = 'ringing';
      effectiveErrorCode = 'CALL_DECLINED';
    } else if (finalStatus === 'Failed') {
      effectiveFailureReason = 'WebRTC peer connection failed (UDP/Firewall blockage between networks)';
      effectiveFailedStage = 'handshake';
      effectiveErrorCode = 'CONNECTION_FAILED';
    } else if (finalStatus === 'Auto-Disconnected (No Credits)') {
      effectiveFailureReason = 'Call ended automatically due to insufficient coins';
      effectiveFailedStage = 'in_call';
      effectiveErrorCode = 'INSUFFICIENT_CREDITS';
    }
  }

  lockedCall.failureReason = effectiveFailureReason;
  lockedCall.errorCode = effectiveErrorCode;
  lockedCall.failedAtStage = effectiveFailedStage;
  if (errorDetails) {
    lockedCall.errorDetails = typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails);
  }

  await lockedCall.save();

  // Record this termination diagnostic event in CallLog if call was not completed
  if (finalStatus !== 'Completed') {
    try {
      await recordCallLog({
        callId: lockedCall.callId,
        userId: lockedCall.user,
        adminId: lockedCall.admin || null,
        role: 'system',
        eventType: effectiveErrorCode || 'CALL_TERMINATED',
        severity: (finalStatus === 'Failed' || effectiveErrorCode === 'WEBRTC_HANDSHAKE_FAILED') ? 'error' : 'warn',
        stage: effectiveFailedStage || 'general',
        errorName: effectiveErrorCode || finalStatus,
        errorMessage: effectiveFailureReason || `Call ended with status: ${finalStatus}`,
        details: {
          status: finalStatus,
          duration: formattedDuration,
          acceptedTime: lockedCall.acceptedTime,
          connectedTime: lockedCall.connectedTime
        }
      });
    } catch (logErr) {
      console.warn('[CallService] Error recording termination log:', logErr.message);
    }
  }

  logStructured('CALL_FINALIZED', {
    callId,
    duration: formattedDuration,
    durationSeconds,
    durationMinutes,
    credits: lockedCall.credits,
    creditStatus: lockedCall.creditStatus,
    status: finalStatus
  });

  const populated = await Call.findById(lockedCall._id).populate('user').populate('admin').populate('transaction');

  return {
    success: true,
    alreadyFinalized: false,
    call: populated,
    creditsDeducted: lockedCall.credits,
    remainingCredits: userDoc ? userDoc.credits : (populated && populated.user ? populated.user.credits : 0)
  };
}

/**
 * 5. Record Call Log / Connection Issue
 * Persists granular connection diagnostics, browser approvals/denials,
 * ICE/WebRTC errors, timeouts, and hardware issues.
 */
async function recordCallLog({
  callId,
  userId = null,
  adminId = null,
  role = 'user',
  eventType = 'CONNECTION_ISSUE',
  severity = 'info',
  stage = 'general',
  errorName = '',
  errorMessage = '',
  details = {},
  markCallFailed = false
}) {
  try {
    let callDoc = null;
    if (callId) {
      callDoc = await Call.findOne({ callId });
    }

    const logEntry = new CallLog({
      callId: callId || (callDoc ? callDoc.callId : 'UNKNOWN'),
      call: callDoc ? callDoc._id : null,
      user: userId || (callDoc ? callDoc.user : null),
      admin: adminId || (callDoc ? callDoc.admin : null),
      role: role || 'user',
      eventType: eventType || 'CONNECTION_ISSUE',
      severity: severity || 'info',
      stage: stage || 'general',
      errorName: errorName || '',
      errorMessage: errorMessage || '',
      details: details || {},
      timestamp: new Date()
    });

    await logEntry.save();

    // If call document exists, update call record and append to embedded connectionLogs array
    if (callDoc) {
      const embeddedLog = {
        timestamp: new Date(),
        role: role || 'user',
        eventType: eventType || 'CONNECTION_ISSUE',
        severity: severity || 'info',
        stage: stage || 'general',
        message: errorMessage || errorName || eventType,
        details: details || {}
      };

      if (!Array.isArray(callDoc.connectionLogs)) {
        callDoc.connectionLogs = [];
      }
      callDoc.connectionLogs.push(embeddedLog);

      if (markCallFailed || severity === 'error') {
        // Mark call as Failed if not already successfully finalized with connected duration
        if (!['Completed', 'Auto-Disconnected (No Credits)'].includes(callDoc.status) || callDoc.durationSeconds === 0) {
          callDoc.status = 'Failed';
          callDoc.failureReason = errorMessage || errorName || eventType;
          callDoc.failedAtStage = stage;
          callDoc.errorCode = errorName || eventType;
          if (details) {
            callDoc.errorDetails = typeof details === 'string' ? details : JSON.stringify(details);
          }
        }
      }

      await callDoc.save();
    }

    logStructured('CALL_DIAGNOSTIC_LOG', {
      callId,
      role,
      eventType,
      severity,
      stage,
      errorName,
      errorMessage,
      markCallFailed
    });

    return logEntry;
  } catch (err) {
    console.error('[CallService Error] recordCallLog failed:', err);
    return null;
  }
}

/**
 * Active Admin Presence Registry for Real-Time Online/Offline Status
 */
const activeAdminSockets = new Map(); // socketId -> { adminId, name, joinedAt }

function registerAdminPresence(socketId, info = {}) {
  activeAdminSockets.set(socketId, {
    adminId: info.adminId || null,
    name: info.name || 'Ashu',
    joinedAt: new Date()
  });
  logStructured('ADMIN_ONLINE', { socketId, activeCount: activeAdminSockets.size });
  return getAdvisorPresenceInfo();
}

function unregisterAdminPresence(socketId) {
  if (activeAdminSockets.has(socketId)) {
    activeAdminSockets.delete(socketId);
    logStructured('ADMIN_OFFLINE', { socketId, activeCount: activeAdminSockets.size });
  }
  return getAdvisorPresenceInfo();
}

function isAdvisorOnline() {
  return activeAdminSockets.size > 0;
}

function getAdvisorPresenceInfo() {
  return {
    isOnline: activeAdminSockets.size > 0,
    count: activeAdminSockets.size
  };
}

/**
 * Helper to fetch a single call with all populated relations
 */
async function getCallById(callId) {
  return await Call.findOne({ callId }).populate('user').populate('admin').populate('transaction');
}

/**
 * Access control check for calls
 */
async function checkCallAccess(userId, requiredCredits = 1, callType = 'Voice') {
  const minCredits = (callType === 'Video' && requiredCredits === 1) ? 2 : requiredCredits;

  if (!userId) {
    return {
      allowed: false,
      code: 'UNAUTHORIZED',
      message: 'Authentication required to make a call.'
    };
  }

  const user = await User.findById(userId);
  if (!user) {
    return {
      allowed: false,
      code: 'USER_NOT_FOUND',
      message: 'User account not found.'
    };
  }

  if (user.isBlocked) {
    return {
      allowed: false,
      code: 'USER_BLOCKED',
      message: 'Account has been suspended. Please contact support.'
    };
  }

  if (user.credits < minCredits) {
    return {
      allowed: false,
      code: 'INSUFFICIENT_CREDITS',
      message: `You need at least ${minCredits} coins to start a ${callType.toLowerCase()} call. Please purchase coins to continue.`,
      credits: user.credits,
      requiredCredits: minCredits
    };
  }

  return {
    allowed: true,
    credits: user.credits
  };
}

module.exports = {
  formatDuration,
  generateCallId,
  initiateCall,
  acceptCall,
  connectCall,
  finalizeCall,
  getCallById,
  checkCallAccess,
  logStructured,
  registerAdminPresence,
  unregisterAdminPresence,
  isAdvisorOnline,
  getAdvisorPresenceInfo,
  recordCallLog
};

