import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices
} from 'react-native-webrtc';

export const RTC_CONFIG = {
  iceServers: [
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
    // Standard Anycast STUN servers
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ],
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceTransportPolicy: 'all',
  iceCandidatePoolSize: 10
};

/**
 * Opus Audio SDP Optimization for Crystal Clear Voice Calling & Packet Loss Recovery
 * - useinbandfec=1: Opus In-band Forward Error Correction (recovers lost audio packets without robotic distortion)
 * - usedtx=1: Discontinuous Transmission (saves cellular data during pauses)
 * - maxaveragebitrate=32000: High definition 32kbps speech encoding
 * - stereo=0: Pure mono speech (avoids earpiece phase cancellation)
 */
function optimizeOpusSDP(sdp) {
  if (!sdp || typeof sdp !== 'string') return sdp;
  try {
    const opusMatch = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
    if (!opusMatch) return sdp;
    const pt = opusMatch[1];
    const fmtpRegex = new RegExp(`a=fmtp:${pt}\\s+([^\\r\\n]+)`, 'i');
    const opusParams = 'minptime=10;useinbandfec=1;usedtx=1;stereo=0;sprop-stereo=0;maxaveragebitrate=32000';

    if (fmtpRegex.test(sdp)) {
      return sdp.replace(fmtpRegex, (match, existingParams) => {
        let updated = existingParams;
        if (!/useinbandfec=/i.test(updated)) updated += ';useinbandfec=1';
        if (!/usedtx=/i.test(updated)) updated += ';usedtx=1';
        if (!/maxaveragebitrate=/i.test(updated)) updated += ';maxaveragebitrate=32000';
        if (!/stereo=/i.test(updated)) updated += ';stereo=0';
        return `a=fmtp:${pt} ${updated}`;
      });
    } else {
      return sdp.replace(
        new RegExp(`(a=rtpmap:${pt}\\s+opus\\/48000\\/2[\\r\\n]+)`, 'i'),
        `$1a=fmtp:${pt} ${opusParams}\r\n`
      );
    }
  } catch (e) {
    console.warn('[WebRTC Service] Could not optimize SDP:', e.message);
    return sdp;
  }
}

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
              autoGainControl: true,
              sampleRate: 48000,
              channelCount: 1
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
   * Attach local stream tracks to the peer connection safely without duplicates
   */
  addStreamTracks: (pc, stream) => {
    if (!pc || !stream) return;
    try {
      const existingSenders = typeof pc.getSenders === 'function' ? pc.getSenders() : [];
      stream.getTracks().forEach((track) => {
        try {
          const alreadyAdded = existingSenders.some(
            (s) => s.track && (s.track.id === track.id || s.track.kind === track.kind)
          );
          if (!alreadyAdded) {
            pc.addTrack(track, stream);
            console.log('[WebRTC Service] Added local track to peer connection:', track.kind);
          } else {
            console.log('[WebRTC Service] Track already attached to peer connection:', track.kind);
          }
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
   * Create and set local answer SDP with Opus optimization (returns clean plain object for socket serialization)
   */
  createAnswer: async (pc) => {
    if (!pc) throw new Error('PeerConnection is not initialized');
    try {
      const answer = await pc.createAnswer();
      const optimizedSdp = optimizeOpusSDP(answer.sdp);
      const optimizedAnswer = new RTCSessionDescription({
        type: answer.type || 'answer',
        sdp: optimizedSdp
      });
      await pc.setLocalDescription(optimizedAnswer);
      console.log('[WebRTC Service] Created and set optimized local answer SDP');
      return {
        type: optimizedAnswer.type,
        sdp: optimizedAnswer.sdp
      };
    } catch (err) {
      console.error('[WebRTC Service] Failed to create answer:', err);
      throw err;
    }
  },

  /**
   * Create and set local offer SDP with Opus optimization (returns clean plain object for socket serialization)
   */
  createOffer: async (pc, options = {}) => {
    if (!pc) throw new Error('PeerConnection is not initialized');
    try {
      const offer = await pc.createOffer(options);
      const optimizedSdp = optimizeOpusSDP(offer.sdp);
      const optimizedOffer = new RTCSessionDescription({
        type: offer.type || 'offer',
        sdp: optimizedSdp
      });
      await pc.setLocalDescription(optimizedOffer);
      console.log('[WebRTC Service] Created and set optimized local offer SDP');
      return {
        type: optimizedOffer.type,
        sdp: optimizedOffer.sdp
      };
    } catch (err) {
      console.error('[WebRTC Service] Failed to create offer:', err);
      throw err;
    }
  },

  /**
   * Add ICE Candidate received from remote peer with cross-platform sanitization
   */
  addIceCandidate: async (pc, candidateInit) => {
    if (!pc || !candidateInit) return;
    try {
      // Handle both flat and nested candidate objects safely
      const rawCand = (typeof candidateInit === 'object' && candidateInit.candidate !== undefined)
        ? (typeof candidateInit.candidate === 'object' && candidateInit.candidate !== null ? candidateInit.candidate.candidate : candidateInit.candidate)
        : candidateInit;

      if (!rawCand || typeof rawCand !== 'string' || rawCand.trim() === '') {
        console.log('[WebRTC Service] Skipping empty/end-of-candidates candidate');
        return;
      }

      const sdpMid = candidateInit.sdpMid !== undefined
        ? candidateInit.sdpMid
        : (candidateInit.candidate?.sdpMid || '0');

      const rawIndex = candidateInit.sdpMLineIndex !== undefined
        ? candidateInit.sdpMLineIndex
        : candidateInit.candidate?.sdpMLineIndex;

      const sdpMLineIndex = (rawIndex !== null && rawIndex !== undefined && !isNaN(parseInt(rawIndex, 10)))
        ? parseInt(rawIndex, 10)
        : 0;

      const candidate = new RTCIceCandidate({
        candidate: rawCand,
        sdpMid: String(sdpMid),
        sdpMLineIndex: sdpMLineIndex
      });

      await pc.addIceCandidate(candidate);
      console.log('[WebRTC Service] Added remote ICE candidate successfully');
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
  },

  /**
   * Dynamically fetch and update ICE servers (including TURNS Port 443 TLS) from backend
   */
  fetchIceServers: async (baseUrl) => {
    try {
      if (!baseUrl) return RTC_CONFIG.iceServers;
      const url = `${baseUrl.replace(/\/$/, '')}/api/calls/ice-servers`;
      const res = await fetch(url);
      const json = await res.json();
      if (json && json.success && Array.isArray(json.iceServers) && json.iceServers.length > 0) {
        RTC_CONFIG.iceServers = json.iceServers;
        console.log('[WebRTC Service] Updated dynamic ICE servers from backend:', json.iceServers.length);
        return json.iceServers;
      }
    } catch (e) {
      console.warn('[WebRTC Service] Could not fetch remote ICE servers, using built-in UAE TURNS config:', e.message);
    }
    return RTC_CONFIG.iceServers;
  },

  setIceServers: (servers) => {
    if (Array.isArray(servers) && servers.length > 0) {
      RTC_CONFIG.iceServers = servers;
    }
  }
};

export default webrtcService;
