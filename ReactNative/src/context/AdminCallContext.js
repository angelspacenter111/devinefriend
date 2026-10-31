import React, { createContext, useState, useEffect, useRef, useContext } from 'react';
import { Vibration, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import socketService from '../services/socketService';
import webrtcService from '../services/webrtcService';
import notificationService from '../services/notificationService';
import ringtoneService from '../services/ringtoneService';
import { getServerUrl } from '../config/api';
import { useAuth } from './AuthContext';

const AdminCallContext = createContext();

export const AdminCallProvider = ({ children }) => {
  const { user } = useAuth(); // Logged-in admin user

  const [isOnline, setIsOnline] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null); // { callId, callerId, callerName, callerMobile, userId, roomId }
  const [activeCall, setActiveCall] = useState(null);     // { callId, callerName, callerMobile, roomId, startTime }
  const [callDuration, setCallDuration] = useState(0);    // duration in seconds
  const [callPhase, setCallPhase] = useState('idle');     // 'idle' | 'incoming' | 'connecting' | 'connected' | 'ended'
  const [callStatusText, setCallStatusText] = useState('Connecting...');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);

  const timerRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const peerIdRef = useRef(null);
  const activeCallRef = useRef(null);
  const incomingCallRef = useRef(null);
  const iceQueueRef = useRef([]);
  const acquiringMediaRef = useRef(null);

  // Keep refs in sync
  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  // Clean WebRTC resources safely
  const cleanupWebRTC = () => {
    console.log('[AdminCallContext] Cleaning up WebRTC...');
    webrtcService.cleanup({
      pc: peerConnectionRef.current,
      localStream: localStreamRef.current
    });
    peerConnectionRef.current = null;
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    peerIdRef.current = null;
    iceQueueRef.current = [];
    acquiringMediaRef.current = null;
  };

  // Safe single-flight microphone acquisition with auto-speaker
  const acquireMicrophoneStream = async (pc) => {
    if (localStreamRef.current) {
      if (pc) webrtcService.addStreamTracks(pc, localStreamRef.current);
      return localStreamRef.current;
    }

    if (acquiringMediaRef.current) {
      const stream = await acquiringMediaRef.current;
      if (pc && stream) webrtcService.addStreamTracks(pc, stream);
      return stream;
    }

    acquiringMediaRef.current = (async () => {
      try {
        console.log('[AdminCallContext] Requesting microphone stream...');
        const stream = await webrtcService.getUserMedia({
          audio: true,
          video: false
        });
        localStreamRef.current = stream;

        // Auto-enable speakerphone so caller is heard loud and clear
        webrtcService.setSpeakerphone(stream, true);
        setIsSpeakerOn(true);

        if (pc) {
          webrtcService.addStreamTracks(pc, stream);
        }
        return stream;
      } catch (micErr) {
        console.error('[AdminCallContext] Microphone permission error:', micErr);
        setCallStatusText('Microphone permission required');
        throw micErr;
      } finally {
        acquiringMediaRef.current = null;
      }
    })();

    return acquiringMediaRef.current;
  };

  // Helper: Create peer connection and bind callbacks
  const setupPeerConnection = (targetPeerId) => {
    if (peerConnectionRef.current) {
      return peerConnectionRef.current;
    }

    console.log('[AdminCallContext] Initializing PeerConnection for target:', targetPeerId);
    const pc = webrtcService.createPeerConnection({
      onIceCandidate: (candidateData) => {
        const target = peerIdRef.current || targetPeerId;
        const currentCallId = activeCallRef.current?.callId;
        socketService.emit('send-candidate', {
          candidate: candidateData,
          targetId: target,
          callId: currentCallId
        });
      },
      onTrack: (remoteStream, track) => {
        console.log('[AdminCallContext] Remote track received:', track?.kind);
        remoteStreamRef.current = remoteStream;
      },
      onConnectionStateChange: (state) => {
        console.log('[AdminCallContext] WebRTC connectionState changed to:', state);
        if (state === 'connected') {
          setCallPhase('connected');
          setCallStatusText('In Conversation');
          startTimer();
          socketService.emit('call-connected', {
            callId: activeCallRef.current?.callId
          });
        } else if (state === 'disconnected') {
          setCallStatusText('Reconnecting...');
        } else if (state === 'failed') {
          setCallStatusText('Connection Failed');
        } else if (state === 'closed') {
          setCallPhase('ended');
          setCallStatusText('Call Ended');
        }
      }
    });

    peerConnectionRef.current = pc;
    return pc;
  };

  const stopRinging = () => {
    ringtoneService.stopRingtone();
    notificationService.dismissCallNotifications();
    if (Platform.OS !== 'web') {
      try {
        Vibration.cancel();
      } catch (vibErr) {
        console.warn('[AdminCallContext] Vibration cancel error:', vibErr);
      }
    }
  };

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

  // Get Admin identity (uses AuthContext user or AsyncStorage fallback)
  const getAdminIdentity = async () => {
    if (user && (user.id || user._id)) {
      return {
        id: user.id || user._id,
        name: user.name || 'Ashu'
      };
    }
    try {
      const stored = await AsyncStorage.getItem('@auth_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && (parsed.id || parsed._id)) {
          return {
            id: parsed.id || parsed._id,
            name: parsed.name || 'Ashu'
          };
        }
      }
    } catch (e) {}
    return { id: 'admin_master', name: 'Ashu' };
  };

  // Helper to handle incoming call data from socket or push
  const handleIncomingCall = (data) => {
    if (!data || !data.callId) return;
    if (activeCallRef.current) {
      console.log('[AdminCallContext] Ignoring incoming call, already in active call:', activeCallRef.current.callId);
      return;
    }

    console.log(`[AdminCallContext] 📞 INCOMING CALL:`, data);

    // Notify caller that phone is ringing
    socketService.emit('client-ringing', { callId: data.callId });

    const callInfo = {
      callId: data.callId,
      callerId: data.callerId,
      callerName: data.callerName || 'Member',
      callerMobile: data.callerMobile || '',
      userId: data.userId,
      roomId: data.roomId || data.callId,
      callType: data.callType || 'Voice'
    };

    setCallPhase('incoming');
    setIncomingCall(callInfo);

    // Play loud incoming call ringtone
    ringtoneService.startRingtone();

    // Show local notification banner
    notificationService.showLocalCallNotification(callInfo);

    // Ringing vibration
    if (Platform.OS !== 'web') {
      try {
        Vibration.vibrate([1000, 1000, 1000, 1000], true);
      } catch (vibErr) {
        console.warn('[AdminCallContext] Vibration error:', vibErr);
      }
    }
  };

  const handleCallCancelled = (data) => {
    console.log(`[AdminCallContext] Call was cancelled:`, data);
    stopRinging();
    cleanupWebRTC();
    setIncomingCall(null);
    setCallPhase('idle');
  };

  const handlePeerDisconnected = (data) => {
    const isExplicit = data && (data.explicit || data.reason === 'Completed' || data.reason === 'Cancelled' || data.reason === 'Missed' || data.reason === 'Rejected' || data.reason === 'User Ended Call' || data.reason === 'Admin Ended Call');
    if (!isExplicit && data?.reason === 'Disconnected') {
      console.log(`[AdminCallContext] Caller temporarily disconnected, waiting for reconnect...`);
      return;
    }
    console.log(`[AdminCallContext] Caller explicitly ended the call.`);
    endActiveCall(data?.reason || 'Caller Disconnected');
  };

  const handleCallActive = (data) => {
    console.log(`[AdminCallContext] Call is active on server:`, data);
    setCallPhase('connected');
    setCallStatusText('In Conversation');
    startTimer();
    if (data?.callerName) {
      setActiveCall((prev) => (prev ? { ...prev, callerName: data.callerName } : prev));
    }
  };

  // Handle WebRTC SDP Offer from Caller
  const handleReceiveOffer = async (data) => {
    console.log('[AdminCallContext] ⚡ Received WebRTC Offer from caller:', data.senderId);
    const senderId = data.senderId;
    peerIdRef.current = senderId;

    try {
      let pc = peerConnectionRef.current;
      if (!pc) {
        pc = setupPeerConnection(senderId);
      }

      // If PC is in an incompatible signaling state, re-init
      if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
        console.warn(`[AdminCallContext] Unexpected signalingState: ${pc.signalingState}. Re-initializing PC...`);
        cleanupWebRTC();
        pc = setupPeerConnection(senderId);
      }

      // Safely acquire microphone stream
      await acquireMicrophoneStream(pc);

      // Set remote SDP description (Caller's Offer)
      await webrtcService.setRemoteDescription(pc, data.offer);

      // Process any queued ICE candidates
      if (iceQueueRef.current.length > 0) {
        console.log(`[AdminCallContext] Flushing ${iceQueueRef.current.length} queued ICE candidates`);
        for (const cand of iceQueueRef.current) {
          await webrtcService.addIceCandidate(pc, cand);
        }
        iceQueueRef.current = [];
      }

      // Generate Answer
      const answer = await webrtcService.createAnswer(pc);

      // Emit Answer back to caller via signaling server
      const currentCallId = activeCallRef.current?.callId || data.callId;
      socketService.emit('send-answer', {
        answer,
        targetId: senderId,
        callId: currentCallId
      });
      console.log('[AdminCallContext] ✅ Sent WebRTC Answer back to caller:', senderId);
    } catch (offerErr) {
      console.error('[AdminCallContext] Failed to handle WebRTC offer:', offerErr);
    }
  };

  // Handle ICE Candidates from Caller
  const handleReceiveCandidate = async (data) => {
    if (!data || !data.candidate) return;
    const pc = peerConnectionRef.current;
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      await webrtcService.addIceCandidate(pc, data.candidate);
    } else {
      iceQueueRef.current.push(data.candidate);
    }
  };

  // ACCEPT INCOMING CALL
  // NOTE: Handles synthetic React Native gesture event objects safely!
  const acceptCall = async (callDataOverride) => {
    const rawData =
      callDataOverride && typeof callDataOverride === 'object' && callDataOverride.callId
        ? callDataOverride
        : incomingCallRef.current;

    if (!rawData || !rawData.callId) {
      console.warn('[AdminCallContext] Cannot accept call: no valid call data found.', rawData);
      return;
    }

    console.log('[AdminCallContext] 🟢 Accepting call:', rawData.callId, 'Caller:', rawData.callerName);
    stopRinging();

    const callPayload = {
      callId: rawData.callId,
      callerId: rawData.callerId,
      callerName: rawData.callerName || 'Member',
      callerMobile: rawData.callerMobile || '',
      userId: rawData.userId,
      roomId: rawData.roomId || rawData.callId,
      callType: rawData.callType || 'Voice'
    };

    setIncomingCall(null);
    setActiveCall(callPayload);
    activeCallRef.current = callPayload;
    peerIdRef.current = rawData.callerId;
    setCallPhase('connecting');
    setCallStatusText('Connecting to caller audio...');

    // Get Admin Identity
    const adminIdentity = await getAdminIdentity();

    // Ensure socket is connected and join room
    socketService.connect();

    const sendAccept = () => {
      socketService.emit('switch-to-p2p', { callId: callPayload.callId });
      socketService.emit('admin-join', {
        adminId: adminIdentity.id,
        adminName: adminIdentity.name,
        role: 'admin'
      });
      socketService.emit('admin-accept-call', {
        callId: callPayload.callId,
        adminId: adminIdentity.id,
        adminName: adminIdentity.name,
        callerId: callPayload.callerId,
        callType: callPayload.callType
      });
      console.log(`[AdminCallContext] Emitted admin-accept-call for ${callPayload.callId}`);
    };

    if (socketService.isConnected) {
      sendAccept();
    } else {
      socketService.on('connect', sendAccept);
    }

    // Initialize local WebRTC & Microphone immediately
    try {
      const pc = setupPeerConnection(callPayload.callerId);
      await acquireMicrophoneStream(pc);
      console.log('[AdminCallContext] Microphone ready for incoming WebRTC offer');
    } catch (err) {
      console.error('[AdminCallContext] Error acquiring microphone during accept:', err);
      setCallStatusText('Microphone permission needed');
    }
  };

  // REJECT INCOMING CALL
  const rejectCall = (callDataOverride) => {
    const rawData =
      callDataOverride && typeof callDataOverride === 'object' && callDataOverride.callId
        ? callDataOverride
        : incomingCallRef.current;

    stopRinging();
    cleanupWebRTC();

    if (rawData && rawData.callId) {
      socketService.emit('admin-reject-call', {
        callId: rawData.callId,
        callerId: rawData.callerId
      });
    }

    setIncomingCall(null);
    setCallPhase('idle');
  };

  // END ACTIVE CALL
  const endActiveCall = (reason = 'Completed') => {
    stopTimer();
    stopRinging();
    cleanupWebRTC();

    if (activeCallRef.current) {
      socketService.emit('hangup', {
        callId: activeCallRef.current.callId,
        reason
      });
    }

    setActiveCall(null);
    activeCallRef.current = null;
    setCallDuration(0);
    setCallPhase('idle');
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

  const toggleOnlinePresence = (status) => {
    setIsOnline(status);
    if (status) {
      getAdminIdentity().then((adminIdentity) => {
        socketService.emit('admin-join', {
          adminId: adminIdentity.id,
          adminName: adminIdentity.name,
          role: 'admin'
        });
      });
    }
  };

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 1. GLOBAL NOTIFICATION HANDLING (Runs on Mount, Handles Background & Closed App Cold Starts)
  useEffect(() => {
    notificationService.init();
    webrtcService.fetchIceServers(getServerUrl()).catch(() => {});

    // Check cold start from closed app notification tap
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        const data = response?.notification?.request?.content?.data;
        const actionId = response?.actionIdentifier;
        console.log('[AdminCallContext] Cold-start notification response detected:', actionId, data);

        if (data?.type === 'INCOMING_CALL' && !activeCallRef.current) {
          notificationService.dismissCallNotifications();
          if (actionId === 'ACCEPT_CALL') {
            acceptCall(data);
          } else if (actionId === 'DECLINE_CALL') {
            rejectCall(data);
          } else {
            // Tapped notification banner: Open Incoming Call Modal
            handleIncomingCall(data);
          }
        }
      }
    }).catch((e) => console.warn('[AdminCallContext] getLastNotificationResponse error:', e));

    // Foreground / Background push received
    const notifReceivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification?.request?.content?.data;
      if (data?.type === 'INCOMING_CALL' && !activeCallRef.current) {
        console.log('[AdminCallContext] Foreground/background push received:', data);
        handleIncomingCall(data);
      } else if (data?.type === 'CALL_CANCELLED') {
        handleCallCancelled(data);
      }
    });

    // User interaction with notification (banner tap or action buttons)
    const notifResponseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data;
      const actionId = response?.actionIdentifier;
      console.log('[AdminCallContext] Notification interacted:', actionId, data);

      notificationService.dismissCallNotifications();

      if (data?.type === 'INCOMING_CALL') {
        if (actionId === 'ACCEPT_CALL') {
          acceptCall(data);
        } else if (actionId === 'DECLINE_CALL') {
          rejectCall(data);
        } else {
          // Banner tapped: Open WhatsApp incoming call modal
          handleIncomingCall(data);
        }
      }
    });

    return () => {
      notifReceivedSub.remove();
      notifResponseSub.remove();
    };
  }, []);

  // 2. SOCKET SIGNALING & PRESENCE MANAGEMENT
  useEffect(() => {
    // Connect to signaling
    socketService.connect();

    // Register presence whenever admin is known
    getAdminIdentity().then((adminIdentity) => {
      const registerPresence = () => {
        socketService.emit('admin-join', {
          adminId: adminIdentity.id,
          adminName: adminIdentity.name,
          role: 'admin'
        });
        setIsOnline(true);
        console.log(`[AdminCallContext] Registered Admin presence on socket: ${adminIdentity.name}`);
      };

      if (socketService.isConnected) {
        registerPresence();
      } else {
        socketService.on('connect', registerPresence);
      }
    });

    // Socket listeners
    socketService.on('incoming-call-alert', handleIncomingCall);
    socketService.on('call-cancelled', handleCallCancelled);
    socketService.on('peer-disconnected', handlePeerDisconnected);
    socketService.on('call-active', handleCallActive);
    socketService.on('receive-offer', handleReceiveOffer);
    socketService.on('receive-candidate', handleReceiveCandidate);

    // Verified caller details from server
    socketService.on('call-accepted-ack', (data) => {
      if (data && data.callerName) {
        console.log('[AdminCallContext] Received verified caller details from server:', data);
        setActiveCall((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            callerName: data.callerName || prev.callerName,
            callerMobile: data.callerMobile || prev.callerMobile
          };
        });
      }
    });

    return () => {
      socketService.off('incoming-call-alert', handleIncomingCall);
      socketService.off('call-cancelled', handleCallCancelled);
      socketService.off('peer-disconnected', handlePeerDisconnected);
      socketService.off('call-active', handleCallActive);
      socketService.off('receive-offer', handleReceiveOffer);
      socketService.off('receive-candidate', handleReceiveCandidate);
      socketService.off('call-accepted-ack');
      stopRinging();
      cleanupWebRTC();
    };
  }, [user]);

  return (
    <AdminCallContext.Provider
      value={{
        isOnline,
        incomingCall,
        activeCall,
        callDuration,
        callPhase,
        formattedDuration: formatTimer(callDuration),
        callStatusText,
        isMuted,
        isSpeakerOn,
        acceptCall,
        rejectCall,
        endActiveCall,
        toggleMute,
        toggleSpeaker,
        toggleOnlinePresence
      }}
    >
      {children}
    </AdminCallContext.Provider>
  );
};

export const useAdminCall = () => useContext(AdminCallContext);
export default AdminCallContext;
