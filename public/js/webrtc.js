/*
 * WebRTC Voice & Video Calling Companion Engine
 * Friend MVC - Optimized for Slow & Unstable Networks
 * Features:
 *  - Adaptive Bitrate Controller (ABR) & Dynamic Video Scaling (Resolution & Framerate)
 *  - Opus In-band FEC (Forward Error Correction) & DTX for Packet Loss Resilience
 *  - Real-time Network Quality Monitor (RTT, Jitter, Packet Loss, BWE)
 *  - Audio-First Fallback (Prioritizes voice clarity over video on weak networks)
 *  - Seamless ICE Restart & Reconnection without call termination
 *  - Jitter Buffer Tuning & Low Latency Telephony
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
let heartbeatTimer = null;

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
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

const rtcConfig = {
  iceServers: (window.iceServers && Array.isArray(window.iceServers) && window.iceServers.length > 0)
    ? window.iceServers
    : defaultIceServers,
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceTransportPolicy: 'all'
};

let localStream = null;
let peerConnection = null;
let targetPeerId = null;
let webIceQueue = [];

let secondsElapsed = 0;
let callTimerInterval = null;
let currentCreditsUsed = 0;
let callStartTime = null;

// Network Quality & Adaptive ABR controller instances
let networkMonitor = null;
let currentQualityTier = 'EXCELLENT';
let isAudioFirstFallbackActive = false;
let isRestartingIce = false;
let iceDisconnectGraceTimer = null;

// Session user configuration
const activeUser = window.sessionUser || { name: "Caller", credits: 5 };

// ==========================================
// SDP Optimization Engine (Opus FEC, DTX, VBR & Video RTCP Feedback)
// ==========================================
function optimizeSDP(sdp, options = {}) {
  if (!sdp || typeof sdp !== 'string') return sdp;

  const {
    maxAudioBitrate = 32000,
    enableFEC = true,
    enableDTX = true,
    forceMono = true
  } = options;

  let lines = sdp.split('\r\n');
  if (lines.length <= 1) {
    lines = sdp.split('\n');
  }

  // 1. Identify Opus payload type from rtpmap
  let opusPt = null;
  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+opus\/48000/i);
    if (match) {
      opusPt = match[1];
      break;
    }
  }

  const modifiedLines = [];
  let fmtpFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (opusPt && line.startsWith(`a=fmtp:${opusPt}`)) {
      fmtpFound = true;
      const parts = line.split(' ');
      const prefix = parts[0];
      const paramStr = parts.slice(1).join(' ');

      const paramMap = new Map();
      if (paramStr) {
        paramStr.split(';').forEach(p => {
          const kv = p.trim().split('=');
          if (kv[0]) {
            paramMap.set(kv[0].trim(), kv[1] ? kv[1].trim() : '');
          }
        });
      }

      // Enforce optimized Opus parameters for slow / unstable network resilience
      if (enableFEC) paramMap.set('useinbandfec', '1');
      if (enableDTX) paramMap.set('usedtx', '1');
      if (forceMono) {
        paramMap.set('stereo', '0');
        paramMap.set('sprop-stereo', '0');
      }
      paramMap.set('cbr', '0'); // Variable bitrate mode (higher clarity per byte)
      paramMap.set('maxaveragebitrate', String(maxAudioBitrate));
      if (!paramMap.has('minptime')) paramMap.set('minptime', '10');
      if (!paramMap.has('ptime')) paramMap.set('ptime', '20');

      const newParams = [];
      paramMap.forEach((val, key) => {
        if (val !== '') newParams.push(`${key}=${val}`);
        else newParams.push(key);
      });

      modifiedLines.push(`${prefix} ${newParams.join(';')}`);
    } else {
      modifiedLines.push(line);
    }
  }

  // If Opus pt was found but no fmtp line existed, inject one right after rtpmap
  if (opusPt && !fmtpFound) {
    const finalLines = [];
    for (const line of modifiedLines) {
      finalLines.push(line);
      if (line.match(new RegExp(`^a=rtpmap:${opusPt}\\s+opus/48000`, 'i'))) {
        const params = [
          'minptime=10',
          'ptime=20',
          enableFEC ? 'useinbandfec=1' : '',
          enableDTX ? 'usedtx=1' : '',
          `maxaveragebitrate=${maxAudioBitrate}`,
          'cbr=0',
          forceMono ? 'stereo=0;sprop-stereo=0' : ''
        ].filter(Boolean).join(';');
        finalLines.push(`a=fmtp:${opusPt} ${params}`);
      }
    }
    return finalLines.join('\r\n');
  }

  return modifiedLines.join('\r\n');
}

// ==========================================
// Diagnostic Logging & Reporting
// ==========================================
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
      qualityTier: currentQualityTier,
      isAudioFirstFallback: isAudioFirstFallbackActive,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      callType: isVideoCall ? 'Video' : 'Voice'
    },
    markCallFailed: Boolean(markCallFailed)
  };

  console.log(`[Diagnostic Report] [${severity.toUpperCase()}] ${eventType} (${stage}): ${errorMessage || errorName}`);

  if (socket && socket.connected) {
    socket.emit('call-issue-log', payload);
  }

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
  } catch (e) {}
}

// Socket Diagnostics
socket.on('connect', () => {
  console.log(`[Socket] Connected to signaling server. Socket ID: ${socket.id}, Call ID: ${currentCallId}`);
  if (currentCallId && (currentCallState === CallState.ACTIVE || currentCallState === CallState.CONNECTED)) {
    socket.emit('call-heartbeat', { callId: currentCallId });
  }
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
});

$(document).ready(function() {
  const isUserCaller = $("#call-screen-trigger").length > 0 || window.isCaller;
  const isAdminReceiver = $("#webrtc-admin-trigger").length > 0 || window.isAdminReceiver;

  if (!currentCallId) {
    console.warn("[WebRTC] No active call session found. Redirecting to dashboard...");
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
  localStorage.setItem('active_call_id', currentCallId);

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

  socket.on('connect', () => {
    if (currentCallId && !isTerminalState(currentCallState)) {
      emitJoinRoom();
    }
  });

  transitionTo(CallState.RINGING, { callId: currentCallId });
  $(".call-status-badge").removeClass("connected").addClass("connecting").html('<span class="status-indicator-dot connecting me-1"></span> Calling...');

  // Pre-warm microphone access while ringing
  getMicrophoneAccess().catch((e) => {
    console.log("[WebRTC Pre-warm] Mic access initial request:", e.name || e.message);
  });

  socket.off('call-placed').on('call-placed', () => {
    if (currentCallState === CallState.CONNECTED || currentCallState === CallState.ACTIVE) return;
    console.log("[Socket] Call placed on server. Ringing advisor...");
    $(".call-status-badge").removeClass("connected").addClass("connecting ringing").html('<span class="status-indicator-dot ringing me-1"></span> Ringing...');
  });

  socket.off('call-ringing').on('call-ringing', () => {
    if (currentCallState === CallState.CONNECTED || currentCallState === CallState.ACTIVE) return;
    console.log("[Socket] Phone is ringing on advisor device...");
    $(".call-status-badge").removeClass("connected").addClass("connecting ringing").html('<span class="status-indicator-dot ringing me-1"></span> Ringing...');
  });

  // 90s Ringing Timeout
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

  // When admin accepts call
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

    // 60s Handshake Timeout
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

    // Begin WebRTC negotiation
    await startCallNegotiation(true);
  });

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

  socket.off('call-accept-error').on('call-accept-error', (data) => {
    console.warn('[WebRTC] Call cannot be accepted:', data);
    if (connectingTimeoutTimer) clearTimeout(connectingTimeoutTimer);
    alert('This call was already cancelled by the user.');
    window.location.href = '/admin/calls';
  });

  socket.off('call-cancelled').on('call-cancelled', (data) => {
    if (data && (!data.callId || data.callId === currentCallId)) {
      console.warn('[WebRTC] Caller cancelled call during connection:', data);
      if (connectingTimeoutTimer) clearTimeout(connectingTimeoutTimer);
      alert('The caller has hung up.');
      window.location.href = '/admin/calls';
    }
  });

  // Listen for SDP Offer from caller (or ICE restart offer)
  socket.off('receive-offer').on('receive-offer', async (data) => {
    if (isTerminalState(currentCallState)) return;
    console.log(`[Socket] Received 'receive-offer' from peer. isIceRestart: ${Boolean(data.isIceRestart)}`);
    targetPeerId = data.senderId;

    try {
      const isExistingActiveCall = (currentCallState === CallState.ACTIVE || currentCallState === CallState.CONNECTED);
      if (!isExistingActiveCall) {
        transitionTo(CallState.CONNECTING, { targetPeerId });
      }

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

      // Add local media tracks if not already present
      const senders = peerConnection.getSenders();
      const hasTracks = senders.some(s => s.track);
      if (!hasTracks) {
        const stream = await getMicrophoneAccess();
        if (stream && peerConnection) {
          stream.getTracks().forEach(track => {
            try { peerConnection.addTrack(track, stream); } catch (e) {}
          });
        }
      }

      const answer = await peerConnection.createAnswer();
      const optimizedAnswerSdp = optimizeSDP(answer.sdp, {
        maxAudioBitrate: isAudioFirstFallbackActive ? 20000 : 32000,
        enableFEC: true,
        enableDTX: true
      });

      await peerConnection.setLocalDescription(new RTCSessionDescription({
        type: answer.type,
        sdp: optimizedAnswerSdp
      }));

      socket.emit('send-answer', {
        answer: peerConnection.localDescription,
        targetId: targetPeerId,
        callId: currentCallId,
        isIceRestart: Boolean(data.isIceRestart)
      });

      // Apply sender parameters
      applyAudioSenderOptimizations();
      if (isVideoCall) {
        applyVideoSenderOptimizations();
      }
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
      if (currentCallState !== CallState.ACTIVE) {
        terminateCallSession('Failed', {
          failureReason: 'Error during offer processing: ' + err.message,
          errorCode: 'SDP_ANSWER_ERROR',
          failedAtStage: 'offer_answer'
        });
      }
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
      const senders = peerConnection.getSenders();
      const hasTracks = senders.some(s => s.track);
      if (!hasTracks) {
        stream.getTracks().forEach(track => {
          try { peerConnection.addTrack(track, stream); } catch (e) {}
        });
      }
    }

    if (isInitiator && peerConnection) {
      const offer = await peerConnection.createOffer();
      const optimizedOfferSdp = optimizeSDP(offer.sdp, {
        maxAudioBitrate: 32000,
        enableFEC: true,
        enableDTX: true
      });

      await peerConnection.setLocalDescription(new RTCSessionDescription({
        type: offer.type,
        sdp: optimizedOfferSdp
      }));

      socket.emit('send-offer', {
        offer: peerConnection.localDescription,
        targetId: targetPeerId,
        callId: currentCallId,
        isIceRestart: false
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

  // Remote audio & video track reception with jitter buffering optimization
  peerConnection.ontrack = (event) => {
    console.log(`[WebRTC] Remote track arrived (${event.track ? event.track.kind : 'stream'}).`);
    let stream = (event.streams && event.streams[0]);
    if (!stream && event.track) {
      stream = new MediaStream([event.track]);
    }

    // Configure jitter buffer targets where supported
    if (peerConnection.getReceivers) {
      peerConnection.getReceivers().forEach(receiver => {
        if (receiver.track && receiver.track.kind === 'audio') {
          if ('playoutDelayHint' in receiver) {
            receiver.playoutDelayHint = 0.05; // 50ms low-latency jitter buffer target
          }
          if ('jitterBufferTarget' in receiver) {
            receiver.jitterBufferTarget = 50;
          }
        } else if (receiver.track && receiver.track.kind === 'video') {
          if ('playoutDelayHint' in receiver) {
            receiver.playoutDelayHint = 0.08; // 80ms lip-sync video jitter buffer target
          }
        }
      });
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

        applyAudioRouting(isVideoCall ? 'speaker' : 'earpiece');
      }
      const remoteVideo = document.getElementById('remoteVideo');
      if (remoteVideo) {
        remoteVideo.srcObject = stream;
        remoteVideo.play().catch(e => console.warn('[WebRTC] Auto-play video warning:', e));
      }
    }
  };

  // Idempotent Connected State Handler
  const handleConnectedState = () => {
    if (currentCallState === CallState.CONNECTED || currentCallState === CallState.ACTIVE) {
      // Re-connected after transient reconnect or ICE restart
      console.log("[WebRTC] Call connection re-verified / re-established.");
      if (iceDisconnectGraceTimer) {
        clearTimeout(iceDisconnectGraceTimer);
        iceDisconnectGraceTimer = null;
      }
      isRestartingIce = false;
      return;
    }

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
      .removeClass("connecting ringing")
      .addClass("connected")
      .html('<span class="status-indicator-dot online me-1"></span> Connected');
    $(".call-meta-info p").text("Live 1-on-1 Audio Consultation");
    $(".call-pulse-animation, .call-pulse-animation-2").css("animation-duration", "1.5s");
    $("#call-cancel-btn-wrapper, #call-cancel-btn").addClass("d-none");
    $("#call-active-controls").removeClass("d-none");

    // Reveal Network Quality Pill
    $("#call-network-badge, #videoNetworkPill").removeClass("d-none");

    socket.emit('call-connected', { callId: currentCallId });

    startActiveCallTimer();
    startNetworkMonitoring();
    startCallHeartbeat();

    applyAudioSenderOptimizations();
    if (isVideoCall) {
      applyVideoSenderOptimizations();
    }
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
      console.warn("[WebRTC] Peer connection failed. Triggering seamless ICE restart...");
      triggerIceRestart();
    } else if (connState === 'disconnected') {
      console.warn("[WebRTC] Peer connection temporarily disconnected. Awaiting ICE recovery...");
      if (!iceDisconnectGraceTimer && !isRestartingIce) {
        iceDisconnectGraceTimer = setTimeout(() => {
          iceDisconnectGraceTimer = null;
          if (peerConnection && (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed')) {
            triggerIceRestart();
          }
        }, 4000);
      }
    }
  };

  // ICE connection state changes
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
      if (iceDisconnectGraceTimer) {
        clearTimeout(iceDisconnectGraceTimer);
        iceDisconnectGraceTimer = null;
      }
      isRestartingIce = false;
      handleConnectedState();
    } else if (iceState === 'disconnected') {
      console.warn("[WebRTC] ICE disconnected. Waiting 4s before seamless restart...");
      if (!iceDisconnectGraceTimer && !isRestartingIce && !isTerminalState(currentCallState)) {
        iceDisconnectGraceTimer = setTimeout(() => {
          iceDisconnectGraceTimer = null;
          if (peerConnection && (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed')) {
            triggerIceRestart();
          }
        }, 4000);
      }
    } else if (iceState === 'failed') {
      console.warn("[WebRTC] ICE failed. Immediately executing ICE restart...");
      triggerIceRestart();
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

// Seamless ICE Restart & Renegotiation without call termination
async function triggerIceRestart() {
  if (isRestartingIce || isTerminalState(currentCallState) || !peerConnection) return;
  isRestartingIce = true;
  console.log("[WebRTC] Initiating seamless ICE Restart...");

  reportCallIssue({
    eventType: 'ICE_RESTART_TRIGGERED',
    severity: 'warn',
    stage: 'ice_negotiation',
    errorMessage: 'Executing seamless ICE restart negotiation'
  });

  try {
    if (typeof peerConnection.restartIce === 'function') {
      peerConnection.restartIce();
    }
    const offer = await peerConnection.createOffer({ iceRestart: true });
    const optimizedOfferSdp = optimizeSDP(offer.sdp, {
      maxAudioBitrate: isAudioFirstFallbackActive ? 20000 : 32000,
      enableFEC: true,
      enableDTX: true
    });

    await peerConnection.setLocalDescription(new RTCSessionDescription({
      type: offer.type,
      sdp: optimizedOfferSdp
    }));

    socket.emit('send-offer', {
      offer: peerConnection.localDescription,
      targetId: targetPeerId,
      callId: currentCallId,
      isIceRestart: true
    });
  } catch (err) {
    console.error("[WebRTC] ICE restart offer creation failed:", err);
    isRestartingIce = false;
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

      applyAudioSenderOptimizations();
      if (isVideoCall) {
        applyVideoSenderOptimizations();
      }
      isRestartingIce = false;
    }
  } catch (err) {
    console.error("[WebRTC Error] Failed to set Remote Description (Answer):", err);
    isRestartingIce = false;
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

// Periodic signaling heartbeat for active calls
function startCallHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (socket && socket.connected && currentCallId && !isTerminalState(currentCallState)) {
      socket.emit('call-heartbeat', { callId: currentCallId, socketId: socket.id });
    }
  }, 10000);
}

// ==========================================
// Hardware Media Access & Audio Constraints
// ==========================================
async function getMicrophoneAccess() {
  if (localStream) return localStream;

  // Optimized VoIP telephony constraints
  const telephonyAudioConstraints = {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 16 },
    // Vendor specific flags for Chromium/Edge
    googEchoCancellation: { ideal: true },
    googAutoGainControl: { ideal: true },
    googNoiseSuppression: { ideal: true },
    googHighpassFilter: { ideal: true },
    googTypingNoiseDetection: { ideal: true }
  };

  // 1. If Video Call, request both audio and optimized video stream
  if (isVideoCall) {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: telephonyAudioConstraints,
          video: {
            facingMode: 'user',
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            frameRate: { ideal: 24, max: 30 }
          }
        });
        console.log("[WebRTC] Video and microphone access granted.");

        // Mark speech and motion contentHints
        localStream.getTracks().forEach(t => {
          if (t.kind === 'audio' && 'contentHint' in t) t.contentHint = 'speech';
          if (t.kind === 'video' && 'contentHint' in t) t.contentHint = 'motion';
        });

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

  // 2. Audio-only media request (VoIP / Telephony mode)
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: telephonyAudioConstraints
      });
      console.log("[WebRTC] Microphone access granted with VoIP telephony constraints.");

      localStream.getAudioTracks().forEach(t => {
        if ('contentHint' in t) t.contentHint = 'speech';
      });

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

  // Automated test mock fallback
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
// 4. RTCRtpSender Encoding Optimizations
// ==========================================
async function applyAudioSenderOptimizations() {
  if (!peerConnection) return;
  const audioSender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
  if (audioSender && audioSender.getParameters && audioSender.setParameters) {
    try {
      const params = audioSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].priority = 'high';
      params.encodings[0].networkPriority = 'high';
      params.encodings[0].maxBitrate = isAudioFirstFallbackActive ? 20000 : 32000;
      await audioSender.setParameters(params);
      console.log("[WebRTC Sender] Audio sender prioritized (priority: high, maxBitrate:", params.encodings[0].maxBitrate, ")");
    } catch (e) {
      console.warn("[WebRTC Sender] Audio sender optimization note:", e.message);
    }
  }
}

async function applyVideoSenderOptimizations() {
  if (!peerConnection) return;
  const videoSender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
  if (videoSender && videoSender.getParameters && videoSender.setParameters) {
    try {
      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      if ('degradationPreference' in videoSender) {
        // Prevent video freeze on weak connections by scaling down resolution first
        videoSender.degradationPreference = 'maintain-framerate';
      }
      params.encodings[0].priority = 'medium';
      params.encodings[0].networkPriority = 'medium';
      params.encodings[0].maxBitrate = 900000;
      params.encodings[0].maxFramerate = 24;
      params.encodings[0].scaleResolutionDownBy = 1.0;
      await videoSender.setParameters(params);
      console.log("[WebRTC Sender] Video sender tuned (degradationPreference: maintain-framerate, maxBitrate: 900kbps)");
    } catch (e) {
      console.warn("[WebRTC Sender] Video sender optimization note:", e.message);
    }
  }
}

// ==========================================
// 5. Network Quality Monitor & Adaptive Bitrate Engine
// ==========================================
class NetworkQualityMonitor {
  constructor({ peerConnection, onQualityChange, onStatsUpdate, intervalMs = 2000 }) {
    this.pc = peerConnection;
    this.onQualityChange = onQualityChange;
    this.onStatsUpdate = onStatsUpdate;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.prevStats = null;
    this.currentQuality = 'EXCELLENT';
    this.consecutiveDegraded = 0;
    this.consecutiveImproved = 0;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.collectStats(), this.intervalMs);
    console.log("[NetworkMonitor] Real-time network statistics monitoring started.");
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.prevStats = null;
    console.log("[NetworkMonitor] Monitoring stopped.");
  }

  async collectStats() {
    if (!this.pc || this.pc.connectionState === 'closed') return;
    try {
      const reportMap = await this.pc.getStats();
      let rtt = 0;
      let availableOutgoingBitrate = 0;
      let audioJitter = 0;
      let currentPacketsReceived = 0;
      let currentPacketsLost = 0;
      let videoFramesDropped = 0;
      let videoFps = 0;
      let totalBytesSent = 0;

      reportMap.forEach(report => {
        // 1. Candidate Pair (Round Trip Time & Bandwidth Estimation)
        if (report.type === 'candidate-pair' && (report.selected || report.state === 'succeeded' || report.nominated)) {
          if (typeof report.currentRoundTripTime === 'number') {
            rtt = Math.round(report.currentRoundTripTime * 1000);
          } else if (typeof report.roundTripTime === 'number') {
            rtt = Math.round(report.roundTripTime * 1000);
          }
          if (typeof report.availableOutgoingBitrate === 'number') {
            availableOutgoingBitrate = Math.round(report.availableOutgoingBitrate / 1000);
          }
        }

        // 2. Inbound Audio RTP (Loss & Jitter)
        if (report.type === 'inbound-rtp' && (report.kind === 'audio' || report.mediaType === 'audio')) {
          currentPacketsReceived += report.packetsReceived || 0;
          currentPacketsLost += report.packetsLost || 0;
          if (typeof report.jitter === 'number') {
            audioJitter = Math.round(report.jitter * 1000);
          }
        }

        // 3. Inbound Video RTP
        if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
          currentPacketsReceived += report.packetsReceived || 0;
          currentPacketsLost += report.packetsLost || 0;
          if (typeof report.framesDropped === 'number') {
            videoFramesDropped = report.framesDropped;
          }
          if (typeof report.framesPerSecond === 'number') {
            videoFps = Math.round(report.framesPerSecond);
          }
        }

        // 4. Outbound RTP (Transmission Bitrate)
        if (report.type === 'outbound-rtp') {
          totalBytesSent += report.bytesSent || 0;
        }
      });

      // Compute Rolling Delta Packet Loss %
      let deltaLossRate = 0;
      let bitrateSentKbps = 0;
      const now = Date.now();

      if (this.prevStats) {
        const deltaReceived = Math.max(0, currentPacketsReceived - this.prevStats.packetsReceived);
        const deltaLost = Math.max(0, currentPacketsLost - this.prevStats.packetsLost);
        const totalDelta = deltaReceived + deltaLost;
        if (totalDelta > 0) {
          deltaLossRate = parseFloat(((deltaLost / totalDelta) * 100).toFixed(1));
        }

        const elapsedSec = (now - this.prevStats.timestamp) / 1000;
        if (elapsedSec > 0) {
          const deltaBytesSent = Math.max(0, totalBytesSent - this.prevStats.bytesSent);
          bitrateSentKbps = Math.round((deltaBytesSent * 8) / (elapsedSec * 1000));
        }
      }

      this.prevStats = {
        packetsReceived: currentPacketsReceived,
        packetsLost: currentPacketsLost,
        bytesSent: totalBytesSent,
        timestamp: now
      };

      // Quality Classification
      let evaluatedTier = 'EXCELLENT';
      if (rtt >= 400 || deltaLossRate >= 15 || audioJitter >= 100 || (availableOutgoingBitrate > 0 && availableOutgoingBitrate < 150)) {
        evaluatedTier = 'CRITICAL';
      } else if (rtt >= 220 || deltaLossRate >= 6 || audioJitter >= 60 || (availableOutgoingBitrate > 0 && availableOutgoingBitrate < 350)) {
        evaluatedTier = 'POOR';
      } else if (rtt >= 100 || deltaLossRate >= 2 || audioJitter >= 35 || (availableOutgoingBitrate > 0 && availableOutgoingBitrate < 700)) {
        evaluatedTier = 'GOOD';
      } else {
        evaluatedTier = 'EXCELLENT';
      }

      // Hysteresis Filter (Downscale fast to protect calls, Upscale gradually after verification)
      const tierRank = { 'EXCELLENT': 4, 'GOOD': 3, 'POOR': 2, 'CRITICAL': 1 };
      const currentRank = tierRank[this.currentQuality];
      const evalRank = tierRank[evaluatedTier];

      let changed = false;
      if (evalRank < currentRank) {
        this.consecutiveDegraded++;
        this.consecutiveImproved = 0;
        if (this.consecutiveDegraded >= 1) {
          this.currentQuality = evaluatedTier;
          changed = true;
        }
      } else if (evalRank > currentRank) {
        this.consecutiveImproved++;
        this.consecutiveDegraded = 0;
        if (this.consecutiveImproved >= 3) {
          this.currentQuality = evaluatedTier;
          changed = true;
        }
      } else {
        this.consecutiveDegraded = 0;
        this.consecutiveImproved = 0;
      }

      const statsPayload = {
        quality: this.currentQuality,
        rtt,
        packetLoss: deltaLossRate,
        jitter: audioJitter,
        availableBandwidth: availableOutgoingBitrate,
        bitrateSent: bitrateSentKbps,
        videoFps
      };

      if (changed && typeof this.onQualityChange === 'function') {
        this.onQualityChange(this.currentQuality, statsPayload);
      }
      if (typeof this.onStatsUpdate === 'function') {
        this.onStatsUpdate(statsPayload);
      }
    } catch (statsErr) {
      console.warn("[NetworkMonitor] getStats error:", statsErr);
    }
  }
}

function startNetworkMonitoring() {
  if (networkMonitor) {
    networkMonitor.stop();
  }
  networkMonitor = new NetworkQualityMonitor({
    peerConnection,
    onQualityChange: (quality, stats) => {
      console.log(`[NetworkMonitor] Quality transitioned to: ${quality}`, stats);
      currentQualityTier = quality;
      applyAdaptiveQuality(quality, stats);
    },
    onStatsUpdate: (stats) => {
      updateNetworkQualityUI(currentQualityTier, stats);
    }
  });
  networkMonitor.start();
}

function stopNetworkMonitoring() {
  if (networkMonitor) {
    networkMonitor.stop();
    networkMonitor = null;
  }
}

// Adaptive Bitrate Controller: adjusts video resolution/fps and prioritizes audio
async function applyAdaptiveQuality(quality, stats) {
  if (!peerConnection) return;

  const audioSender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
  const videoSender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');

  // 1. Audio Sender Adaptation
  if (audioSender && audioSender.getParameters && audioSender.setParameters) {
    try {
      const audioParams = audioSender.getParameters();
      if (!audioParams.encodings || audioParams.encodings.length === 0) {
        audioParams.encodings = [{}];
      }
      audioParams.encodings[0].priority = 'high';
      audioParams.encodings[0].networkPriority = 'high';

      if (quality === 'CRITICAL') {
        audioParams.encodings[0].maxBitrate = 20000;
      } else if (quality === 'POOR') {
        audioParams.encodings[0].maxBitrate = 24000;
      } else if (quality === 'GOOD') {
        audioParams.encodings[0].maxBitrate = 32000;
      } else {
        audioParams.encodings[0].maxBitrate = 36000;
      }
      await audioSender.setParameters(audioParams);
    } catch (e) {
      console.warn("[ABR Controller] Audio sender update warning:", e.message);
    }
  }

  // 2. Video Sender Adaptation (Dynamic Bitrate, Resolution Scaling & Framerate)
  if (videoSender && videoSender.getParameters && videoSender.setParameters) {
    try {
      const videoParams = videoSender.getParameters();
      if (!videoParams.encodings || videoParams.encodings.length === 0) {
        videoParams.encodings = [{}];
      }
      if ('degradationPreference' in videoSender) {
        videoSender.degradationPreference = 'maintain-framerate';
      }

      const enc = videoParams.encodings[0];
      enc.priority = (quality === 'CRITICAL' || quality === 'POOR') ? 'low' : 'medium';
      enc.networkPriority = (quality === 'CRITICAL' || quality === 'POOR') ? 'low' : 'medium';

      if (quality === 'EXCELLENT') {
        enc.scaleResolutionDownBy = 1.0;
        enc.maxFramerate = 30;
        enc.maxBitrate = 1200000;
        enc.active = true;
        setVideoFallbackMode(false);
      } else if (quality === 'GOOD') {
        enc.scaleResolutionDownBy = 1.5;
        enc.maxFramerate = 24;
        enc.maxBitrate = 600000;
        enc.active = true;
        setVideoFallbackMode(false);
      } else if (quality === 'POOR') {
        enc.scaleResolutionDownBy = 2.5;
        enc.maxFramerate = 15;
        enc.maxBitrate = 200000;
        enc.active = true;
        setVideoFallbackMode(false);
      } else if (quality === 'CRITICAL') {
        // Under weak / constrained network: ALWAYS keep video call active (never switch to audio call)
        // Dynamically scale down resolution and framerate to maintain continuous video stream without dropping
        enc.scaleResolutionDownBy = 3.5;
        enc.maxFramerate = 15;
        enc.maxBitrate = 95000;
        enc.active = true; // Video stream strictly active at all times
        setVideoFallbackMode(true, "Weak network: Video quality adjusted to maintain stability");
      }

      await videoSender.setParameters(videoParams);
      console.log(`[ABR Controller] Video sender updated for tier ${quality} (scale: ${enc.scaleResolutionDownBy}, maxFps: ${enc.maxFramerate}, maxBitrate: ${enc.maxBitrate})`);
    } catch (e) {
      console.warn("[ABR Controller] Video sender update warning:", e.message);
    }
  }

  updateNetworkQualityUI(quality, stats);
}

// Adaptive Video Quality Notice Handler (Never turns off video or switches to audio)
function setVideoFallbackMode(active, message = "Weak network: Video quality adjusted") {
  if (isAudioFirstFallbackActive === active) return;
  isAudioFirstFallbackActive = active;

  console.log(`[ABR Video] Adaptive video quality notice ${active ? 'ACTIVATED' : 'DEACTIVATED'}: ${message}`);

  const $banner = $("#videoFallbackBanner");

  if (active) {
    if ($banner.length) {
      $banner.removeClass("d-none restored").find("#videoFallbackText").text(message);
    }
  } else {
    if ($banner.length && !$banner.hasClass("d-none")) {
      $banner.addClass("restored").find("#videoFallbackText").text("Connection restored — Full video quality resumed");
      setTimeout(() => {
        $banner.addClass("d-none").removeClass("restored");
      }, 3500);
    }
  }
}

// Update Real-Time UI Badges & Indicators
function updateNetworkQualityUI(quality, stats = {}) {
  const $callBadge = $("#call-network-badge");
  const $videoPill = $("#videoNetworkPill");
  const $adminQualityText = $("#adminStreamQualityText");
  const $adminIcon = $("#adminStreamIcon");

  let qualityClass = 'quality-excellent';
  let iconClass = 'bi-reception-4';
  let audioLabel = 'HD Voice';
  let videoLabel = 'HD';

  if (quality === 'GOOD') {
    qualityClass = 'quality-good';
    iconClass = 'bi-reception-3';
    audioLabel = 'Good Voice';
    videoLabel = 'SD';
  } else if (quality === 'POOR') {
    qualityClass = 'quality-poor';
    iconClass = 'bi-reception-2';
    audioLabel = 'Weak Signal';
    videoLabel = 'Low Bandwidth';
  } else if (quality === 'CRITICAL') {
    qualityClass = 'quality-critical';
    iconClass = 'bi-reception-1';
    audioLabel = 'Voice Priority';
    videoLabel = 'Low';
  }

  // 1. Audio Call Screen Badge
  if ($callBadge.length) {
    $callBadge
      .removeClass("quality-excellent quality-good quality-poor quality-critical d-none")
      .addClass(qualityClass);
    $callBadge.find("#call-network-icon").attr("class", `bi ${iconClass} me-1`);
    $callBadge.find("#call-network-label").text(audioLabel);
    $callBadge.attr("title", `RTT: ${stats.rtt || 0}ms | Loss: ${stats.packetLoss || 0}% | Jitter: ${stats.jitter || 0}ms`);
  }

  // 2. Video Call Screen Floating Pill
  if ($videoPill.length) {
    $videoPill
      .removeClass("quality-excellent quality-good quality-poor quality-critical d-none")
      .addClass(qualityClass);
    $videoPill.find("#videoNetworkIcon").attr("class", `bi ${iconClass}`);
    $videoPill.find("#videoNetworkLabel").text(videoLabel);
  }

  // 3. Admin Call Console Stream Quality Display
  if ($adminQualityText.length) {
    let adminDesc = "HD Ultra Low Latency";
    if (quality === 'GOOD') adminDesc = `Good (${stats.rtt || 0}ms)`;
    if (quality === 'POOR') adminDesc = `Weak Network (Loss: ${stats.packetLoss || 0}%)`;
    if (quality === 'CRITICAL') adminDesc = "Prioritizing Voice (Critical Bandwidth)";
    $adminQualityText.text(adminDesc);

    if ($adminIcon.length) {
      if (quality === 'CRITICAL') $adminIcon.attr("class", "bi bi-broadcast text-danger");
      else if (quality === 'POOR') $adminIcon.attr("class", "bi bi-broadcast text-warning");
      else $adminIcon.attr("class", "bi bi-broadcast text-success");
    }
  }
}

// ==========================================
// 6. Visual Call Timer & Client-side Balance Tracker
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
  if (isVideoCall) return;
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
// 7. Termination & Cleanup Handlers (Idempotent)
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

  $("#call-end-btn, #call-cancel-btn").prop('disabled', true);
  if ($("#call-cancel-btn").is(":visible")) {
    $("#call-cancel-btn").text('Cancelling...');
  }
  $("#call-end-btn").html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>');

  stopNetworkMonitoring();

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
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (iceDisconnectGraceTimer) {
    clearTimeout(iceDisconnectGraceTimer);
    iceDisconnectGraceTimer = null;
  }

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

  if (peerConnection) {
    try {
      peerConnection.close();
    } catch (e) {
      console.warn('[WebRTC] PeerConnection close warning:', e);
    }
    peerConnection = null;
  }
  webIceQueue = [];

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

// ==========================================
// Audio Output Routing (Earpiece vs Loudspeaker)
// ==========================================
let currentAudioRoute = isVideoCall ? 'speaker' : 'earpiece';
let activeAudioRoutingCtx = null;

async function applyAudioRouting(targetMode) {
  currentAudioRoute = targetMode;
  const remoteAudio = document.getElementById('remoteAudio');
  console.log(`[Audio Routing] Applying route: ${targetMode} (isVideoCall: ${isVideoCall})`);

  if (remoteAudio && typeof remoteAudio.setSinkId === 'function') {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputDevices = devices.filter(d => d.kind === 'audiooutput');

      let chosenDeviceId = '';
      if (targetMode === 'earpiece') {
        const earpiece = outputDevices.find(d => /earpiece|receiver|phone|handset|internal/i.test(d.label));
        chosenDeviceId = earpiece ? earpiece.deviceId : 'default';
      } else {
        const speaker = outputDevices.find(d => /speaker|loudspeaker|speakerphone|external/i.test(d.label));
        if (speaker) {
          chosenDeviceId = speaker.deviceId;
        } else if (outputDevices.length > 1) {
          const nonDefault = outputDevices.find(d => d.deviceId !== 'default');
          chosenDeviceId = nonDefault ? nonDefault.deviceId : 'default';
        } else {
          chosenDeviceId = 'default';
        }
      }

      if (chosenDeviceId) {
        await remoteAudio.setSinkId(chosenDeviceId);
        console.log(`[Audio Routing] remoteAudio.setSinkId set to '${chosenDeviceId}' for mode '${targetMode}'`);
      }
    } catch (sinkErr) {
      console.warn("[Audio Routing] setSinkId notice:", sinkErr.name || sinkErr.message);
    }
  }

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass && remoteAudio && remoteAudio.srcObject) {
      if (!activeAudioRoutingCtx || activeAudioRoutingCtx.state === 'closed') {
        activeAudioRoutingCtx = new AudioContextClass({ latencyHint: 'interactive' });
      }
      if (activeAudioRoutingCtx.state === 'suspended') {
        activeAudioRoutingCtx.resume().catch(() => {});
      }
      if (typeof activeAudioRoutingCtx.setSinkId === 'function') {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter(d => d.kind === 'audiooutput');
        const target = (targetMode === 'earpiece')
          ? outputs.find(d => /earpiece|receiver|phone|handset|internal/i.test(d.label))
          : outputs.find(d => /speaker|loudspeaker|speakerphone/i.test(d.label));
        const sinkId = target ? target.deviceId : 'default';
        await activeAudioRoutingCtx.setSinkId(sinkId);
      }
    }
  } catch (ctxErr) {}

  updateSpeakerButtonUI(targetMode);
}

async function toggleRemoteSpeaker() {
  const nextMode = (currentAudioRoute === 'earpiece') ? 'speaker' : 'earpiece';

  if (typeof navigator.mediaDevices !== 'undefined' && typeof navigator.mediaDevices.selectAudioOutput === 'function') {
    try {
      const selected = await navigator.mediaDevices.selectAudioOutput();
      if (selected && selected.deviceId) {
        const remoteAudio = document.getElementById('remoteAudio');
        if (remoteAudio && typeof remoteAudio.setSinkId === 'function') {
          await remoteAudio.setSinkId(selected.deviceId);
          const isSpk = /speaker|loudspeaker/i.test(selected.label);
          currentAudioRoute = isSpk ? 'speaker' : 'earpiece';
          updateSpeakerButtonUI(currentAudioRoute);
          return;
        }
      }
    } catch (e) {}
  }

  await applyAudioRouting(nextMode);
}

function updateSpeakerButtonUI(mode) {
  const $btn = $("#speaker-toggle-btn");
  if (!$btn.length) return;

  if (mode === 'speaker') {
    $btn.addClass("active");
    $btn.find("i").removeClass("bi-telephone-fill bi-ear-fill").addClass("bi-volume-up-fill");
    $btn.find("small").text("Speaker");
    $btn.attr("title", "Speakerphone Active (Tap to switch to Earpiece)");
  } else {
    $btn.removeClass("active");
    $btn.find("i").removeClass("bi-volume-up-fill").addClass("bi-telephone-fill");
    $btn.find("small").text("Earpiece");
    $btn.attr("title", "Earpiece Active (Tap to switch to Speakerphone)");
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
