/*
 * WebRTC voice calling companion engine
 * Friend MVC
 */

const socket = io({ transports: ['websocket'] });

// Free public STUN server configuration for NAT traversal
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

let localStream = null;
let peerConnection = null;
let targetPeerId = null; // Stored remote socket ID for sending SDPs

let secondsElapsed = 0;
let callTimerInterval = null;
let currentCreditsUsed = 0;
let callStartTime = null;

// Session user configuration
const activeUser = window.sessionUser || { name: "Jane Doe", credits: 25 };
const initialCredits = activeUser.credits;

$(document).ready(function() {
  const isUserCaller = $("#call-screen-trigger").length > 0;
  const isAdminReceiver = $("#webrtc-admin-trigger").length > 0;

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
  const userName = activeUser.name;
  console.log(`[WebRTC] Starting caller flow for user: ${userName}`);

  // Join call signaling room
  socket.emit('join-call-room', { userName: userName });

  // Listen for admin to accept call
  socket.on('peer-connected', async (data) => {
    targetPeerId = data.adminId;
    console.log(`[WebRTC] Support partner accepted call. Peer socket: ${targetPeerId}`);
    callStartTime = Date.now(); // Set call start timestamp
    
    // Begin negotiations
    await startCallNegotiation(true);
  });
}

// ==========================================
// 2. Receiver Flow (Admin side /admin/call)
// ==========================================
function initializeReceiverFlow() {
  const callerId = localStorage.getItem("webrtc_caller_id");
  const callerName = localStorage.getItem("webrtc_caller_name") || "Jane Doe";
  targetPeerId = callerId;

  console.log(`[WebRTC] Starting receiver flow for admin. Target peer: ${callerId}`);
  $("#caller-name-display").text(callerName);

  // Accept call alert
  socket.emit('admin-accept-call', { callerId: callerId });

  // Listen for SDP Offer from user caller
  socket.on('receive-offer', async (data) => {
    console.log(`[WebRTC] Received offer from peer. Negotiating...`);
    targetPeerId = data.senderId;
    
    // Setup connection and answer
    await setupPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    
    // Prompt mic & create answer
    await getMicrophoneAccess();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('send-answer', {
      answer: answer,
      targetId: targetPeerId
    });
  });
}

// ==========================================
// 3. WebRTC Negotiation Core (Offer/Answer/ICE)
// ==========================================
async function startCallNegotiation(isInitiator) {
  await setupPeerConnection();
  await getMicrophoneAccess();
  
  // Add local microphone audio track to connection
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  if (isInitiator) {
    console.log(`[WebRTC] Creating SDP Offer...`);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('send-offer', {
      offer: offer,
      targetId: targetPeerId
    });
  }
}

async function setupPeerConnection() {
  if (peerConnection) return;

  peerConnection = new RTCPeerConnection(rtcConfig);

  // Listen for local ICE candidates generated, emit them to peer
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && targetPeerId) {
      socket.emit('send-candidate', {
        candidate: event.candidate,
        targetId: targetPeerId
      });
    }
  };

  // When remote track audio stream arrives, route to html player
  peerConnection.ontrack = (event) => {
    console.log(`[WebRTC] Remote track arrived. Streaming audio.`);
    const remoteAudio = document.getElementById('remoteAudio');
    if (remoteAudio) {
      remoteAudio.srcObject = event.streams[0];
    }
  };

  // Connection status tracking
  peerConnection.onconnectionstatechange = () => {
    console.log(`[WebRTC] Connection state changed: ${peerConnection.connectionState}`);
    
    if (peerConnection.connectionState === 'connected') {
      $(".call-status-badge").removeClass("connecting").addClass("connected").text("You're Connected");
      $(".call-pulse-animation, .call-pulse-animation-2").css("animation-duration", "1.5s");
      $("#call-cancel-btn").addClass("d-none");
      $("#call-active-controls").removeClass("d-none");
      
      startActiveCallTimer();
    }
  };
}

// WebRTC incoming signaling listeners
socket.on('receive-answer', async (data) => {
  console.log(`[WebRTC] Received SDP Answer from support partner.`);
  await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('receive-candidate', async (data) => {
  if (peerConnection) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
      console.error("[WebRTC] Error adding ICE Candidate: ", e);
    }
  }
});

socket.on('peer-disconnected', () => {
  console.log(`[WebRTC] Remote peer hung up call.`);
  terminateCallSession(secondsElapsed > 0 ? "Completed" : "Cancelled");
});

// Prompt microphone hardware stream
async function getMicrophoneAccess() {
  if (localStream) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("[WebRTC] Microphone access granted.");
  } catch (err) {
    console.error("[WebRTC] Error accessing microphone: ", err);
    alert("Microphone access is required to start the voice call.");
    hangupCall();
  }
}

// ==========================================
// 4. UI Call Timer & Credits Deduction Loop
// ==========================================
function startActiveCallTimer() {
  if (callTimerInterval) return;

  callTimerInterval = setInterval(() => {
    secondsElapsed++;
    
    // Format duration mm:ss
    const mins = Math.floor(secondsElapsed / 60);
    const secs = secondsElapsed % 60;
    const timeStr = (mins < 10 ? "0" + mins : mins) + ":" + (secs < 10 ? "0" + secs : secs);
    $(".call-timer").text(timeStr);

    // Call credit billing (1 min = 1 credit) for user clients only
    const isUserCaller = $("#call-screen-trigger").length > 0;
    if (isUserCaller && secondsElapsed % 60 === 0) {
      if (activeUser && activeUser.credits > 0) {
        activeUser.credits--;
        currentCreditsUsed++;

        // Sync UI indicators
        $("#call-credits-remaining").text(activeUser.credits);
        $("#call-credits-used").text(currentCreditsUsed);
        $(".simulated-balance").text(activeUser.credits);

        // Low credit notification alert
        if (activeUser.credits === 2) {
          triggerLowCreditWarning();
        }

        // Auto disconnect
        if (activeUser.credits === 0) {
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
// 5. Termination & Cleanup Handlers
// ==========================================
$("#call-end-btn, #call-cancel-btn").on("click", function() {
  socket.emit('hangup');
  terminateCallSession(secondsElapsed > 0 ? "Completed" : "Cancelled");
});

function terminateCallSession(statusType) {
  // Clear counting timers
  clearInterval(callTimerInterval);

  // Close media tracks
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // Close peer connections
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  const isUserCaller = $("#call-screen-trigger").length > 0;
  if (isUserCaller) {
    const elapsedSecs = secondsElapsed > 0 ? secondsElapsed : (callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0);
    
    let finalStatus = statusType;
    if (elapsedSecs > 0 && statusType === "Cancelled") {
      finalStatus = "Completed";
    }
    
    const finalCreditsUsed = finalStatus === "Cancelled" ? 0 : Math.max(1, Math.ceil(elapsedSecs / 60));
    const formattedDuration = (Math.floor(elapsedSecs / 60) < 10 ? "0" : "") + Math.floor(elapsedSecs / 60) + ":" + ((elapsedSecs % 60) < 10 ? "0" : "") + (elapsedSecs % 60);

    // Save Call logs & transaction details to database via AJAX
    $.ajax({
      url: '/user/end-call',
      method: 'POST',
      data: {
        duration: formattedDuration,
        status: finalStatus,
        creditsUsed: finalCreditsUsed
      },
      success: function(res) {
        window.location.href = "/user/call-history?callFinished=true";
      },
      error: function() {
        window.location.href = "/user/call-history?callFinished=true";
      }
    });
  } else {
    // Redirect admin receiver
    window.location.href = "/admin/dashboard";
  }
}

// Controls Mute/Unmute microphone tracks
function toggleLocalMute() {
  const $btn = $("#mute-toggle-btn");
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      
      // Update UI button class
      $btn.toggleClass("active");
      $btn.find("i").toggleClass("bi-mic-fill bi-mic-mute-fill");
    }
  }
}

// Controls remote speaker sound volume
function toggleRemoteSpeaker() {
  const $btn = $("#speaker-toggle-btn");
  const remoteAudio = document.getElementById('remoteAudio');
  if (remoteAudio) {
    remoteAudio.muted = !remoteAudio.muted;
    
    // Update UI button class
    $btn.toggleClass("active");
    $btn.find("i").toggleClass("bi-volume-up-fill bi-volume-mute-fill");
  }
}
