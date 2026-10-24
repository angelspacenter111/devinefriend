/*
 * WebRTC Voice & Video Calling Companion Engine
 * DevineFriend Platform - Powered by Cloudflare Realtime SFU
 * Features:
 *  - Cloudflare Realtime SFU Anycast Edge Media Pipeline
 *  - Automatic Seamless Fallback to P2P Mesh with TURNS on Port 443
 *  - Adaptive Bitrate Controller (ABR) & Dynamic Video Scaling (Resolution & Framerate)
 *  - Video Stream Continuity (Never switches video call to audio-only)
 *  - Opus In-band FEC (Forward Error Correction) & DTX for Packet Loss Recovery
 *  - Real-time Network Quality Monitor (RTT, Jitter, Packet Loss, BWE)
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

// STUN & TURNS configuration (Cloudflare Anycast STUN + High-priority TLS TURNS relays)
const defaultIceServers = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: [
      'turns:global.relay.metered.ca:443?transport=tcp',
      'turns:global.relay.metered.ca:443',
      'turn:global.relay.metered.ca:443?transport=tcp',
      'turn:global.relay.metered.ca:443'
    ],
    username: 'openrelay',
    credential: 'openrelay'
  }
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
let peerConnection = null; // Bound to publisher or mesh connection
let pubPeerConnection = null;
let subPeerConnection = null;
let targetPeerId = null;
let webIceQueue = [];

// Cloudflare Realtime SFU Session tracking
let isUsingSfu = false;
let cfPublisherSessionId = null;
let cfSubscriberSessionId = null;
let subscribedRemoteSessions = new Set();

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

// Helper to wait for ICE candidate gathering completion
function waitForIceGathering(pc, timeoutMs = 1800) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      return resolve();
    }
    let timer = null;
    const checkState = () => {
      if (pc.iceGatheringState === 'complete') {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', checkState);
    };
    pc.addEventListener('icegatheringstatechange', checkState);
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
  });
}

// Fetch API wrappers for secure backend proxy
async function apiPost(endpoint, data = {}) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const err = new Error(errorBody.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.details = errorBody;
    throw err;
  }
  return await res.json();
}

async function apiPut(endpoint, data = {}) {
  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const err = new Error(errorBody.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.details = errorBody;
    throw err;
  }
  return await res.json();
}

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

      if (enableFEC) paramMap.set('useinbandfec', '1');
      if (enableDTX) paramMap.set('usedtx', '1');
      if (forceMono) {
        paramMap.set('stereo', '0');
        paramMap.set('sprop-stereo', '0');
      }
      paramMap.set('cbr', '0');
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
      isUsingSfu: isUsingSfu,
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
          errorMessage: 'WebRTC connection timed out after 60s handshake delay',
          markCallFailed: true
        });
        alert("Audio/Video connection timed out. Please check your network and try again.");
        terminateCallSession('Failed', {
          failureReason: 'Connection timed out after 60s without handshake completion',
          errorCode: 'HANDSHAKE_TIMEOUT',
          failedAtStage: 'handshake'
        });
      }
    }, 60000);

    // Try Cloudflare Realtime SFU first, fallback to P2P mesh
    const sfuSuccess = await startCloudflareSFUFlow(true);
    if (!sfuSuccess) {
      console.log("[WebRTC] Initializing P2P Mesh negotiation fallback...");
      await startCallNegotiation(true);
    }
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

  // Listen for Cloudflare SFU remote track announcements
  
  // Coordinated fallback from SFU to P2P mesh
  socket.off('switch-to-p2p').on('switch-to-p2p', (data) => {
    if (data && data.callId && data.callId !== currentCallId) return;
    console.log("[WebRTC] Received switch-to-p2p signal from peer. Switching to P2P Mesh...");
    isUsingSfu = false;
    if (audioWatchdogTimer) { clearTimeout(audioWatchdogTimer); audioWatchdogTimer = null; }
    if (pubPeerConnection) { try { pubPeerConnection.close(); } catch (e) {} pubPeerConnection = null; }
    if (subPeerConnection) { try { subPeerConnection.close(); } catch (e) {} subPeerConnection = null; }
  });

  socket.off('cf-sfu-remote-tracks-available').on('cf-sfu-remote-tracks-available', async (data) => {
    console.log("[WebRTC SFU] Received remote tracks announcement:", data);
    await subscribeToRemoteSFUTracks(data.publisherSessionId, data.tracks);
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

  // Start SFU publisher on admin side
  startCloudflareSFUFlow(false).catch((e) => {
    console.log("[WebRTC Admin SFU] SFU publish pre-init:", e.message);
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

  // Listen for Cloudflare SFU remote track announcements
  socket.off('cf-sfu-remote-tracks-available').on('cf-sfu-remote-tracks-available', async (data) => {
    console.log("[WebRTC SFU Admin] Received remote tracks announcement:", data);
    await subscribeToRemoteSFUTracks(data.publisherSessionId, data.tracks);
  });

  // P2P Offer/Answer fallback listeners
  socket.off('receive-offer').on('receive-offer', async (data) => {
    if (isTerminalState(currentCallState)) return;
    if (isUsingSfu) {
      console.log("[WebRTC] Received P2P offer while in SFU mode. Demoting to P2P Mesh.");
      isUsingSfu = false;
      if (pubPeerConnection) { try { pubPeerConnection.close(); } catch (e) {} pubPeerConnection = null; }
      if (subPeerConnection) { try { subPeerConnection.close(); } catch (e) {} subPeerConnection = null; }
    }
    console.log(`[Socket P2P] Received 'receive-offer' from peer. isIceRestart: ${Boolean(data.isIceRestart)}`);
    targetPeerId = data.senderId;

    try {
      const isExistingActiveCall = (currentCallState === CallState.ACTIVE || currentCallState === CallState.CONNECTED);
      if (!isExistingActiveCall) {
        transitionTo(CallState.CONNECTING, { targetPeerId });
      }

      await setupPeerConnection();
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

      if (webIceQueue.length > 0) {
        for (const cand of webIceQueue) {
          try { await peerConnection.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) {}
        }
        webIceQueue = [];
      }

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
        maxAudioBitrate: 32000,
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

      applyAudioSenderOptimizations();
      if (isVideoCall) {
        applyVideoSenderOptimizations();
      }
    } catch (err) {
      console.error("[WebRTC P2P Error] Offer processing failed:", err);
    }
  });
}

// ==========================================
// ==========================================
// Robust Audio Playback & Auto-Unlock Engine
// ==========================================
let audioUnlocked = false;

function setupOneTouchAudioUnlock() {
  if (audioUnlocked) return;

  const unlockAudio = () => {
    audioUnlocked = true;
    const remoteAudio = document.getElementById('remoteAudio');
    const remoteVideo = document.getElementById('remoteVideo');

    if (remoteAudio) {
      remoteAudio.muted = false;
      remoteAudio.volume = 1.0;
      remoteAudio.play().catch(() => {});
    }
    if (remoteVideo) {
      remoteVideo.play().catch(() => {});
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (!activeAudioRoutingCtx || activeAudioRoutingCtx.state === 'closed') {
          activeAudioRoutingCtx = new AudioCtx();
        }
        if (activeAudioRoutingCtx.state === 'suspended') {
          activeAudioRoutingCtx.resume().catch(() => {});
        }
      }
    } catch (e) {}

    console.log("[WebRTC Audio] User interaction detected: Audio pipeline unlocked.");
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
    window.removeEventListener('touchend', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };

  window.addEventListener('click', unlockAudio, { once: true, passive: true });
  window.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
  window.addEventListener('touchend', unlockAudio, { once: true, passive: true });
  window.addEventListener('keydown', unlockAudio, { once: true, passive: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupOneTouchAudioUnlock);
  } else {
    setupOneTouchAudioUnlock();
  }
}

function attachRemoteAudioTrack(track) {
  const remoteAudio = document.getElementById('remoteAudio');
  if (!remoteAudio || !track || track.kind !== 'audio') return;

  console.log(`[WebRTC Audio] Attaching remote audio track: id=${track.id}, readyState=${track.readyState}`);

  let audioStream = remoteAudio.srcObject;
  if (!audioStream || !(audioStream instanceof MediaStream)) {
    audioStream = new MediaStream();
    remoteAudio.srcObject = audioStream;
  }

  // Remove stale audio tracks and add this active one
  audioStream.getAudioTracks().forEach(t => {
    if (t.id !== track.id) {
      try { audioStream.removeTrack(t); } catch (e) {}
    }
  });

  if (!audioStream.getAudioTracks().some(t => t.id === track.id)) {
    try { audioStream.addTrack(track); } catch (e) {}
  }

  remoteAudio.muted = false;
  remoteAudio.volume = 1.0;

  const playPromise = remoteAudio.play();
  if (playPromise !== undefined) {
    playPromise.then(() => {
      console.log("[WebRTC Audio] Remote audio playback active!");
    }).catch(err => {
      console.warn("[WebRTC Audio] Autoplay deferred until interaction:", err.message);
      setupOneTouchAudioUnlock();
    });
  }

  // Dual-path: also attach audio to remoteVideo for redundancy
  const remoteVideo = document.getElementById('remoteVideo');
  if (remoteVideo) {
    let videoStream = remoteVideo.srcObject;
    if (videoStream && videoStream instanceof MediaStream) {
      if (!videoStream.getAudioTracks().some(t => t.id === track.id)) {
        try { videoStream.addTrack(track); } catch (e) {}
      }
    }
  }

  if (audioWatchdogTimer) {
    clearTimeout(audioWatchdogTimer);
    audioWatchdogTimer = null;
  }
}

function attachRemoteVideoTrack(track) {
  const remoteVideo = document.getElementById('remoteVideo');
  if (!remoteVideo || !track || track.kind !== 'video') return;

  console.log(`[WebRTC Video] Attaching remote video track: id=${track.id}, readyState=${track.readyState}`);

  let videoStream = remoteVideo.srcObject;
  if (!videoStream || !(videoStream instanceof MediaStream)) {
    videoStream = new MediaStream();
    remoteVideo.srcObject = videoStream;
  }

  // Replace old video tracks
  videoStream.getVideoTracks().forEach(t => {
    if (t.id !== track.id) {
      try { videoStream.removeTrack(t); } catch (e) {}
    }
  });

  if (!videoStream.getVideoTracks().some(t => t.id === track.id)) {
    try { videoStream.addTrack(track); } catch (e) {}
  }

  // Preserve remote audio in videoStream if available
  const remoteAudio = document.getElementById('remoteAudio');
  if (remoteAudio && remoteAudio.srcObject && (remoteAudio.srcObject instanceof MediaStream)) {
    const audioTracks = remoteAudio.srcObject.getAudioTracks();
    if (audioTracks.length > 0 && !videoStream.getAudioTracks().some(t => t.id === audioTracks[0].id)) {
      try { videoStream.addTrack(audioTracks[0]); } catch (e) {}
    }
  }

  remoteVideo.play().catch(e => console.warn('[WebRTC Video] Video play notice:', e));
}

function handleRemoteTrack(event) {
  console.log(`[WebRTC] Remote track arrived: kind=${event.track ? event.track.kind : 'stream'}`);

  if (event.streams && event.streams[0]) {
    const stream = event.streams[0];
    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();

    if (audioTracks.length > 0) {
      attachRemoteAudioTrack(audioTracks[0]);
    }
    if (videoTracks.length > 0) {
      attachRemoteVideoTrack(videoTracks[0]);
    }
  } else if (event.track) {
    if (event.track.kind === 'audio') {
      attachRemoteAudioTrack(event.track);
    } else if (event.track.kind === 'video') {
      attachRemoteVideoTrack(event.track);
    }
  }

  applyAudioRouting(isVideoCall ? 'speaker' : 'earpiece');
}

let audioWatchdogTimer = null;
function startAudioWatchdog() {
  if (audioWatchdogTimer) clearTimeout(audioWatchdogTimer);
  audioWatchdogTimer = setTimeout(() => {
    const remoteAudio = document.getElementById('remoteAudio');
    const hasAudio = remoteAudio && remoteAudio.srcObject && remoteAudio.srcObject.getAudioTracks().length > 0;
    if (!hasAudio && isUsingSfu && !isTerminalState(currentCallState)) {
      console.warn("[WebRTC Watchdog] No remote audio detected on SFU after 4.5s. Activating P2P fallback!");
      fallbackToP2PMesh("NO_AUDIO_TRACKS_ON_SFU");
    }
  }, 4500);
}

function fallbackToP2PMesh(reason) {
  if (!isUsingSfu && peerConnection && (peerConnection.connectionState === 'connected' || peerConnection.iceConnectionState === 'connected')) {
    return;
  }
  console.warn(`[WebRTC Fallback] SFU connection degraded (${reason}). Switching to P2P Mesh with TURNS...`);
  isUsingSfu = false;
  if (audioWatchdogTimer) {
    clearTimeout(audioWatchdogTimer);
    audioWatchdogTimer = null;
  }

  if (pubPeerConnection) {
    try { pubPeerConnection.close(); } catch (e) {}
    pubPeerConnection = null;
  }
  if (subPeerConnection) {
    try { subPeerConnection.close(); } catch (e) {}
    subPeerConnection = null;
  }

  socket.emit('switch-to-p2p', { callId: currentCallId });

  // Initiate P2P mesh
  const isCaller = Boolean(urlParams.get('callId') && !window.location.pathname.includes('/admin/'));
  if (isCaller) {
    startCallNegotiation(true);
  }
}

// ==========================================
// 3. Cloudflare Realtime SFU Core Engine
// ==========================================
async function startCloudflareSFUFlow(isInitiator) {
  try {
    console.log(`[Cloudflare SFU] Initializing Anycast SFU pipeline (isInitiator: ${isInitiator})...`);
    transitionTo(CallState.CONNECTING);

    // 1. Check SFU status
    const status = await fetch('/api/sfu/status').then(r => r.json()).catch(() => ({ enabled: false }));
    if (!status.enabled) {
      console.warn("[Cloudflare SFU] Backend reports SFU not enabled, skipping to P2P fallback.");
      return false;
    }

    // 2. Obtain local media stream
    const stream = await getMicrophoneAccess();
    if (!stream) {
      console.error("[Cloudflare SFU] No local media stream available.");
      return false;
    }

    // 3. Create Publisher Session on Cloudflare Anycast edge
    const pubSessionData = await apiPost('/api/sfu/session/new');
    cfPublisherSessionId = pubSessionData.sessionId;
    console.log(`[Cloudflare SFU] Created Publisher Session ID: ${cfPublisherSessionId}`);

    // 4. Create Publisher RTCPeerConnection
    pubPeerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });
    peerConnection = pubPeerConnection;

    // Attach local tracks as sendonly transceivers
    const audioTrack = stream.getAudioTracks()[0];
    const audioTx = pubPeerConnection.addTransceiver(audioTrack, { direction: 'sendonly' });

    let videoTx = null;
    if (isVideoCall) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTx = pubPeerConnection.addTransceiver(videoTrack, { direction: 'sendonly' });
      }
    }

    // 5. Generate and optimize SDP Offer
    const offer = await pubPeerConnection.createOffer();
    const optimizedSdp = optimizeSDP(offer.sdp, {
      maxAudioBitrate: 32000,
      enableFEC: true,
      enableDTX: true
    });
    await pubPeerConnection.setLocalDescription(new RTCSessionDescription({
      type: offer.type,
      sdp: optimizedSdp
    }));

    // Wait for ICE candidate gathering
    await waitForIceGathering(pubPeerConnection, 1600);

    // 6. Publish tracks to Cloudflare Calls SFU
    const tracksPayload = [
      { location: 'local', mid: audioTx.mid, trackName: 'audio' }
    ];
    if (isVideoCall && videoTx) {
      tracksPayload.push({ location: 'local', mid: videoTx.mid, trackName: 'video' });
    }

    const pubResult = await apiPost(`/api/sfu/sessions/${cfPublisherSessionId}/publish`, {
      sessionDescription: {
        type: 'offer',
        sdp: pubPeerConnection.localDescription.sdp
      },
      tracks: tracksPayload
    });

    console.log("[Cloudflare SFU] Tracks published successfully:", pubResult.tracks);

    // 7. Complete Publisher handshake with SFU Answer
    await pubPeerConnection.setRemoteDescription(new RTCSessionDescription(pubResult.sessionDescription));

    applyAudioSenderOptimizations();
    if (isVideoCall) {
      applyVideoSenderOptimizations();
    }

    // 8. Wait briefly for publisher ICE connection so Cloudflare receives media packets
    await new Promise((resolve) => {
      if (pubPeerConnection.iceConnectionState === 'connected' || pubPeerConnection.connectionState === 'connected') {
        return resolve();
      }
      const onConn = () => {
        if (pubPeerConnection.iceConnectionState === 'connected' || pubPeerConnection.connectionState === 'connected') {
          pubPeerConnection.removeEventListener('iceconnectionstatechange', onConn);
          pubPeerConnection.removeEventListener('connectionstatechange', onConn);
          resolve();
        }
      };
      pubPeerConnection.addEventListener('iceconnectionstatechange', onConn);
      pubPeerConnection.addEventListener('connectionstatechange', onConn);
      setTimeout(resolve, 2000);
    });

    // 9. Announce published tracks to room
    const publishedNames = tracksPayload.map(t => t.trackName);
    socket.emit('cf-sfu-tracks-published', {
      callId: currentCallId,
      sessionId: cfPublisherSessionId,
      tracks: publishedNames
    });

    console.log(`[Cloudflare SFU] Published tracks announced to room ${currentCallId}`);
    return true;
  } catch (err) {
    console.warn("[Cloudflare SFU Error] Initialization failed, will fallback to P2P mesh:", err.message);
    isUsingSfu = false;
    return false;
  }
}

// Subscribe to remote tracks through Cloudflare Realtime SFU
async function subscribeToRemoteSFUTracks(remotePublisherSessionId, trackNames) {
  if (!remotePublisherSessionId || !trackNames || trackNames.length === 0) return;
  if (subscribedRemoteSessions.has(remotePublisherSessionId)) {
    console.log(`[Cloudflare SFU] Already subscribed to session ${remotePublisherSessionId}`);
    return;
  }
  subscribedRemoteSessions.add(remotePublisherSessionId);

  try {
    console.log(`[Cloudflare SFU] Subscribing to remote tracks (${trackNames.join(', ')}) from session ${remotePublisherSessionId}...`);

    // 1. Create Subscriber session if not already initialized
    if (!cfSubscriberSessionId) {
      const subSessionData = await apiPost('/api/sfu/session/new');
      cfSubscriberSessionId = subSessionData.sessionId;
      console.log(`[Cloudflare SFU] Created Subscriber Session ID: ${cfSubscriberSessionId}`);
    }

    // 2. Initialize Subscriber RTCPeerConnection
    if (!subPeerConnection) {
      subPeerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      });

      subPeerConnection.ontrack = (event) => {
        handleRemoteTrack(event);
      };

      // Set low latency jitter buffer hint
      if (subPeerConnection.getReceivers) {
        subPeerConnection.getReceivers().forEach(r => {
          if (r.track && r.track.kind === 'audio' && 'playoutDelayHint' in r) {
            r.playoutDelayHint = 0.05;
          }
        });
      }
    }

    // 3. Request subscription from SFU with retry loop for pending publisher packets
    const subscribePayload = {
      tracks: trackNames.map(name => ({
        location: 'remote',
        sessionId: remotePublisherSessionId,
        trackName: name
      }))
    };

    let subResult = null;
    let subscribeSuccess = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        subResult = await apiPost(`/api/sfu/sessions/${cfSubscriberSessionId}/subscribe`, subscribePayload);
        const hasTrackErrors = subResult.tracks && subResult.tracks.some(t => t.errorCode);
        const isInactive = subResult.sessionDescription && subResult.sessionDescription.sdp && subResult.sessionDescription.sdp.includes('a=inactive');

        if (!hasTrackErrors && !isInactive) {
          subscribeSuccess = true;
          break;
        }

        console.warn(`[Cloudflare SFU] Track subscription attempt ${attempt + 1} pending packets on edge...`, subResult.tracks);
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 700));
        }
      } catch (postErr) {
        console.warn(`[Cloudflare SFU] Subscribe attempt ${attempt + 1} error:`, postErr.message);
        if (attempt < 2) await new Promise(r => setTimeout(r, 700));
      }
    }

    if (!subscribeSuccess || !subResult || !subResult.sessionDescription) {
      throw new Error("Cloudflare SFU tracks not ready or unavailable from publisher");
    }

    console.log("[Cloudflare SFU] Subscription requested. Offer received from SFU:", subResult.tracks);

    // 4. Set SFU Offer on Subscriber PeerConnection
    await subPeerConnection.setRemoteDescription(new RTCSessionDescription(subResult.sessionDescription));

    // 5. Create Answer & Complete Renegotiation
    const answer = await subPeerConnection.createAnswer();
    await subPeerConnection.setLocalDescription(answer);
    await waitForIceGathering(subPeerConnection, 1400);

    await apiPut(`/api/sfu/sessions/${cfSubscriberSessionId}/renegotiate`, {
      sessionDescription: {
        type: 'answer',
        sdp: subPeerConnection.localDescription.sdp
      }
    });

    console.log("[Cloudflare SFU] Subscriber renegotiation completed successfully!");
    isUsingSfu = true;
    handleConnectedState();
    startAudioWatchdog();
  } catch (err) {
    console.error("[Cloudflare SFU Error] Failed subscribing to remote tracks, triggering P2P mesh fallback:", err.message);
    subscribedRemoteSessions.delete(remotePublisherSessionId);
    fallbackToP2PMesh("SFU_SUBSCRIBE_FAILED");
  }
}

// 4. Fallback P2P Mesh Negotiation Core
// ==========================================
async function startCallNegotiation(isInitiator) {
  try {
    if (isUsingSfu || isTerminalState(currentCallState)) return;
    console.log(`[WebRTC P2P] Starting negotiation. Initiator: ${isInitiator}`);
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
    console.error("[WebRTC P2P Error] Negotiation initialization failed:", err);
    reportCallIssue({
      eventType: 'SDP_OFFER_ERROR',
      severity: 'error',
      stage: 'offer_answer',
      errorName: err.name,
      errorMessage: 'Error creating WebRTC offer: ' + (err.message || err.toString()),
      markCallFailed: true
    });
  }
}

async function setupPeerConnection() {
  if (peerConnection || isTerminalState(currentCallState)) return;

  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && !isTerminalState(currentCallState)) {
      socket.emit('send-candidate', {
        candidate: event.candidate,
        targetId: targetPeerId,
        callId: currentCallId
      });
    }
  };

  peerConnection.ontrack = (event) => {
    handleRemoteTrack(event);
  };

  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection) return;
    const connState = peerConnection.connectionState;
    console.log(`[WebRTC] Peer Connection State: ${connState}`);

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

  peerConnection.oniceconnectionstatechange = () => {
    if (!peerConnection) return;
    const iceState = peerConnection.iceConnectionState;
    console.log(`[WebRTC] ICE Connection State: ${iceState}`);

    if (iceState === 'connected' || iceState === 'completed') {
      if (iceDisconnectGraceTimer) {
        clearTimeout(iceDisconnectGraceTimer);
        iceDisconnectGraceTimer = null;
      }
      isRestartingIce = false;
      handleConnectedState();
    } else if (iceState === 'disconnected') {
      if (!iceDisconnectGraceTimer && !isRestartingIce && !isTerminalState(currentCallState)) {
        iceDisconnectGraceTimer = setTimeout(() => {
          iceDisconnectGraceTimer = null;
          if (peerConnection && (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed')) {
            triggerIceRestart();
          }
        }, 4000);
      }
    } else if (iceState === 'failed') {
      triggerIceRestart();
    }
  };
}

// Seamless ICE Restart for P2P mesh
async function triggerIceRestart() {
  if (isUsingSfu || isRestartingIce || isTerminalState(currentCallState) || !peerConnection) return;
  isRestartingIce = true;
  console.log("[WebRTC] Initiating seamless ICE Restart...");

  try {
    if (typeof peerConnection.restartIce === 'function') {
      peerConnection.restartIce();
    }
    const offer = await peerConnection.createOffer({ iceRestart: true });
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
      isIceRestart: true
    });
  } catch (err) {
    console.error("[WebRTC] ICE restart offer creation failed:", err);
    isRestartingIce = false;
  }
}

// Signaling listeners
socket.off('receive-answer').on('receive-answer', async (data) => {
  if (isUsingSfu || isTerminalState(currentCallState)) return;
  try {
    if (peerConnection && data.answer) {
      if (peerConnection.signalingState !== 'have-local-offer') return;
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      console.log("[WebRTC] Set remote description (Answer) successfully.");

      if (webIceQueue.length > 0) {
        for (const cand of webIceQueue) {
          try { await peerConnection.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) {}
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
  if (isUsingSfu || isTerminalState(currentCallState)) return;
  if (!data || !data.candidate) return;

  if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {}
  } else {
    webIceQueue.push(data.candidate);
  }
});

socket.off('peer-disconnected').on('peer-disconnected', (data) => {
  console.warn(`[Socket] Received 'peer-disconnected':`, data);
  const isExplicit = data && (data.explicit || data.reason === 'Completed' || data.reason === 'Cancelled' || data.reason === 'Missed' || data.reason === 'Rejected' || data.reason === 'User Ended Call' || data.reason === 'Admin Ended Call');

  if (isExplicit) {
    console.log("[WebRTC] Peer explicitly ended the call. Terminating session...");
    terminateCallSession(secondsElapsed > 0 ? "Completed" : (data.reason || "Cancelled"));
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

// Idempotent Connected State Handler
function handleConnectedState() {
  if (currentCallState === CallState.CONNECTED || currentCallState === CallState.ACTIVE) {
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

  console.log(`[WebRTC] Call successfully established and active! (Mode: ${isUsingSfu ? 'Cloudflare Anycast SFU' : 'P2P Mesh'})`);
  $("body").addClass("connected");
  $(".call-status-badge")
    .removeClass("connecting ringing")
    .addClass("connected")
    .html('<span class="status-indicator-dot online me-1"></span> Connected');
  $(".call-meta-info p").text("Live 1-on-1 Audio Consultation");
  $(".call-pulse-animation, .call-pulse-animation-2").css("animation-duration", "1.5s");
  $("#call-cancel-btn-wrapper, #call-cancel-btn").addClass("d-none");
  $("#call-active-controls").removeClass("d-none");

  $("#call-network-badge, #videoNetworkPill").removeClass("d-none");

  socket.emit('call-connected', { callId: currentCallId });

  startActiveCallTimer();
  startNetworkMonitoring();
  startCallHeartbeat();

  applyAudioSenderOptimizations();
  if (isVideoCall) {
    applyVideoSenderOptimizations();
  }
}

// ==========================================
// 5. Hardware Media Access & Audio Constraints
// ==========================================
async function getMicrophoneAccess() {
  if (localStream) return localStream;

  const telephonyAudioConstraints = {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 16 },
    googEchoCancellation: { ideal: true },
    googAutoGainControl: { ideal: true },
    googNoiseSuppression: { ideal: true },
    googHighpassFilter: { ideal: true },
    googTypingNoiseDetection: { ideal: true }
  };

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

        localStream.getTracks().forEach(t => {
          if (t.kind === 'audio' && 'contentHint' in t) t.contentHint = 'speech';
          if (t.kind === 'video' && 'contentHint' in t) t.contentHint = 'motion';
        });

        attachLocalVideo(localStream);
        return localStream;
      }
    } catch (videoErr) {
      console.warn("[WebRTC Warning] Video camera access failed or denied, falling back to audio:", videoErr);
    }
  }

  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: telephonyAudioConstraints
      });
      console.log("[WebRTC] Microphone access granted with VoIP telephony constraints.");

      localStream.getAudioTracks().forEach(t => {
        if ('contentHint' in t) t.contentHint = 'speech';
      });

      return localStream;
    }
  } catch (err) {
    console.warn("[WebRTC Error] Hardware microphone access failed:", err);
    alert('Microphone access is required to participate in the call.');
    terminateCallSession("Failed", { failureReason: err.message });
    return null;
  }

  if (window.__ENABLE_SILENT_MOCK_MIC__ || window.navigator.webdriver) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        const audioCtx = new AudioContext();
        const osc = audioCtx.createOscillator();
        const dst = audioCtx.createMediaStreamDestination();
        osc.connect(dst);
        osc.start();
        localStream = dst.stream;
        return localStream;
      }
    } catch (fallbackErr) {}
  }

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
// 6. RTCRtpSender Encoding Optimizations
// ==========================================
async function applyAudioSenderOptimizations() {
  const activePc = pubPeerConnection || peerConnection;
  if (!activePc) return;
  const audioSender = activePc.getSenders().find(s => s.track && s.track.kind === 'audio');
  if (audioSender && audioSender.getParameters && audioSender.setParameters) {
    try {
      const params = audioSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].priority = 'high';
      params.encodings[0].networkPriority = 'high';
      params.encodings[0].maxBitrate = 32000;
      await audioSender.setParameters(params);
      console.log("[WebRTC Sender] Audio sender prioritized (priority: high, maxBitrate: 32kbps)");
    } catch (e) {}
  }
}

async function applyVideoSenderOptimizations() {
  const activePc = pubPeerConnection || peerConnection;
  if (!activePc) return;
  const videoSender = activePc.getSenders().find(s => s.track && s.track.kind === 'video');
  if (videoSender && videoSender.getParameters && videoSender.setParameters) {
    try {
      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      if ('degradationPreference' in videoSender) {
        videoSender.degradationPreference = 'maintain-framerate';
      }
      params.encodings[0].priority = 'medium';
      params.encodings[0].networkPriority = 'medium';
      params.encodings[0].maxBitrate = 900000;
      params.encodings[0].maxFramerate = 24;
      params.encodings[0].scaleResolutionDownBy = 1.0;
      await videoSender.setParameters(params);
      console.log("[WebRTC Sender] Video sender tuned (degradationPreference: maintain-framerate)");
    } catch (e) {}
  }
}

// ==========================================
// 7. Network Quality Monitor & Adaptive Bitrate Engine
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
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.prevStats = null;
  }

  async collectStats() {
    const targetPc = subPeerConnection || pubPeerConnection || peerConnection;
    if (!targetPc || targetPc.connectionState === 'closed') return;
    try {
      const reportMap = await targetPc.getStats();
      let rtt = 0;
      let availableOutgoingBitrate = 0;
      let audioJitter = 0;
      let currentPacketsReceived = 0;
      let currentPacketsLost = 0;
      let videoFps = 0;
      let totalBytesSent = 0;

      reportMap.forEach(report => {
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

        if (report.type === 'inbound-rtp' && (report.kind === 'audio' || report.mediaType === 'audio')) {
          currentPacketsReceived += report.packetsReceived || 0;
          currentPacketsLost += report.packetsLost || 0;
          if (typeof report.jitter === 'number') {
            audioJitter = Math.round(report.jitter * 1000);
          }
        }

        if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
          currentPacketsReceived += report.packetsReceived || 0;
          currentPacketsLost += report.packetsLost || 0;
          if (typeof report.framesPerSecond === 'number') {
            videoFps = Math.round(report.framesPerSecond);
          }
        }

        if (report.type === 'outbound-rtp') {
          totalBytesSent += report.bytesSent || 0;
        }
      });

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
    } catch (statsErr) {}
  }
}

function startNetworkMonitoring() {
  if (networkMonitor) networkMonitor.stop();
  networkMonitor = new NetworkQualityMonitor({
    peerConnection: pubPeerConnection || peerConnection,
    onQualityChange: (quality, stats) => {
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
  const activePc = pubPeerConnection || peerConnection;
  if (!activePc) return;

  const audioSender = activePc.getSenders().find(s => s.track && s.track.kind === 'audio');
  const videoSender = activePc.getSenders().find(s => s.track && s.track.kind === 'video');

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
    } catch (e) {}
  }

  // 2. Video Sender Adaptation (Video Call ALWAYS remains active - never switched to audio)
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
        enc.maxFramerate = 18;
        enc.maxBitrate = 200000;
        enc.active = true;
        setVideoFallbackMode(false);
      } else if (quality === 'CRITICAL') {
        enc.scaleResolutionDownBy = 3.5;
        enc.maxFramerate = 15;
        enc.maxBitrate = 95000;
        enc.active = true; // Video stream strictly active at all times
        setVideoFallbackMode(true, "Weak network: Video quality adjusted to maintain stability");
      }

      await videoSender.setParameters(videoParams);
    } catch (e) {}
  }

  updateNetworkQualityUI(quality, stats);
}

function setVideoFallbackMode(active, message = "Weak network: Video quality adjusted") {
  if (isAudioFirstFallbackActive === active) return;
  isAudioFirstFallbackActive = active;

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

function updateNetworkQualityUI(quality, stats = {}) {
  const $callBadge = $("#call-network-badge");
  const $videoPill = $("#videoNetworkPill");
  const $adminQualityText = $("#adminStreamQualityText");
  const $adminIcon = $("#adminStreamIcon");

  let qualityClass = 'quality-excellent';
  let iconClass = 'bi-reception-4';
  let audioLabel = isUsingSfu ? 'Cloudflare SFU' : 'HD Voice';
  let videoLabel = isUsingSfu ? 'Cloudflare HD' : 'HD';

  if (quality === 'GOOD') {
    qualityClass = 'quality-good';
    iconClass = 'bi-reception-3';
    audioLabel = isUsingSfu ? 'Cloudflare Good' : 'Good Voice';
    videoLabel = isUsingSfu ? 'Cloudflare SD' : 'SD';
  } else if (quality === 'POOR') {
    qualityClass = 'quality-poor';
    iconClass = 'bi-reception-2';
    audioLabel = 'Weak Signal';
    videoLabel = 'Eco';
  } else if (quality === 'CRITICAL') {
    qualityClass = 'quality-critical';
    iconClass = 'bi-reception-1';
    audioLabel = 'Voice Priority';
    videoLabel = 'Low';
  }

  if ($callBadge.length) {
    $callBadge
      .removeClass("quality-excellent quality-good quality-poor quality-critical d-none")
      .addClass(qualityClass);
    $callBadge.find("#call-network-icon").attr("class", `bi ${iconClass} me-1`);
    $callBadge.find("#call-network-label").text(audioLabel);
    $callBadge.attr("title", `Mode: ${isUsingSfu ? 'Cloudflare Anycast SFU' : 'P2P Mesh'} | RTT: ${stats.rtt || 0}ms | Loss: ${stats.packetLoss || 0}%`);
  }

  if ($videoPill.length) {
    $videoPill
      .removeClass("quality-excellent quality-good quality-poor quality-critical d-none")
      .addClass(qualityClass);
    $videoPill.find("#videoNetworkIcon").attr("class", `bi ${iconClass}`);
    $videoPill.find("#videoNetworkLabel").text(videoLabel);
  }

  if ($adminQualityText.length) {
    let adminDesc = isUsingSfu ? "Cloudflare Anycast SFU (Ultra Low Latency)" : "HD Ultra Low Latency";
    if (quality === 'GOOD') adminDesc = `Good (${stats.rtt || 0}ms)`;
    if (quality === 'POOR') adminDesc = `Weak Network (Loss: ${stats.packetLoss || 0}%)`;
    if (quality === 'CRITICAL') adminDesc = "Prioritizing Voice Stability";
    $adminQualityText.text(adminDesc);

    if ($adminIcon.length) {
      if (quality === 'CRITICAL') $adminIcon.attr("class", "bi bi-broadcast text-danger");
      else if (quality === 'POOR') $adminIcon.attr("class", "bi bi-broadcast text-warning");
      else $adminIcon.attr("class", "bi bi-broadcast text-success");
    }
  }
}

// ==========================================
// 8. Visual Call Timer & Client-side Balance Tracker
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
// 9. Termination & Cleanup Handlers (Idempotent)
// ==========================================
$(document).on("click", "#call-end-btn, #call-cancel-btn", function(e) {
  e.preventDefault();
  console.log("[UI] Hangup / Cancel button clicked.");
  const finalReason = secondsElapsed > 0 ? "Completed" : "Cancelled";

  let diagnostics = {};
  if (finalReason === "Cancelled") {
    diagnostics = {
      failureReason: "Call cancelled by user",
      errorCode: "CALL_CANCELLED",
      failedAtStage: currentCallState
    };
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
    } catch (e) {}
    localStream = null;
  }

  if (pubPeerConnection) {
    try { pubPeerConnection.close(); } catch (e) {}
    pubPeerConnection = null;
  }
  if (subPeerConnection) {
    try { subPeerConnection.close(); } catch (e) {}
    subPeerConnection = null;
  }
  if (peerConnection) {
    try { peerConnection.close(); } catch (e) {}
    peerConnection = null;
  }
  webIceQueue = [];
  subscribedRemoteSessions.clear();

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
  const remoteVideo = document.getElementById('remoteVideo');

  if (remoteAudio && typeof remoteAudio.setSinkId === 'function') {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputDevices = devices.filter(d => d.kind === 'audiooutput');

      let chosenDeviceId = '';
      if (targetMode === 'earpiece') {
        const earpiece = outputDevices.find(d => /earpiece|receiver|phone|handset/i.test(d.label));
        if (earpiece) {
          chosenDeviceId = earpiece.deviceId;
        }
      } else {
        const speaker = outputDevices.find(d => /speaker|loudspeaker/i.test(d.label));
        if (speaker) {
          chosenDeviceId = speaker.deviceId;
        }
      }

      if (chosenDeviceId) {
        await remoteAudio.setSinkId(chosenDeviceId);
        if (remoteVideo && typeof remoteVideo.setSinkId === 'function') {
          await remoteVideo.setSinkId(chosenDeviceId);
        }
      }
    } catch (sinkErr) {}
  }

  updateSpeakerButtonUI(targetMode);
}

async function toggleRemoteSpeaker() {
  const nextMode = (currentAudioRoute === 'earpiece') ? 'speaker' : 'earpiece';

  if (typeof navigator.mediaDevices !== 'undefined' && typeof navigator.mediaDevices.selectAudioOutput === 'function') {
    try {
      const selected = await navigator.mediaDevices.selectAudioOutput();
      if (selected && selected.deviceId) {
        const remoteAudio = document.getElementById('remoteAudio');
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteAudio && typeof remoteAudio.setSinkId === 'function') {
          await remoteAudio.setSinkId(selected.deviceId);
        }
        if (remoteVideo && typeof remoteVideo.setSinkId === 'function') {
          await remoteVideo.setSinkId(selected.deviceId);
        }
        const isSpk = /speaker|loudspeaker/i.test(selected.label);
        currentAudioRoute = isSpk ? 'speaker' : 'earpiece';
        updateSpeakerButtonUI(currentAudioRoute);
        return;
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
    }
  }
}

// Front / back camera flipping on mobile devices
let currentFacingMode = 'user';
async function flipCamera() {
  if (!localStream) return;
  const currentVideoTrack = localStream.getVideoTracks()[0];
  if (!currentVideoTrack) return;

  currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact: currentFacingMode } }
    });
    const newVideoTrack = newStream.getVideoTracks()[0];
    const activePc = pubPeerConnection || peerConnection;
    if (activePc) {
      const sender = activePc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
      }
    }
    localStream.removeTrack(currentVideoTrack);
    currentVideoTrack.stop();
    localStream.addTrack(newVideoTrack);
    const localVideo = document.getElementById('localVideo');
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.style.transform = (currentFacingMode === 'environment') ? 'none' : 'scaleX(-1)';
    }
  } catch (err) {
    console.warn('[WebRTC Warning] Could not flip camera:', err);
  }
}
