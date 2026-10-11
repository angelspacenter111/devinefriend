import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices
} from 'react-native-webrtc';

export const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelay',
      credential: 'openrelay'
    }
  ],
  iceCandidatePoolSize: 10
};

export const webrtcService = {
  /**
   * Request local audio media stream from device microphone
   */
  getUserMedia: async ({ audio = true, video = false } = {}) => {
    try {
      console.log('[WebRTC Service] Requesting user media (audio:', audio, 'video:', video, ')');
      if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
        throw new Error('WebRTC native mediaDevices not available on this platform/build.');
      }

      const stream = await mediaDevices.getUserMedia({
        audio: audio
          ? {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          : false,
        video: video
          ? {
              facingMode: 'user',
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { max: 30 }
            }
          : false
      });
      console.log('[WebRTC Service] Local media stream acquired successfully');
      return stream;
    } catch (err) {
      console.error('[WebRTC Service] Failed to get user media:', err);
      throw err;
    }
  },

  /**
   * Create and initialize a new RTCPeerConnection with callbacks
   */
  createPeerConnection: ({
    onIceCandidate,
    onTrack,
    onConnectionStateChange,
    rtcConfig = RTC_CONFIG
  } = {}) => {
    try {
      console.log('[WebRTC Service] Creating new RTCPeerConnection with config:', JSON.stringify(rtcConfig.iceServers.map(s => s.urls)));
      if (typeof RTCPeerConnection === 'undefined') {
        throw new Error('RTCPeerConnection is not supported on this platform/build.');
      }

      const pc = new RTCPeerConnection(rtcConfig);

      if (onIceCandidate) {
        pc.onicecandidate = (event) => {
          if (event && event.candidate) {
            // Extract clean plain JSON object for safe socket transmission across JS engines
            const candidateData = {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex
            };
            onIceCandidate(candidateData);
          }
        };
      }

      if (onTrack) {
        pc.ontrack = (event) => {
          console.log('[WebRTC Service] ontrack event triggered, kind:', event?.track?.kind);
          if (event && event.streams && event.streams[0]) {
            onTrack(event.streams[0], event.track);
          } else if (event && event.track) {
            onTrack(null, event.track);
          }
        };
      }

      // Check both connectionState and iceConnectionState for instant, reliable connection detection
      const handleStateUpdate = () => {
        const pcState = pc.connectionState;
        const iceState = pc.iceConnectionState;
        console.log(`[WebRTC Service] State update => PeerConnection: ${pcState}, ICE: ${iceState}`);

        if (onConnectionStateChange) {
          if (pcState === 'connected' || iceState === 'connected' || iceState === 'completed') {
            onConnectionStateChange('connected');
          } else if (pcState === 'failed' || iceState === 'failed') {
            onConnectionStateChange('failed');
          } else if (pcState === 'disconnected' || iceState === 'disconnected') {
            onConnectionStateChange('disconnected');
          } else if (pcState === 'closed' || iceState === 'closed') {
            onConnectionStateChange('closed');
          }
        }
      };

      pc.onconnectionstatechange = handleStateUpdate;
      pc.oniceconnectionstatechange = handleStateUpdate;

      return pc;
    } catch (err) {
      console.error('[WebRTC Service] Failed to create RTCPeerConnection:', err);
      throw err;
    }
  },

  /**
   * Attach local stream tracks to the peer connection
   */
  addStreamTracks: (pc, stream) => {
    if (!pc || !stream) return;
    try {
      stream.getTracks().forEach((track) => {
        try {
          pc.addTrack(track, stream);
          console.log('[WebRTC Service] Added local track to peer connection:', track.kind);
        } catch (trackErr) {
          console.warn('[WebRTC Service] Track add warning:', trackErr.message);
        }
      });
    } catch (err) {
      console.error('[WebRTC Service] Failed to add tracks:', err);
    }
  },

  /**
   * Set remote SDP description (offer or answer)
   */
  setRemoteDescription: async (pc, sdp) => {
    if (!pc || !sdp) return;
    try {
      const cleanDesc = {
        type: sdp.type,
        sdp: sdp.sdp
      };
      const sessionDesc = new RTCSessionDescription(cleanDesc);
      await pc.setRemoteDescription(sessionDesc);
      console.log('[WebRTC Service] Set remote description success, type:', sdp.type);
    } catch (err) {
      console.error('[WebRTC Service] Failed to set remote description:', err);
      throw err;
    }
  },

  /**
   * Create and set local answer SDP (returns clean plain object for socket serialization)
   */
  createAnswer: async (pc) => {
    if (!pc) throw new Error('PeerConnection is not initialized');
    try {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('[WebRTC Service] Created and set local answer SDP');
      return {
        type: answer.type || 'answer',
        sdp: answer.sdp
      };
    } catch (err) {
      console.error('[WebRTC Service] Failed to create answer:', err);
      throw err;
    }
  },

  /**
   * Create and set local offer SDP (returns clean plain object for socket serialization)
   */
  createOffer: async (pc, options = {}) => {
    if (!pc) throw new Error('PeerConnection is not initialized');
    try {
      const offer = await pc.createOffer(options);
      await pc.setLocalDescription(offer);
      console.log('[WebRTC Service] Created and set local offer SDP');
      return {
        type: offer.type || 'offer',
        sdp: offer.sdp
      };
    } catch (err) {
      console.error('[WebRTC Service] Failed to create offer:', err);
      throw err;
    }
  },

  /**
   * Add ICE Candidate received from remote peer
   */
  addIceCandidate: async (pc, candidateInit) => {
    if (!pc || !candidateInit) return;
    try {
      const candidatePayload = {
        candidate: candidateInit.candidate,
        sdpMid: candidateInit.sdpMid,
        sdpMLineIndex: candidateInit.sdpMLineIndex
      };
      if (!candidatePayload.candidate) {
        console.warn('[WebRTC Service] Skipping empty candidate');
        return;
      }
      const candidate = new RTCIceCandidate(candidatePayload);
      await pc.addIceCandidate(candidate);
      console.log('[WebRTC Service] Added remote ICE candidate');
    } catch (err) {
      console.warn('[WebRTC Service] Error adding ICE candidate:', err.message);
    }
  },

  /**
   * Toggle mute on local audio tracks
   */
  setAudioMute: (stream, isMuted) => {
    if (!stream) return;
    try {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });
      console.log('[WebRTC Service] Audio mute set to:', isMuted);
    } catch (err) {
      console.warn('[WebRTC Service] Error setting audio mute:', err);
    }
  },

  /**
   * Toggle speakerphone on tracks
   */
  setSpeakerphone: (stream, isSpeakerOn) => {
    if (!stream) return;
    try {
      stream.getAudioTracks().forEach((track) => {
        if (typeof track._setSpeakerphoneOn === 'function') {
          track._setSpeakerphoneOn(isSpeakerOn);
        }
      });
      console.log('[WebRTC Service] Speakerphone set to:', isSpeakerOn);
    } catch (err) {
      console.warn('[WebRTC Service] Error setting speakerphone:', err);
    }
  },

  /**
   * Safely release media streams and close peer connection
   */
  cleanup: ({ pc, localStream }) => {
    console.log('[WebRTC Service] Cleaning up WebRTC resources...');
    if (localStream) {
      try {
        localStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (tErr) {}
        });
      } catch (err) {
        console.warn('[WebRTC Service] Error stopping local tracks:', err);
      }
    }

    if (pc) {
      try {
        pc.close();
      } catch (err) {
        console.warn('[WebRTC Service] Error closing peer connection:', err);
      }
    }
    console.log('[WebRTC Service] WebRTC cleanup finished');
  }
};

export default webrtcService;
