import React, { createContext, useState, useEffect, useRef, useContext } from 'react';
import { Vibration, Platform } from 'react-native';
import socketService from '../services/socketService';
import callService from '../services/callService';
import webrtcService from '../services/webrtcService';
import { getServerUrl } from '../config/api';
import { useAuth } from './AuthContext';

const CallContext = createContext();

export const CallProvider = ({ children }) => {
  const { user, updateUserCredits, refreshUser } = useAuth();

  const [advisorStatus, setAdvisorStatus] = useState({
    online: false,
    count: 0,
    statusText: 'All advisors offline'
  });

  const [activeCall, setActiveCall] = useState(null); // { callId, roomId, status, startTime, receiverName }
  const [callDuration, setCallDuration] = useState(0); // in seconds
  const [callPhase, setCallPhase] = useState('idle'); // 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'declined' | 'ended'
  const [callStatusText, setCallStatusText] = useState('Calling...');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [callSummary, setCallSummary] = useState(null); // { duration, creditsUsed, remainingCredits }
  const [isCallingModalVisible, setIsCallingModalVisible] = useState(false);

  const timerRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const targetPeerIdRef = useRef(null);
  const activeCallRef = useRef(null);
  const iceQueueRef = useRef([]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  const cleanupWebRTC = () => {
    console.log('[CallContext] Cleaning up WebRTC...');
    if (Platform.OS !== 'web') {
      try {
        Vibration.cancel();
      } catch (e) {}
    }
    webrtcService.cleanup({
      pc: peerConnectionRef.current,
      localStream: localStreamRef.current
    });
    peerConnectionRef.current = null;
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    targetPeerIdRef.current = null;
    iceQueueRef.current = [];
  };

  // Initialize socket and listen to advisor presence
  useEffect(() => {
    webrtcService.fetchIceServers(getServerUrl()).catch(() => {});
    const socket = socketService.connect();

    const handleAdvisorStatus = (data) => {
      if (data) {
        setAdvisorStatus({
          online: !!data.online,
          count: data.count || 0,
          statusText: data.online ? `${data.count} Advisor(s) Online` : 'Advisors Currently Offline'
        });
      }
    };

    socketService.on('advisor-status', handleAdvisorStatus);

    callService.getAdvisorStatus()
      .then((res) => {
        if (res && res.data) {
          handleAdvisorStatus(res.data);
        }
      })
      .catch(() => {});

    return () => {
      socketService.off('advisor-status', handleAdvisorStatus);
    };
  }, []);

  // Socket listeners for active call events
  useEffect(() => {
    if (!activeCall) return;

    // 0. Recipient device acknowledged ringing (WhatsApp style)
    const handleCallPlaced = () => {
      console.log('[CallContext] Call placed on server');
      setCallPhase('calling');
      setCallStatusText('Calling...');
    };

    const handleCallRinging = () => {
      console.log('[CallContext] 🔔 Advisor device is ringing');
      setCallPhase('ringing');
      setCallStatusText('Ringing...');

      // Gentle pulsating vibration for caller ringing feedback
      if (Platform.OS !== 'web') {
        try {
          Vibration.vibrate([0, 400, 1600], true);
        } catch (e) {}
      }
    };

    // 1. Advisor accepted call: start WebRTC negotiation as Caller (Initiator)
    const handlePeerConnected = async (data) => {
      console.log('[CallContext] 📞 Advisor accepted call. Starting WebRTC offer:', data.adminId);
      if (Platform.OS !== 'web') {
        try {
          Vibration.cancel();
        } catch (e) {}
      }

      setCallPhase('connecting');
      setCallStatusText('Connecting...');
      const targetId = data.adminId;
      targetPeerIdRef.current = targetId;

      // Coordinate direct P2P mesh with high-priority TURNS on Port 443
      socketService.emit('switch-to-p2p', { callId: activeCallRef.current?.callId });

      try {
        const pc = webrtcService.createPeerConnection({
          onIceCandidate: (candidateData) => {
            if (targetPeerIdRef.current) {
              socketService.emit('send-candidate', {
                candidate: candidateData,
                targetId: targetPeerIdRef.current,
                callId: activeCallRef.current?.callId
              });
            }
          },
          onTrack: (remoteStream, track) => {
            console.log('[CallContext] Received remote audio track from advisor:', track?.kind);
            remoteStreamRef.current = remoteStream;
          },
          onConnectionStateChange: (state) => {
            console.log('[CallContext] Connection state:', state);
            if (state === 'connected') {
              setCallPhase('connected');
              setCallStatusText('In Conversation');
              startTimer();
              socketService.emit('call-connected', {
                callId: activeCallRef.current?.callId
              });
            } else if (state === 'disconnected' || state === 'failed') {
              setCallStatusText('Connection Interrupted');
            }
          }
        });

        peerConnectionRef.current = pc;

        // Get microphone stream
        const stream = await webrtcService.getUserMedia({
          audio: true,
          video: false
        });
        localStreamRef.current = stream;
        webrtcService.addStreamTracks(pc, stream);

        // Create WebRTC Offer
        const offer = await webrtcService.createOffer(pc);

        // Send Offer to Advisor
        socketService.emit('send-offer', {
          offer,
          targetId,
          callId: activeCallRef.current?.callId
        });
        console.log('[CallContext] WebRTC offer sent to advisor:', targetId);
      } catch (err) {
        console.error('[CallContext] WebRTC caller negotiation failed:', err);
        setCallStatusText('Mic permission or WebRTC error');
      }
    };

    // 2. Receive WebRTC Answer from Advisor
    const handleReceiveAnswer = async (data) => {
      console.log('[CallContext] Received WebRTC Answer from advisor:', data.senderId);
      const pc = peerConnectionRef.current;
      if (pc && data.answer) {
        try {
          await webrtcService.setRemoteDescription(pc, data.answer);

          // Flush any queued ICE candidates
          if (iceQueueRef.current.length > 0) {
            console.log(`[CallContext] Flushing ${iceQueueRef.current.length} queued candidates`);
            for (const cand of iceQueueRef.current) {
              await webrtcService.addIceCandidate(pc, cand);
            }
            iceQueueRef.current = [];
          }
        } catch (err) {
          console.error('[CallContext] Error setting remote description from answer:', err);
        }
      }
    };

    // 3. Receive ICE candidate from Advisor
    const handleReceiveCandidate = async (data) => {
      if (!data || !data.candidate) return;
      const pc = peerConnectionRef.current;
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        await webrtcService.addIceCandidate(pc, data.candidate);
      } else {
        iceQueueRef.current.push(data.candidate);
      }
    };

    const handleCallActive = () => {
      setCallPhase('connected');
      setCallStatusText('In Conversation');
      startTimer();
    };

    const handleCallRejected = (data) => {
      if (Platform.OS !== 'web') {
        try {
          Vibration.cancel();
        } catch (e) {}
      }
      setCallPhase('declined');
      setCallStatusText(data?.reason || 'Call Declined');
      setTimeout(() => {
        endCall('Declined');
      }, 1600);
    };

    const handlePeerDisconnected = (data) => {
      // If disconnected without explicit hangup (transient network glitch), do not drop immediately
      const isExplicit = data && (data.explicit || data.reason === 'Completed' || data.reason === 'Cancelled' || data.reason === 'Missed' || data.reason === 'Rejected' || data.reason === 'User Ended Call' || data.reason === 'Admin Ended Call');
      if (!isExplicit && data?.reason === 'Disconnected') {
        console.log('[CallContext] Peer disconnected transiently, waiting for reconnect...');
        setCallStatusText('Reconnecting...');
        return;
      }
      if (Platform.OS !== 'web') {
        try {
          Vibration.cancel();
        } catch (e) {}
      }
      setCallPhase('ended');
      setCallStatusText('Call Ended');
      setTimeout(() => {
        endCall(data?.reason || 'Peer Disconnected');
      }, 1200);
    };

    const handleCallFinalized = (data) => {
      if (data && data.remainingCredits !== undefined) {
        updateUserCredits(data.remainingCredits);
      }
    };

    socketService.on('call-placed', handleCallPlaced);
    socketService.on('call-ringing', handleCallRinging);
    socketService.on('peer-connected', handlePeerConnected);
    socketService.on('receive-answer', handleReceiveAnswer);
    socketService.on('receive-candidate', handleReceiveCandidate);
    socketService.on('call-active', handleCallActive);
    socketService.on('call-rejected', handleCallRejected);
    socketService.on('peer-disconnected', handlePeerDisconnected);
    socketService.on('call-finalized', handleCallFinalized);

    return () => {
      socketService.off('call-placed', handleCallPlaced);
      socketService.off('call-ringing', handleCallRinging);
      socketService.off('peer-connected', handlePeerConnected);
      socketService.off('receive-answer', handleReceiveAnswer);
      socketService.off('receive-candidate', handleReceiveCandidate);
      socketService.off('call-active', handleCallActive);
      socketService.off('call-rejected', handleCallRejected);
      socketService.off('peer-disconnected', handlePeerDisconnected);
      socketService.off('call-finalized', handleCallFinalized);
    };
  }, [activeCall]);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCallDuration(0);
    timerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startCall = async (callType = 'Voice') => {
    if (!user) throw new Error('Please log in first.');
    if (user.credits < 1) {
      const err = new Error('You need at least 1 credit to start a call. Please recharge your wallet.');
      err.code = 'LOW_CREDITS';
      throw err;
    }

    try {
      setCallPhase('calling');
      setCallStatusText('Calling...');
      setIsCallingModalVisible(true);

      const res = await callService.initiateCall(callType);
      const callData = res.call;

      setActiveCall(callData);
      activeCallRef.current = callData;

      // Join socket call room & notify admin presence
      socketService.joinCallRoom({
        callId: callData.callId,
        userId: user.id || user._id,
        userName: user.name,
        callType
      });

      return callData;
    } catch (err) {
      setIsCallingModalVisible(false);
      cleanupWebRTC();
      throw err;
    }
  };

  const endCall = async (reason = 'Completed') => {
    stopTimer();
    cleanupWebRTC();

    if (!activeCall) {
      setIsCallingModalVisible(false);
      setCallPhase('idle');
      return;
    }

    const currentCallId = activeCall.callId;

    // Emit hangup event via socket
    socketService.hangup({
      callId: currentCallId,
      reason
    });

    try {
      const res = await callService.endCall(currentCallId, reason);
      const data = res.data;

      if (data) {
        setCallSummary({
          callId: data.callId,
          duration: data.duration || formatTimer(callDuration),
          durationSeconds: data.durationSeconds || callDuration,
          creditsDeducted: data.creditsDeducted || 0,
          remainingCredits: data.remainingCredits
        });

        if (data.remainingCredits !== undefined) {
          updateUserCredits(data.remainingCredits);
        }
      }
    } catch (err) {
      console.warn('[CallContext] Error during endCall API:', err.message);
    } finally {
      setActiveCall(null);
      activeCallRef.current = null;
      setIsCallingModalVisible(false);
      setCallPhase('idle');
      refreshUser();
    }
  };

  const dismissSummary = () => {
    setCallSummary(null);
  };

  const toggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      webrtcService.setAudioMute(localStreamRef.current, next);
      return next;
    });
  };

  const toggleSpeaker = () => {
    setIsSpeakerOn((prev) => {
      const next = !prev;
      webrtcService.setSpeakerphone(localStreamRef.current, next);
      return next;
    });
  };

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <CallContext.Provider
      value={{
        advisorStatus,
        activeCall,
        callDuration,
        callPhase,
        formattedDuration: formatTimer(callDuration),
        callStatusText,
        isMuted,
        isSpeakerOn,
        callSummary,
        isCallingModalVisible,
        startCall,
        endCall,
        toggleMute,
        toggleSpeaker,
        dismissSummary
      }}
    >
      {children}
    </CallContext.Provider>
  );
};

export const useCall = () => useContext(CallContext);
export default CallContext;
