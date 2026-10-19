/*
 * WebRTC Voice Calling Companion Engine
 * Friend MVC - Production Ready, Hardened & Zero Regression
 */

// Global Socket instance
const socket = io({ transports: ['websocket', 'polling'] });

// Call State Lifecycle Enum
const CallState = {
  IDLE: 'IDLE',
  OUTGOING: 'OUTGOING',
  RINGING: 'RINGING',
  ACCEPTED: 'ACCEPTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  ACTIVE: 'ACTIVE',
  ENDING: 'ENDING',
  ENDED: 'ENDED',
  FINALIZED: 'FINALIZED',
  FAILED: 'FAILED',
  MISSED: 'MISSED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED'
};

let currentCallState = CallState.IDLE;

function isTerminalState(state) {
  return [
    CallState.ENDING,
    CallState.ENDED,
    CallState.FINALIZED,
    CallState.FAILED,
    CallState.MISSED,
    CallState.REJECTED,
    CallState.CANCELLED
  ].includes(state);
}

function transitionTo(nextState, context) {
  if (isTerminalState(currentCallState) && !isTerminalState(nextState)) {
    console.warn(`[CallState Guard] Blocked illegal state transition: ${currentCallState} -> ${nextState}`, context || '');
    return false;
  }
  console.log(`[CallState] ${currentCallState} -> ${nextState}`, context ? JSON.stringify(context) : '');
  currentCallState = nextState;
  return true;
}

// Active call metadata validation
const urlParams = new URLSearchParams(window.location.search);
const currentCallId = (window.activeCallId && window.activeCallId.trim()) || urlParams.get('callId') || localStorage.getItem('active_call_id') || '';
const isVideoCall = (window.callType === 'Video') || (urlParams.get('type') === 'video') || (localStorage.getItem('active_call_type') === 'Video');
const currentCreditRate = window.creditRate || (isVideoCall ? 2 : 1);

let isTerminating = false;
let ringingTimeoutTimer = null;
let connectingTimeoutTimer = null;

// STUN & TURNS (TLS on Port 443) server configuration for UAE / Strict Firewall Traversal
const defaultIceServers = [
  // High-priority TLS TURNS relays (Port 443 with TCP & TLS for UAE / strict firewall bypass)
  {
    urls: [
      'turns:global.relay.metered.ca:443?transport=tcp',
      'turns:global.relay.metered.ca:443',
      'turn:global.relay.metered.ca:443?transport=tcp',
      'turn:global.relay.metered.ca:443',
      'turn:global.relay.metered.ca:80'
    ],
    username: 'openrelay',
    credential: 'openrelay'
  },
  // STUN servers for standard networks
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

const rtcConfig = {
  iceServers: (window.iceServers && Array.isArray(window.iceServers) && window.iceServers.length > 0)
    ? window.iceServers
    : defaultIceServers,
  iceCandidatePoolSize: 10
};

let localStream = null;
let peerConnection = null;
let targetPeerId = null;
let webIceQueue = [];

let secondsElapsed = 0;
let callTimerInterval = null;
let currentCreditsUsed = 0;
let callStartTime = null;

// Session user configuration
const activeUser = window.sessionUser || { name: "Caller", credits: 5 };

// Function to report granular connection diagnostics & logs to backend
function reportCallIssue({
  eventType = 'CONNECTION_ISSUE',
  severity = 'info',
  stage = 'general',
  errorName = '',
  errorMessage = '',
  details = {},
  markCallFailed = false
} = {}) {
  const payload = {
    callId: currentCallId,
    eventType,
    severity,
    stage,
    errorName,
    errorMessage,
    details: {
      ...details,
      callState: currentCallState,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      callType: isVideoCall ? 'Video' : 'Voice'
    },
    markCallFailed: Boolean(markCallFailed)
  };

  console.log(`[Diagnostic Report] [${severity.toUpperCase()}] ${eventType} (${stage}): ${errorMessage || errorName}`);

  // 1. Emit through socket if connected
  if (socket && socket.connected) {
    socket.emit('call-issue-log', payload);
  }

  // 2. Reliable HTTP POST fallback (Ajax / Beacon)
  const isAdm = (window.isAdminReceiver || $("#webrtc-admin-trigger").length > 0);
  const endpoint = isAdm ? '/admin/log-call-issue' : '/user/log-call-issue';

  try {
    if (navigator.sendBeacon && markCallFailed) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(endpoint, blob);
    } else {
      $.ajax({
        url: endpoint,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload)
      });
    }
  } catch (e) {
    // Non-blocking
  }
}

// Socket connection diagnostic logging
socket.on('connect', () => {
  console.log(`[Socket] Connected to signaling server. Socket ID: ${socket.id}, Call ID: ${currentCallId}`);
});

socket.on('connect_error', (error) => {
  console.error("[Socket Error] Connection failed:", error);
  reportCallIssue({
    eventType: 'SOCKET_CONNECT_ERROR',
    severity: 'warn',
    stage: 'socket_connection',
    errorName: error.name,
    errorMessage: `Socket signaling connection error: ${error.message}`
  });
});

socket.on('disconnect', (reason) => {
  console.warn(`[Socket Warning] Disconnected from signaling server: ${reason}`);
  reportCallIssue({
    eventType: 'SOCKET_DISCONNECT',
    severity: 'warn',
    stage: 'socket_connection',
    errorMessage: `Socket disconnected: ${reason}`
  });
  // DO NOT terminate active call! WebRTC audio runs on separate P2P/TURN media channels.
  // Socket.io will automatically reconnect in the background.
});

$(document).ready(function() {
  const isUserCaller = $("#call-screen-trigger").length > 0 || window.isCaller;
  const isAdminReceiver = $("#webrtc-admin-trigger").length > 0 || window.isAdminReceiver;

  if (!currentCallId) {
    console.warn("[WebRTC] No active call session found. Smoothly redirecting to dashboard...");
    window.location.href = isAdminReceiver ? "/admin/dashboard" : "/user/dashboard";
    return;
  }

  if (isUserCaller) {
    initializeCallerFlow();
  } else if (isAdminReceiver) {
    initializeReceiverFlow();
  }
});

// ==========================================
// 1. Caller Flow (User side /user/call)
// ==========================================
function initializeCallerFlow() {
  const userName = (window.sessionUser && window.sessionUser.name) || activeUser.name;
  const userId = (window.sessionUser && window.sessionUser.id) || null;
  console.log(`[WebRTC] Starting caller flow for: ${userName} (Call ID: ${currentCallId})`);

  transitionTo(CallState.OUTGOING, { user: userName, callId: currentCallId });

  // Store for disconnect fallback
  localStorage.setItem('active_call_id', currentCallId);

  // Join call signaling room with Call ID
  function emitJoinRoom() {
    console.log(`[WebRTC] Emitting join-call-room for Call ID: ${currentCallId}, Socket ID: ${socket.id}`);
    socket.emit('join-call-room', {
      callId: currentCallId,
      userId: userId,
      userName: userName,
      callType: isVideoCall ? 'Video' : 'Voice'
    });
  }

  if (socket.connected) {
    emitJoinRoom();
  } else {
    socket.once('connect', emitJoinRoom);
  }

  // Ensure room re-joined if socket reconnects during active ringing/negotiation
  socket.on('connect', () => {
    if (currentCallId && !isTerminalState(currentCallState)) {
      emitJoinRoom();
    }
  });

  transitionTo(CallState.RINGING, { callId: currentCallId });
  $(".call-status-badge").html('<span class="status-indicator-dot online me-1"></span> Calling Advisor...');

  // Pre-warm microphone access while phone is ringing so user approves permission before handshake
  getMicrophoneAccess().catch((e) => {
    console.log("[WebRTC Pre-warm] Mic access initial request:", e.name || e.message);
  });

  // Live ringback acknowledgements (ignore if call already connected)
  socket.off('call-placed').on('call-placed', () => {
    if (currentCallState === CallState.CONNECTED || currentCallState === CallState.ACTIVE) return;
    console.log("[Socket] Call placed on server. Ringing advisor...");
    $(".call-status-badge").html('<span class="status-indicator-dot online me-1"></span> Ringing Phone...');
  });

  socket.off('call-ringing').on('call-ringing', () => {
    if (currentCallState === CallState.CONNECTED || currentCallState === CallState.ACTIVE) return;
    console.log("[Socket] Phone is ringing on advisor device...");
    $(".call-status-badge").html('<span class="status-indicator-dot online me-1"></span> Ringing Phone...');
  });

  // Ringing Timeout: 90 seconds generous window for advisor to answer device
  ringingTimeoutTimer = setTimeout(() => {
    if (currentCallState === CallState.RINGING || currentCallState === CallState.OUTGOING) {
      console.warn("[WebRTC Timeout] Ringing timed out after 90s without answer.");
      reportCallIssue({
        eventType: 'RINGING_TIMEOUT',
        severity: 'warn',
        stage: 'ringing',
        errorMessage: 'Ringing timed out after 90s without answer from advisor'
      });
      alert("Ashu is currently busy assisting another member. Please try calling again in a few moments.");
      socket.emit('hangup', { callId: currentCallId, reason: 'Missed', explicit: true });
      terminateCallSession('Missed', {
        failureReason: 'Ringing timed out after 90s without answer',
        errorCode: 'RINGING_TIMEOUT',
        failedAtStage: 'ringing'
      });
    }
  }, 90000);

  // Listen for admin to accept call
  socket.off('peer-connected').on('peer-connected', async (data) => {
    if (isTerminalState(currentCallState)) return;
    if (currentCallState === CallState.ACCEPTED || currentCallState === CallState.CONNECTING || currentCallState === CallState.CONNECTED || currentCallState === CallState.ACTIVE) {
      console.log("[Socket] Call already accepted or active, ignoring redundant peer-connected event.");
      return;
    }

    console.log(`[Socket] Ashu accepted call. Peer socket: ${data.adminId}`);
    if (ringingTimeoutTimer) {
      clearTimeout(ringingTimeoutTimer);
      ringingTimeoutTimer = null;
    }

    transitionTo(CallState.ACCEPTED, { peer: data.adminId });
    targetPeerId = data.adminId;
    callStartTime = Date.now();

    // Start 60s WebRTC Connection Timeout (ample time for TURNS 443 TLS handshake in strict firewalls)
    connectingTimeoutTimer = setTimeout(() => {
      if (currentCallState === CallState.ACCEPTED || currentCallState === CallState.CONNECTING) {
        console.warn("[WebRTC Timeout] Connection handshake timed out after 60s.");
        reportCallIssue({
          eventType: 'HANDSHAKE_TIMEOUT',
          severity: 'error',
          stage: 'handshake',
          errorMessage: 'WebRTC audio connection timed out after 60s handshake delay',
          markCallFailed: true
        });
        alert("Audio connection timed out. Please check your network and try again.");
        terminateCallSession('Failed', {
          failureReason: 'Connection timed out after 60s without handshake completion',
          errorCode: 'HANDSHAKE_TIMEOUT',
          failedAtStage: 'handshake'
        });
      }
    }, 60000);

    // Begin negotiations
    await startCallNegotiation(true);
  });

  // Listen for admin to reject/decline call
  socket.off('call-rejected').on('call-rejected', (data) => {
    console.warn(`[Socket] Call was declined by Ashu:`, data);
    if (ringingTimeoutTimer) clearTimeout(ringingTimeoutTimer);
    reportCallIssue({
      eventType: 'CALL_DECLINED',
      severity: 'warn',
      stage: 'ringing',
      errorMessage: 'Call declined by advisor'
    });
    alert('Your call request was declined by Ashu.');
    terminateCallSession('Rejected', {
      failureReason: 'Declined by advisor',
      errorCode: 'CALL_DECLINED',
      failedAtStage: 'ringing'
    });
  });
}

// ==========================================
// 2. Receiver Flow (Admin side /admin/call)
// ==========================================
function initializeReceiverFlow() {
  const callerId = urlParams.get('callerId') || localStorage.getItem("webrtc_caller_id");
  const callerName = localStorage.getItem("webrtc_caller_name") || "Calling Client";
  targetPeerId = callerId;

  console.log(`[WebRTC] Starting receiver flow for admin. Call ID: ${currentCallId}, Target caller: ${callerId}`);
  $("#caller-name-display").text(callerName);

  transitionTo(CallState.ACCEPTED, { callerId, callId: currentCallId });

  // Accept call alert & maintain presence
  function emitAdminAccept() {
    console.log(`[WebRTC] Emitting admin-accept-call for Call ID: ${currentCallId}, Socket ID: ${socket.id}`);
    socket.emit('admin-join', {
      adminId: (window.sessionUser && window.sessionUser.id) || null,
      name: (window.sessionUser && window.sessionUser.name) || "Ashu"
    });
    socket.emit('admin-accept-call', {
      callId: currentCallId,
      callerId: callerId,
      adminId: (window.sessionUser && window.sessionUser.id) || null,
      adminName: (window.sessionUser && window.sessionUser.name) || "Ashu"
    });
  }

  if (socket.connected) {
    emitAdminAccept();
  } else {
    socket.once('connect', emitAdminAccept);
  }

  // Pre-warm microphone for admin
  getMicrophoneAccess().catch((e) => {
    console.log("[WebRTC Pre-warm Admin] Mic access initial request:", e.name || e.message);
  });

  // Start 60s Connection Timeout for Admin
  connectingTimeoutTimer = setTimeout(() => {
    if (currentCallState === CallState.ACCEPTED || currentCallState === CallState.CONNECTING) {
      console.warn("[WebRTC Timeout] Peer connection handshake timed out for admin.");
      reportCallIssue({
        eventType: 'ADMIN_HANDSHAKE_TIMEOUT',
        severity: 'error',
        stage: 'handshake',
        errorMessage: 'Admin peer connection handshake timed out after 60s',
        markCallFailed: true
      });
      terminateCallSession('Failed', {
        failureReason: 'Admin peer connection handshake timed out after 60s',
        errorCode: 'HANDSHAKE_TIMEOUT',
        failedAtStage: 'handshake'
      });
    }
  }, 60000);

  // Listen for SDP Offer from caller
  socket.off('receive-offer').on('receive-offer', async (data) => {
    if (isTerminalState(currentCallState)) return;
    console.log(`[Socket] Received 'receive-offer' from peer.`);
    targetPeerId = data.senderId;

    try {
      transitionTo(CallState.CONNECTING, { targetPeerId });
      await setupPeerConnection();
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      
      // Flush any queued ICE candidates
      if (webIceQueue.length > 0) {
        console.log(`[WebRTC] Flushing ${webIceQueue.length} queued ICE candidate(s)...`);
        for (const cand of webIceQueue) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
          } catch (candErr) {
            console.warn("[WebRTC] Error adding queued candidate:", candErr);
          }
        }
        webIceQueue = [];
      }

      const stream = await getMicrophoneAccess();
      if (stream && peerConnection) {
        stream.getTracks().forEach(track => {
          try { peerConnection.addTrack(track, stream); } catch (e) {}
        });
      }

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      socket.emit('send-answer', {
        answer: answer,
        targetId: targetPeerId,
        callId: currentCallId
      });
    } catch (err) {
      console.error("[WebRTC Error] Negotiation failed during offer processing:", err);
      reportCallIssue({
        eventType: 'SDP_ANSWER_ERROR',
        severity: 'error',
        stage: 'offer_answer',
        errorName: err.name,
        errorMessage: 'Error during offer processing or answer creation: ' + (err.message || err.toString()),
        markCallFailed: true
      });
      terminateCallSession('Failed', {
        failureReason: 'Error during offer processing: ' + err.message,
        errorCode: 'SDP_ANSWER_ERROR',
        failedAtStage: 'offer_answer'
      });
    }
  });
}

// ==========================================
// 3. WebRTC Negotiation Core (Offer/Answer/ICE)
// ==========================================
async function startCallNegotiation(isInitiator) {
  try {
    if (isTerminalState(currentCallState)) return;
    console.log(`[WebRTC] Starting negotiation. Initiator: ${isInitiator}`);
    transitionTo(CallState.CONNECTING);

    await setupPeerConnection();
    const stream = await getMicrophoneAccess();

    if (stream && peerConnection) {
      stream.getTracks().forEach(track => {
        try { peerConnection.addTrack(track, stream); } catch (e) {}
      });
    }

    if (isInitiator && peerConnection) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('send-offer', {
        offer: offer,
        targetId: targetPeerId,
        callId: currentCallId
      });
    }
  } catch (err) {
    console.error("[WebRTC Error] Negotiation initialization failed:", err);
    reportCallIssue({
      eventType: 'SDP_OFFER_ERROR',
      severity: 'error',
      stage: 'offer_answer',
      errorName: err.name,
      errorMessage: 'Error creating WebRTC offer: ' + (err.message || err.toString()),
      markCallFailed: true
    });
    terminateCallSession('Failed', {
      failureReason: 'Error creating WebRTC offer: ' + err.message,
      errorCode: 'SDP_OFFER_ERROR',
      failedAtStage: 'offer_answer'
    });
  }
}

async function setupPeerConnection() {
  if (peerConnection || isTerminalState(currentCallState)) return;

  peerConnection = new RTCPeerConnection(rtcConfig);

  // Local ICE candidate forwarding
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && !isTerminalState(currentCallState)) {
      socket.emit('send-candidate', {
        candidate: event.candidate,
        targetId: targetPeerId,
        callId: currentCallId
      });
    }
  };

  // Remote audio & video track reception (with fallback for React Native streams)
  peerConnection.ontrack = (event) => {
    console.log(`[WebRTC] Remote track arrived (${event.track ? event.track.kind : 'stream'}).`);
    let stream = (event.streams && event.streams[0]);
    if (!stream && event.track) {
      stream = new MediaStream([event.track]);
    }

    if (stream) {
      const remoteAudio = document.getElementById('remoteAudio');
      if (remoteAudio) {
        remoteAudio.srcObject = stream;
        remoteAudio.play().catch(e => {
          console.warn('[WebRTC] Auto-play audio warning:', e);
          const resumeAudio = () => {
            remoteAudio.play().catch(() => {});
            window.removeEventListener('click', resumeAudio);
            window.removeEventListener('touchstart', resumeAudio);
          };
          window.addEventListener('click', resumeAudio, { once: true });
          window.addEventListener('touchstart', resumeAudio, { once: true });
        });
      }
      const remoteVideo = document.getElementById('remoteVideo');
      if (remoteVideo) {
        remoteVideo.srcObject = stream;
        remoteVideo.play().catch(e => console.warn('[WebRTC] Auto-play video warning:', e));
      }
    }
  };

  // Helper: Transition to active connected state idempotently
  const handleConnectedState = () => {
    if (currentCallState === CallState.CONNECTED || currentCallState === CallState.ACTIVE) return;

    if (connectingTimeoutTimer) {
      clearTimeout(connectingTimeoutTimer);
      connectingTimeoutTimer = null;
    }
    if (ringingTimeoutTimer) {
      clearTimeout(ringingTimeoutTimer);
      ringingTimeoutTimer = null;
    }

    transitionTo(CallState.CONNECTED);
    transitionTo(CallState.ACTIVE);

    console.log("[WebRTC] Call successfully established and active!");
    $("body").addClass("connected");
    $(".call-status-badge")
      .removeClass("connecting")
      .addClass("connected")
      .html('<span class="status-indicator-dot online me-1"></span> You\'re Connected');
    $(".call-pulse-animation, .call-pulse-animation-2").css("animation-duration", "1.5s");
    $("#call-cancel-btn-wrapper, #call-cancel-btn").addClass("d-none");
    $("#call-active-controls").removeClass("d-none");

    // Notify server that call is actively connected
    socket.emit('call-connected', { callId: currentCallId });

    startActiveCallTimer();
  };

  // Connection state changes
  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection) return;
    const connState = peerConnection.connectionState;
    console.log(`[WebRTC] Peer Connection State: ${connState}`);

    reportCallIssue({
      eventType: 'PEER_STATE_CHANGE',
      severity: (connState === 'failed' || connState === 'disconnected') ? 'warn' : 'info',
      stage: 'handshake',
      errorMessage: `Peer connection state changed to: ${connState}`,
      details: { connectionState: connState }
    });

    if (connState === 'connected') {
      handleConnectedState();
    } else if (connState === 'failed') {
      console.warn("[WebRTC] Peer connection failed. Attempting ICE restart...");
      reportCallIssue({
        eventType: 'PEER_FAILED',
        severity: 'warn',
        stage: 'in_call',
        errorMessage: 'Peer connection failed, attempting ICE restart'
      });
      if (typeof peerConnection.restartIce === 'function') {
        peerConnection.restartIce();
      }
      setTimeout(() => {
        if (peerConnection && peerConnection.connectionState === 'failed' && !isTerminalState(currentCallState)) {
          console.error("[WebRTC] Peer connection failed after ICE restart delay.");
          const failReason = 'WebRTC media connection failed (firewall or NAT traversal blockage between regions)';
          reportCallIssue({
            eventType: 'WEBRTC_ICE_FAILED',
            severity: 'error',
            stage: 'handshake',
            errorMessage: failReason,
            markCallFailed: true
          });
          alert("Audio connection could not be established. If you are in UAE/Dubai, please ensure you are connected to a stable network or Wi-Fi.");
          socket.emit('hangup', {
            callId: currentCallId,
            reason: 'Failed',
            failureReason: failReason,
            errorCode: 'WEBRTC_ICE_FAILED',
            failedAtStage: 'handshake'
          });
          terminateCallSession('Failed', {
            failureReason: failReason,
            errorCode: 'WEBRTC_ICE_FAILED',
            failedAtStage: 'handshake'
          });
        }
      }, 12000);
    } else if (connState === 'disconnected') {
      console.warn("[WebRTC] Peer connection temporarily disconnected (ICE attempting reconnection)...");
      reportCallIssue({
        eventType: 'PEER_DISCONNECTED',
        severity: 'info',
        stage: 'in_call',
        errorMessage: 'Peer connection temporarily disconnected (transient state)'
      });
      // DO NOT terminate active call! WebRTC automatically attempts to reconnect or re-route candidates.
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    if (!peerConnection) return;
    const iceState = peerConnection.iceConnectionState;
    console.log(`[WebRTC] ICE Connection State: ${iceState}`);

    reportCallIssue({
      eventType: 'ICE_STATE_CHANGE',
      severity: (iceState === 'failed' || iceState === 'disconnected') ? 'warn' : 'info',
      stage: 'ice_negotiation',
      errorMessage: `ICE connection state changed to: ${iceState}`,
      details: { iceState }
    });

    if (iceState === 'connected' || iceState === 'completed') {
      handleConnectedState();
    } else if (iceState === 'failed') {
      console.warn("[WebRTC] ICE failed. Attempting restart...");
      reportCallIssue({
        eventType: 'ICE_FAILED',
        severity: 'error',
        stage: 'ice_negotiation',
        errorMessage: 'ICE candidates failed to connect peer addresses',
        markCallFailed: true
      });
      if (typeof peerConnection.restartIce === 'function') {
        peerConnection.restartIce();
      }
    }
  };

  if ('onicecandidateerror' in peerConnection) {
    peerConnection.onicecandidateerror = (event) => {
      reportCallIssue({
        eventType: 'ICE_CANDIDATE_ERROR',
        severity: 'warn',
        stage: 'ice_negotiation',
        errorName: event.errorCode ? event.errorCode.toString() : 'IceCandidateError',
        errorMessage: event.errorText || 'ICE candidate gathering warning',
        details: { url: event.url, errorCode: event.errorCode }
      });
    };
  }
}

// Signaling listeners
socket.off('receive-answer').on('receive-answer', async (data) => {
  if (isTerminalState(currentCallState)) return;
  try {
    if (peerConnection && data.answer) {
      if (peerConnection.signalingState !== 'have-local-offer') {
        console.log(`[WebRTC] Skipping duplicate answer, current signalingState: ${peerConnection.signalingState}`);
        return;
      }
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      console.log("[WebRTC] Set remote description (Answer) successfully.");

      // Flush queued candidates
      if (webIceQueue.length > 0) {
        console.log(`[WebRTC] Flushing ${webIceQueue.length} queued ICE candidate(s)...`);
        for (const cand of webIceQueue) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
          } catch (candErr) {
            console.warn("[WebRTC] Error adding queued ICE candidate:", candErr);
          }
        }
        webIceQueue = [];
      }
    }
  } catch (err) {
    console.error("[WebRTC Error] Failed to set Remote Description (Answer):", err);
  }
});

socket.off('receive-candidate').on('receive-candidate', async (data) => {
  if (isTerminalState(currentCallState)) return;
  if (!data || !data.candidate) return;

  if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      console.log("[WebRTC] Added remote ICE candidate from peer.");
    } catch (e) {
      console.error("[WebRTC Error] Failed to add remote ICE candidate:", e);
    }
  } else {
    console.log("[WebRTC] Remote description not yet ready, queuing ICE candidate.");
    webIceQueue.push(data.candidate);
  }
});

socket.off('peer-disconnected').on('peer-disconnected', (data) => {
  console.warn(`[Socket] Received 'peer-disconnected':`, data);
  // ONLY terminate if the peer explicitly hung up or server explicitly finalized
  const isExplicit = data && (data.explicit || data.reason === 'Completed' || data.reason === 'Cancelled' || data.reason === 'Missed' || data.reason === 'Rejected' || data.reason === 'User Ended Call' || data.reason === 'Admin Ended Call');

  if (isExplicit) {
    console.log("[WebRTC] Peer explicitly ended the call. Terminating session...");
    terminateCallSession(secondsElapsed > 0 ? "Completed" : (data.reason || "Cancelled"));
  } else {
    console.log("[WebRTC] Ignoring non-explicit peer-disconnected event (network jitter/reconnecting).");
  }
});

socket.off('call-finalized').on('call-finalized', (data) => {
  console.log(`[Socket] Call finalized confirmation received from server:`, data);
});

// Hardware camera / microphone stream (with graceful video-to-audio and permission issue tracking)
async function getMicrophoneAccess() {
  if (localStream) return localStream;

  // 1. If Video Call, request both audio and video stream
  if (isVideoCall) {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        console.log("[WebRTC] Video and microphone access granted.");
        reportCallIssue({
          eventType: 'PERMISSION_APPROVED',
          severity: 'info',
          stage: 'media_permission',
          errorMessage: 'Microphone and Camera permission approved by user in browser'
        });
        attachLocalVideo(localStream);
        return localStream;
      }
    } catch (videoErr) {
      console.warn("[WebRTC Warning] Video camera access failed or denied, falling back to audio:", videoErr);
      reportCallIssue({
        eventType: (videoErr.name === 'NotAllowedError' || videoErr.name === 'PermissionDeniedError') ? 'CAMERA_PERMISSION_DENIED' : 'CAMERA_ERROR',
        severity: 'warn',
        stage: 'media_permission',
        errorName: videoErr.name,
        errorMessage: `Camera access issue: ${videoErr.message}. Attempting audio-only fallback.`,
        details: { error: videoErr.toString() }
      });
    }
  }

  // 2. Audio-only media request
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("[WebRTC] Microphone access granted.");
      reportCallIssue({
        eventType: 'PERMISSION_APPROVED',
        severity: 'info',
        stage: 'media_permission',
        errorMessage: 'Microphone permission approved by user in browser'
      });
      return localStream;
    }
  } catch (err) {
    console.warn("[WebRTC Error] Hardware microphone access failed:", err);

    const isPermissionDenied = (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
    const isDeviceNotFound = (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError');
    const isDeviceInUse = (err.name === 'NotReadableError' || err.name === 'TrackStartError');

    let eventType = 'MEDIA_ERROR';
    let friendlyMsg = 'Microphone access is required to participate in the call.';
    let failureReason = err.message || 'Microphone error';

    if (isPermissionDenied) {
      eventType = 'PERMISSION_DENIED';
      friendlyMsg = 'Microphone permission was not approved in browser. Please allow microphone access in your browser (lock icon in address bar) and try again.';
      failureReason = 'User did not approve microphone access in browser (Permission Denied)';
    } else if (isDeviceNotFound) {
      eventType = 'DEVICE_NOT_FOUND';
      friendlyMsg = 'No microphone device was detected on your system. Please connect an audio input device and try again.';
      failureReason = 'Microphone device not found (NotFoundError)';
    } else if (isDeviceInUse) {
      eventType = 'DEVICE_IN_USE';
      friendlyMsg = 'Microphone is already in use by another application. Please close other audio apps and try again.';
      failureReason = 'Microphone in use by another application (NotReadableError)';
    }

    reportCallIssue({
      eventType,
      severity: 'error',
      stage: 'media_permission',
      errorName: err.name,
      errorMessage: failureReason,
      details: {
        errorString: err.toString(),
        stack: err.stack || ''
      },
      markCallFailed: true
    });

    alert(friendlyMsg);

    socket.emit('hangup', {
      callId: currentCallId,
      reason: 'Failed',
      failureReason,
      errorCode: eventType,
      failedAtStage: 'media_permission'
    });

    terminateCallSession("Failed", {
      failureReason,
      errorCode: eventType,
      failedAtStage: 'media_permission'
    });

    return null;
  }

  // Graceful fallback for synthetic automated tests only
  if (window.__ENABLE_SILENT_MOCK_MIC__ || window.navigator.webdriver) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        const audioCtx = new AudioContext();
        const osc = audioCtx.createOscillator();
        const dst = audioCtx.createMediaStreamDestination();
        osc.connect(dst);
        osc.start();
        const track = dst.stream.getAudioTracks()[0];
        if (track) {
          track.enabled = false;
          localStream = dst.stream;
          console.log("[WebRTC] Automated test silent audio track fallback initialized.");
          return localStream;
        }
      }
    } catch (fallbackErr) {}
  }

  console.error("[WebRTC Error] Microphone access denied or no audio device available.");
  reportCallIssue({
    eventType: 'MEDIA_UNSUPPORTED',
    severity: 'error',
    stage: 'media_permission',
    errorMessage: 'No audio device available or mediaDevices unsupported',
    markCallFailed: true
  });
  alert("Microphone access is required to participate in the call.");
  socket.emit('hangup', {
    callId: currentCallId,
    reason: 'Failed',
    failureReason: 'No audio device available'
  });
  terminateCallSession("Failed", {
    failureReason: 'No audio device available or mediaDevices unsupported',
    errorCode: 'MEDIA_UNSUPPORTED',
    failedAtStage: 'media_permission'
  });
  return null;
}

function attachLocalVideo(stream) {
  const localVideo = document.getElementById('localVideo');
  if (localVideo && stream) {
    localVideo.srcObject = stream;
    localVideo.play().catch(e => console.warn('[WebRTC] Local video auto-play warning:', e));
  }
}

// ==========================================
// 4. Visual Call Timer & Client-side Balance Tracker
// ==========================================
function startActiveCallTimer() {
  if (callTimerInterval) return;

  console.log("[UI] Starting duration timer...");
  const rate = currentCreditRate || (isVideoCall ? 2 : 1);

  callTimerInterval = setInterval(() => {
    secondsElapsed++;

    const mins = Math.floor(secondsElapsed / 60);
    const secs = secondsElapsed % 60;
    const timeStr = (mins < 10 ? "0" + mins : mins) + ":" + (secs < 10 ? "0" + secs : secs);
    $(".call-timer").text(timeStr);

    const isUserCaller = $("#call-screen-trigger").length > 0 || window.isCaller;
    if (isUserCaller && secondsElapsed % 60 === 0) {
      if (activeUser && activeUser.credits > 0) {
        const deductAmount = Math.min(activeUser.credits, rate);
        activeUser.credits -= deductAmount;
        currentCreditsUsed += deductAmount;

        $("#call-credits-remaining").text(activeUser.credits);
        $("#call-credits-used").text(currentCreditsUsed);
        $(".simulated-balance").text(activeUser.credits);

        if (activeUser.credits <= (rate * 2)) {
          triggerLowCreditWarning(rate);
        }

        if (activeUser.credits < rate) {
          console.log("[Billing] Coins insufficient for next minute. Disconnecting call...");
          terminateCallSession("Auto-Disconnected (No Credits)");
        }
      }
    }
  }, 1000);
}

function triggerLowCreditWarning(rate = 1) {
  if (isVideoCall) return; // Full-screen video call: suppress text alert banners
  if ($(".call-low-credit-bar").length === 0) {
    const minsRemaining = Math.max(1, Math.floor((activeUser.credits || 0) / rate));
    const warningHtml = `
      <div class="call-low-credit-bar">
        <span><i class="bi bi-exclamation-triangle-fill me-2"></i> Low Coins Alert: ~${minsRemaining} Min Remaining</span>
        <a href="/user/buy-credits" target="_blank" class="btn btn-sm btn-light text-danger fw-bold rounded-pill px-3">Recharge Now</a>
      </div>
    `;
    $("#call-screen-footer-container").prepend(warningHtml);
  }
}

// ==========================================
// 5. Termination & Cleanup Handlers (Idempotent)
// ==========================================
$(document).on("click", "#call-end-btn, #call-cancel-btn", function(e) {
  e.preventDefault();
  console.log("[UI] Hangup / Cancel button clicked.");
  const finalReason = secondsElapsed > 0 ? "Completed" : "Cancelled";
  
  let diagnostics = {};
  if (finalReason === "Cancelled") {
    if (currentCallState === CallState.RINGING || currentCallState === CallState.OUTGOING) {
      diagnostics = {
        failureReason: "Caller cancelled the call before advisor answered",
        errorCode: "CALLER_CANCELLED_WHILE_RINGING",
        failedAtStage: "ringing"
      };
    } else if (currentCallState === CallState.ACCEPTED || currentCallState === CallState.CONNECTING) {
      diagnostics = {
        failureReason: "Caller cancelled during audio connection handshake (firewall or NAT traversal delay)",
        errorCode: "HANDSHAKE_CANCELLED",
        failedAtStage: "handshake"
      };
    } else {
      diagnostics = {
        failureReason: "Call cancelled by user",
        errorCode: "CALL_CANCELLED",
        failedAtStage: "general"
      };
    }
  }

  socket.emit('hangup', {
    callId: currentCallId,
    reason: finalReason,
    explicit: true,
    ...diagnostics
  });
  terminateCallSession(finalReason, diagnostics);
});

function terminateCallSession(statusType, diagnostics = {}) {
  if (isTerminating) return;
  isTerminating = true;

  transitionTo(CallState.ENDING, { statusType });

  console.log(`[WebRTC] Terminating call session (${currentCallId}) with status: ${statusType}`, diagnostics);

  // Protect buttons against multi-click
  $("#call-end-btn, #call-cancel-btn").prop('disabled', true);
  if ($("#call-cancel-btn").is(":visible")) {
    $("#call-cancel-btn").text('Cancelling...');
  }
  $("#call-end-btn").html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>');

  // Clear timers
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  if (ringingTimeoutTimer) {
    clearTimeout(ringingTimeoutTimer);
    ringingTimeoutTimer = null;
  }
  if (connectingTimeoutTimer) {
    clearTimeout(connectingTimeoutTimer);
    connectingTimeoutTimer = null;
  }

  // Stop microphone hardware tracks safely
  if (localStream) {
    try {
      localStream.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
    } catch (e) {
      console.warn('[WebRTC] Stream track stop warning:', e);
    }
    localStream = null;
  }

  // Close PeerConnection
  if (peerConnection) {
    try {
      peerConnection.close();
    } catch (e) {
      console.warn('[WebRTC] PeerConnection close warning:', e);
    }
    peerConnection = null;
  }
  webIceQueue = [];

  // Clean local storage state
  localStorage.removeItem('active_call_id');
  localStorage.removeItem('webrtc_caller_id');
  localStorage.removeItem('webrtc_caller_name');

  transitionTo(CallState.ENDED, { statusType });

  const isUserCaller = $("#call-screen-trigger").length > 0 || window.isCaller;

  const payloadData = {
    callId: currentCallId,
    status: statusType,
    failureReason: diagnostics.failureReason || '',
    errorCode: diagnostics.errorCode || '',
    failedAtStage: diagnostics.failedAtStage || '',
    errorDetails: diagnostics.errorDetails || ''
  };

  if (isUserCaller) {
    // Notify server via AJAX to finalize call and deduct credits
    $.ajax({
      url: '/user/end-call',
      method: 'POST',
      data: payloadData,
      complete: function() {
        transitionTo(CallState.FINALIZED);
        const queryParam = (statusType === 'Failed') ? 'callFailed=true' : 'callFinished=true';
        window.location.href = `/user/call-history?${queryParam}`;
      }
    });
  } else {
    // Admin receiver flow
    $.ajax({
      url: '/admin/end-call',
      method: 'POST',
      data: payloadData,
      complete: function() {
        transitionTo(CallState.FINALIZED);
        window.location.href = "/admin/calls";
      }
    });
  }
}

// Microphone mute/unmute
function toggleLocalMute() {
  const $btn = $("#mute-toggle-btn");
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      $btn.toggleClass("active");
      $btn.find("i").toggleClass("bi-mic-fill bi-mic-mute-fill");
    }
  }
}

// Speaker mute/unmute
function toggleRemoteSpeaker() {
  const $btn = $("#speaker-toggle-btn");
  const remoteAudio = document.getElementById('remoteAudio');
  if (remoteAudio) {
    remoteAudio.muted = !remoteAudio.muted;
    $btn.toggleClass("active");
    $btn.find("i").toggleClass("bi-volume-up-fill bi-volume-mute-fill");
  }
}

// Camera video mute/unmute toggle
function toggleLocalVideo() {
  const $btn = $("#camera-toggle-btn");
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      $btn.toggleClass("active");
      $btn.find("i").toggleClass("bi-camera-video-fill bi-camera-video-off-fill");
      console.log(`[WebRTC] Camera toggled: ${videoTrack.enabled ? 'Enabled' : 'Disabled'}`);
    }
  }
}

// Front / back camera flipping on mobile devices
let currentFacingMode = 'user';
async function flipCamera() {
  if (!localStream || !peerConnection) return;
  const currentVideoTrack = localStream.getVideoTracks()[0];
  if (!currentVideoTrack) return;

  currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact: currentFacingMode } }
    });
    const newVideoTrack = newStream.getVideoTracks()[0];
    const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) {
      await sender.replaceTrack(newVideoTrack);
    }
    localStream.removeTrack(currentVideoTrack);
    currentVideoTrack.stop();
    localStream.addTrack(newVideoTrack);
    const localVideo = document.getElementById('localVideo');
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.style.transform = (currentFacingMode === 'environment') ? 'none' : 'scaleX(-1)';
    }
    console.log(`[WebRTC] Camera flipped to: ${currentFacingMode}`);
  } catch (err) {
    console.warn('[WebRTC Warning] Could not flip camera:', err);
  }
}

