/*
 * WebRTC Voice Calling Companion Engine
 * Friend MVC - Production Ready, Hardened & Zero Regression
 */

// Global Socket instance
const socket = io();

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

let isTerminating = false;
let ringingTimeoutTimer = null;
let connectingTimeoutTimer = null;

// STUN server configuration for NAT traversal
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

let localStream = null;
let peerConnection = null;
let targetPeerId = null;

let secondsElapsed = 0;
let callTimerInterval = null;
let currentCreditsUsed = 0;
let callStartTime = null;

// Session user configuration
const activeUser = window.sessionUser || { name: "Caller", credits: 25 };

// Socket connection diagnostic logging
socket.on('connect', () => {
  console.log(`[Socket] Connected to signaling server. Socket ID: ${socket.id}, Call ID: ${currentCallId}`);
});

socket.on('connect_error', (error) => {
  console.error("[Socket Error] Connection failed:", error);
});

socket.on('disconnect', (reason) => {
  console.warn(`[Socket Warning] Disconnected from signaling server: ${reason}`);
  if (currentCallState === CallState.ACTIVE || currentCallState === CallState.CONNECTED) {
    terminateCallSession("Completed");
  }
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
      userName: userName
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

  // Ringing Timeout: 45 seconds if not answered
  ringingTimeoutTimer = setTimeout(() => {
    if (currentCallState === CallState.RINGING || currentCallState === CallState.OUTGOING) {
      console.warn("[WebRTC Timeout] Ringing timed out after 45s without answer.");
      alert("Our support advisors are currently busy assisting other members. Please try calling again in a few moments.");
      socket.emit('hangup', { callId: currentCallId, reason: 'Missed' });
      terminateCallSession('Missed');
    }
  }, 45000);

  // Listen for admin to accept call
  socket.off('peer-connected').on('peer-connected', async (data) => {
    if (isTerminalState(currentCallState)) return;

    console.log(`[Socket] Support partner accepted call. Peer socket: ${data.adminId}`);
    if (ringingTimeoutTimer) {
      clearTimeout(ringingTimeoutTimer);
      ringingTimeoutTimer = null;
    }

    transitionTo(CallState.ACCEPTED, { peer: data.adminId });
    targetPeerId = data.adminId;
    callStartTime = Date.now();

    // Start 30s WebRTC Connection Timeout
    connectingTimeoutTimer = setTimeout(() => {
      if (currentCallState === CallState.ACCEPTED || currentCallState === CallState.CONNECTING) {
        console.warn("[WebRTC Timeout] Connection handshake timed out after 30s.");
        alert("Audio connection timed out. Please check your network and try again.");
        terminateCallSession('Failed');
      }
    }, 30000);

    // Begin negotiations
    await startCallNegotiation(true);
  });

  // Listen for admin to reject/decline call
  socket.off('call-rejected').on('call-rejected', (data) => {
    console.warn(`[Socket] Call was declined by advisor:`, data);
    if (ringingTimeoutTimer) clearTimeout(ringingTimeoutTimer);
    alert('Your call request was declined by the support advisor.');
    terminateCallSession('Rejected');
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

  // Accept call alert
  function emitAdminAccept() {
    console.log(`[WebRTC] Emitting admin-accept-call for Call ID: ${currentCallId}, Socket ID: ${socket.id}`);
    socket.emit('admin-accept-call', {
      callId: currentCallId,
      callerId: callerId,
      adminId: (window.sessionUser && window.sessionUser.id) || null,
      adminName: (window.sessionUser && window.sessionUser.name) || "Support Advisor"
    });
  }

  if (socket.connected) {
    emitAdminAccept();
  } else {
    socket.once('connect', emitAdminAccept);
  }

  // Start 30s Connection Timeout for Admin
  connectingTimeoutTimer = setTimeout(() => {
    if (currentCallState === CallState.ACCEPTED || currentCallState === CallState.CONNECTING) {
      console.warn("[WebRTC Timeout] Peer connection handshake timed out for admin.");
      terminateCallSession('Failed');
    }
  }, 30000);

  // Listen for SDP Offer from caller
  socket.off('receive-offer').on('receive-offer', async (data) => {
    if (isTerminalState(currentCallState)) return;
    console.log(`[Socket] Received 'receive-offer' from peer.`);
    targetPeerId = data.senderId;

    try {
      transitionTo(CallState.CONNECTING, { targetPeerId });
      await setupPeerConnection();
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      
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
      terminateCallSession('Failed');
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
    terminateCallSession('Failed');
  }
}

async function setupPeerConnection() {
  if (peerConnection || isTerminalState(currentCallState)) return;

  peerConnection = new RTCPeerConnection(rtcConfig);

  // Local ICE candidate forwarding
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && targetPeerId && !isTerminalState(currentCallState)) {
      socket.emit('send-candidate', {
        candidate: event.candidate,
        targetId: targetPeerId,
        callId: currentCallId
      });
    }
  };

  // Remote audio track reception
  peerConnection.ontrack = (event) => {
    console.log(`[WebRTC] Remote track arrived. Streaming audio.`);
    const remoteAudio = document.getElementById('remoteAudio');
    if (remoteAudio && event.streams && event.streams[0]) {
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play().catch(e => console.warn('[WebRTC] Auto-play audio warning:', e));
    }
  };

  // Connection state changes
  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection) return;
    const connState = peerConnection.connectionState;
    console.log(`[WebRTC] Peer Connection State: ${connState}`);

    if (connState === 'connected') {
      if (connectingTimeoutTimer) {
        clearTimeout(connectingTimeoutTimer);
        connectingTimeoutTimer = null;
      }

      transitionTo(CallState.CONNECTED);
      transitionTo(CallState.ACTIVE);

      console.log("[WebRTC] Call successfully established and active!");
      $(".call-status-badge").removeClass("connecting").addClass("connected").text("You're Connected");
      $(".call-pulse-animation, .call-pulse-animation-2").css("animation-duration", "1.5s");
      $("#call-cancel-btn-wrapper, #call-cancel-btn").addClass("d-none");
      $("#call-active-controls").removeClass("d-none");

      // Notify server that call is actively connected
      socket.emit('call-connected', { callId: currentCallId });

      startActiveCallTimer();
    } else if (connState === 'failed') {
      console.warn("[WebRTC] Peer connection failed.");
      terminateCallSession(secondsElapsed > 0 ? "Completed" : "Failed");
    } else if (connState === 'disconnected') {
      console.warn("[WebRTC] Peer connection disconnected.");
      terminateCallSession(secondsElapsed > 0 ? "Completed" : "Cancelled");
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    if (!peerConnection) return;
    console.log(`[WebRTC] ICE Connection State: ${peerConnection.iceConnectionState}`);
    if (peerConnection.iceConnectionState === 'failed') {
      console.warn("[WebRTC] ICE failed. Attempting restart...");
      if (typeof peerConnection.restartIce === 'function') {
        peerConnection.restartIce();
      }
    }
  };
}

// Signaling listeners
socket.off('receive-answer').on('receive-answer', async (data) => {
  if (isTerminalState(currentCallState)) return;
  try {
    if (peerConnection) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
  } catch (err) {
    console.error("[WebRTC Error] Failed to set Remote Description (Answer):", err);
  }
});

socket.off('receive-candidate').on('receive-candidate', async (data) => {
  if (isTerminalState(currentCallState)) return;
  if (peerConnection && data.candidate) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
      console.error("[WebRTC Error] Failed to add remote ICE candidate:", e);
    }
  }
});

socket.off('peer-disconnected').on('peer-disconnected', (data) => {
  console.warn(`[Socket] Received 'peer-disconnected'. Ending call session.`);
  terminateCallSession(secondsElapsed > 0 ? "Completed" : "Cancelled");
});

socket.off('call-finalized').on('call-finalized', (data) => {
  console.log(`[Socket] Call finalized confirmation received from server:`, data);
});

// Hardware microphone stream (with graceful silent track fallback)
async function getMicrophoneAccess() {
  if (localStream) return localStream;
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("[WebRTC] Microphone access granted.");
      return localStream;
    }
  } catch (err) {
    console.warn("[WebRTC Warning] Hardware microphone access failed, attempting audio fallback:", err);
  }

  // Graceful fallback for test environments / systems without physical microphones
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
        track.enabled = false; // muted silent track
        localStream = dst.stream;
        console.log("[WebRTC] Silent audio track fallback initialized.");
        return localStream;
      }
    }
  } catch (fallbackErr) {
    console.warn("[WebRTC Warning] Silent audio fallback failed:", fallbackErr);
  }

  console.error("[WebRTC Error] Microphone access denied or no audio device available.");
  alert("Microphone access is required to participate in the call.");
  socket.emit('hangup', { callId: currentCallId, reason: 'Cancelled' });
  terminateCallSession("Cancelled");
  return null;
}

// ==========================================
// 4. Visual Call Timer & Client-side Balance Tracker
// ==========================================
function startActiveCallTimer() {
  if (callTimerInterval) return;

  console.log("[UI] Starting duration timer...");
  callTimerInterval = setInterval(() => {
    secondsElapsed++;

    const mins = Math.floor(secondsElapsed / 60);
    const secs = secondsElapsed % 60;
    const timeStr = (mins < 10 ? "0" + mins : mins) + ":" + (secs < 10 ? "0" + secs : secs);
    $(".call-timer").text(timeStr);

    const isUserCaller = $("#call-screen-trigger").length > 0 || window.isCaller;
    if (isUserCaller && secondsElapsed % 60 === 0) {
      if (activeUser && activeUser.credits > 0) {
        activeUser.credits--;
        currentCreditsUsed++;

        $("#call-credits-remaining").text(activeUser.credits);
        $("#call-credits-used").text(currentCreditsUsed);
        $(".simulated-balance").text(activeUser.credits);

        if (activeUser.credits === 2) {
          triggerLowCreditWarning();
        }

        if (activeUser.credits <= 0) {
          console.log("[Billing] Credits exhausted. Disconnecting call...");
          terminateCallSession("Auto-Disconnected (No Credits)");
        }
      }
    }
  }, 1000);
}

function triggerLowCreditWarning() {
  if ($(".call-low-credit-bar").length === 0) {
    const warningHtml = `
      <div class="call-low-credit-bar">
        <span><i class="bi bi-exclamation-triangle-fill me-2"></i> Low Credit Alert: 2 Minutes Remaining</span>
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
  socket.emit('hangup', { callId: currentCallId, reason: finalReason });
  terminateCallSession(finalReason);
});

function terminateCallSession(statusType) {
  if (isTerminating) return;
  isTerminating = true;

  transitionTo(CallState.ENDING, { statusType });

  console.log(`[WebRTC] Terminating call session (${currentCallId}) with status: ${statusType}`);

  // Protect buttons against multi-click
  $("#call-end-btn, #call-cancel-btn").prop('disabled', true);
  if (statusType === 'Cancelled' || statusType === 'Missed') {
    $("#call-cancel-btn").text('Cancelling...');
  } else {
    $("#call-end-btn").html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>');
  }

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

  // Clean local storage state
  localStorage.removeItem('active_call_id');
  localStorage.removeItem('webrtc_caller_id');
  localStorage.removeItem('webrtc_caller_name');

  transitionTo(CallState.ENDED, { statusType });

  const isUserCaller = $("#call-screen-trigger").length > 0 || window.isCaller;

  if (isUserCaller) {
    // Notify server via AJAX to finalize call and deduct credits
    $.ajax({
      url: '/user/end-call',
      method: 'POST',
      data: {
        callId: currentCallId,
        status: statusType
      },
      complete: function() {
        transitionTo(CallState.FINALIZED);
        window.location.href = "/user/call-history?callFinished=true";
      }
    });
  } else {
    // Admin receiver flow
    $.ajax({
      url: '/admin/end-call',
      method: 'POST',
      data: {
        callId: currentCallId,
        status: statusType
      },
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
