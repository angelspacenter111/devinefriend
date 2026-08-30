/*
 * WebRTC voice calling companion engine
 * Friend MVC
 */

const socket = io({ transports: ['websocket'] });

// Log connection status
socket.on('connect', () => {
  console.log(`[Socket] Connected successfully to signaling server. Socket ID: ${socket.id}`);
});
socket.on('connect_error', (error) => {
  console.error("[Socket Error] Connection failed:", error);
});
socket.on('disconnect', (reason) => {
  console.warn(`[Socket Warning] Disconnected from signaling server. Reason: ${reason}`);
});

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
  console.log("[Socket] Emitting 'join-call-room' event...");
  socket.emit('join-call-room', { userName: userName });

  // Listen for admin to accept call
  socket.on('peer-connected', async (data) => {
    console.log(`[Socket] Received 'peer-connected' from admin. Socket ID: ${data.adminId}`);
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

  console.log(`[WebRTC] Starting receiver flow for admin. Target peer (Caller ID): ${callerId}`);
  $("#caller-name-display").text(callerName);

  // Accept call alert
  console.log("[Socket] Emitting 'admin-accept-call' event...");
  socket.emit('admin-accept-call', { callerId: callerId });

  // Listen for SDP Offer from user caller
  socket.on('receive-offer', async (data) => {
    console.log(`[Socket] Received 'receive-offer' from peer. Sender ID: ${data.senderId}`);
    targetPeerId = data.senderId;
    
    try {
      // Setup connection and answer
      await setupPeerConnection();
      
      console.log("[WebRTC] Setting Remote Description (SDP Offer)...");
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      console.log("[WebRTC] Remote Description set successfully.");
      
      // Prompt mic & create answer
      await getMicrophoneAccess();
      
      console.log("[WebRTC] Adding local audio tracks to PeerConnection...");
      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
      
      console.log("[WebRTC] Creating SDP Answer...");
      const answer = await peerConnection.createAnswer();
      
      console.log("[WebRTC] Setting Local Description (SDP Answer)...");
      await peerConnection.setLocalDescription(answer);
      
      console.log("[Socket] Emitting 'send-answer' event...");
      socket.emit('send-answer', {
        answer: answer,
        targetId: targetPeerId
      });
    } catch (err) {
      console.error("[WebRTC Error] Negotiation failed during offer processing:", err);
    }
  });
}

// ==========================================
// 3. WebRTC Negotiation Core (Offer/Answer/ICE)
// ==========================================
async function startCallNegotiation(isInitiator) {
  try {
    console.log(`[WebRTC] Starting negotiation. Initiator: ${isInitiator}`);
    await setupPeerConnection();
    await getMicrophoneAccess();
    
    // Add local microphone audio track to connection
    console.log("[WebRTC] Adding local microphone track to PeerConnection...");
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    if (isInitiator) {
      console.log(`[WebRTC] Creating SDP Offer...`);
      const offer = await peerConnection.createOffer();
      
      console.log("[WebRTC] Setting Local Description (SDP Offer)...");
      await peerConnection.setLocalDescription(offer);
      
      console.log("[Socket] Emitting 'send-offer' event...");
      socket.emit('send-offer', {
        offer: offer,
        targetId: targetPeerId
      });
    }
  } catch (err) {
    console.error("[WebRTC Error] Negotiation initialization failed:", err);
  }
}

async function setupPeerConnection() {
  if (peerConnection) {
    console.log("[WebRTC] PeerConnection already exists.");
    return;
  }

  console.log("[WebRTC] Creating new RTCPeerConnection instance...");
  peerConnection = new RTCPeerConnection(rtcConfig);

  // Listen for local ICE candidates generated, emit them to peer
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`[WebRTC] Generated local ICE candidate: ${event.candidate.candidate}`);
      if (targetPeerId) {
        socket.emit('send-candidate', {
          candidate: event.candidate,
          targetId: targetPeerId
        });
      }
    } else {
      console.log("[WebRTC] Local ICE candidate gathering complete.");
    }
  };

  // Track ICE gathering state changes
  peerConnection.onicegatheringstatechange = () => {
    console.log(`[WebRTC] ICE Gathering State: ${peerConnection.iceGatheringState}`);
  };

  // Track Signaling state changes
  peerConnection.onsignalingstatechange = () => {
    console.log(`[WebRTC] Signaling State: ${peerConnection.signalingState}`);
  };

  // Track ICE connection state changes
  peerConnection.oniceconnectionstatechange = () => {
    console.log(`[WebRTC] ICE Connection State: ${peerConnection.iceConnectionState}`);
    if (peerConnection.iceConnectionState === 'failed') {
      console.error("[WebRTC Error] ICE Connection failed. NAT traversal may have failed.");
    }
  };

  // When remote track audio stream arrives, route to html player
  peerConnection.ontrack = (event) => {
    console.log(`[WebRTC] Remote track arrived. Streaming audio. Track kind: ${event.track.kind}`);
    const remoteAudio = document.getElementById('remoteAudio');
    if (remoteAudio) {
      remoteAudio.srcObject = event.streams[0];
      console.log("[WebRTC] Attached remote stream to HTML player.");
    } else {
      console.error("[WebRTC Error] HTML player element #remoteAudio not found!");
    }
  };

  // Connection status tracking
  peerConnection.onconnectionstatechange = () => {
    console.log(`[WebRTC] Peer Connection State: ${peerConnection.connectionState}`);
    
    if (peerConnection.connectionState === 'connected') {
      console.log("[WebRTC] Call connected successfully!");
      $(".call-status-badge").removeClass("connecting").addClass("connected").text("You're Connected");
      $(".call-pulse-animation, .call-pulse-animation-2").css("animation-duration", "1.5s");
      $("#call-cancel-btn").addClass("d-none");
      $("#call-active-controls").removeClass("d-none");
      
      startActiveCallTimer();
    } else if (peerConnection.connectionState === 'failed') {
      console.error("[WebRTC Error] Connection state failed. Check network access or STUN blocks.");
    } else if (peerConnection.connectionState === 'disconnected') {
      console.warn("[WebRTC Warning] Connection state disconnected.");
    } else if (peerConnection.connectionState === 'closed') {
      console.log("[WebRTC] Connection state closed.");
    }
  };
}

// WebRTC incoming signaling listeners
socket.on('receive-answer', async (data) => {
  console.log(`[Socket] Received 'receive-answer' from peer.`);
  try {
    console.log("[WebRTC] Setting Remote Description (SDP Answer)...");
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    console.log("[WebRTC] Remote Description set successfully.");
  } catch (err) {
    console.error("[WebRTC Error] Failed to set Remote Description:", err);
  }
});

socket.on('receive-candidate', async (data) => {
  console.log(`[Socket] Received remote ICE candidate.`);
  if (peerConnection) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      console.log("[WebRTC] Successfully added remote ICE Candidate.");
    } catch (e) {
      console.error("[WebRTC Error] Failed to add remote ICE Candidate:", e);
    }
  } else {
    console.warn("[WebRTC Warning] Received ICE candidate but PeerConnection is not initialized.");
  }
});

socket.on('peer-disconnected', () => {
  console.warn(`[Socket] Received 'peer-disconnected' alert. Ending call session.`);
  terminateCallSession(secondsElapsed > 0 ? "Completed" : "Cancelled");
});

// Prompt microphone hardware stream
async function getMicrophoneAccess() {
  if (localStream) return;
  try {
    console.log("[WebRTC] Requesting local microphone access...");
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("[WebRTC] Microphone access granted.");
  } catch (err) {
    console.error("[WebRTC Error] Error accessing microphone:", err);
    alert("Microphone access is required to start the voice call.");
    console.log("[WebRTC] Terminating session due to lack of microphone permissions...");
    socket.emit('hangup');
    terminateCallSession("Cancelled");
  }
}

// ==========================================
// 4. UI Call Timer & Credits Deduction Loop
// ==========================================
function startActiveCallTimer() {
  if (callTimerInterval) return;

  console.log("[UI] Starting call duration billing timer...");
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

        console.log(`[Billing] 1 minute elapsed. Credits used: ${currentCreditsUsed}. Remaining: ${activeUser.credits}`);

        // Low credit notification alert
        if (activeUser.credits === 2) {
          triggerLowCreditWarning();
        }

        // Auto disconnect
        if (activeUser.credits === 0) {
          console.log("[Billing] User has run out of credits. Automatically disconnecting...");
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
  console.log("[UI] Hangup clicked by user.");
  socket.emit('hangup');
  terminateCallSession(secondsElapsed > 0 ? "Completed" : "Cancelled");
});

function terminateCallSession(statusType) {
  console.log(`[WebRTC] Terminating call session with status: ${statusType}`);
  // Clear counting timers
  clearInterval(callTimerInterval);

  // Close media tracks
  if (localStream) {
    console.log("[WebRTC] Stopping microphone media tracks...");
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // Close peer connections
  if (peerConnection) {
    console.log("[WebRTC] Closing RTCPeerConnection...");
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

    console.log(`[Ajax] Saving call details. Duration: ${formattedDuration}, Status: ${finalStatus}, Credits: ${finalCreditsUsed}`);

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
        console.log("[Ajax] Call saved successfully. Redirecting to call history...");
        window.location.href = "/user/call-history?callFinished=true";
      },
      error: function(xhr, status, err) {
        console.error("[Ajax Error] Failed to save call session:", err);
        window.location.href = "/user/call-history?callFinished=true";
      }
    });
  } else {
    // Redirect admin receiver
    console.log("[UI] Redirecting admin to dashboard...");
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
      console.log(`[WebRTC] Local microphone track enabled state set to: ${audioTrack.enabled}`);
      
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
    console.log(`[WebRTC] Remote audio player muted state set to: ${remoteAudio.muted}`);
    
    // Update UI button class
    $btn.toggleClass("active");
    $btn.find("i").toggleClass("bi-volume-up-fill bi-volume-mute-fill");
  }
}
