import React, { createContext, useState, useEffect, useRef, useContext } from 'react';
import { Vibration, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import socketService from '../services/socketService';
import webrtcService from '../services/webrtcService';
import notificationService from '../services/notificationService';
import { useAuth } from './AuthContext';

const AdminCallContext = createContext();

export const AdminCallProvider = ({ children }) => {
  const { user } = useAuth(); // Logged-in admin user

  const [isOnline, setIsOnline] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null); // { callId, callerId, callerName, userId, roomId }
  const [activeCall, setActiveCall] = useState(null);     // { callId, callerName, roomId, startTime }
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
  const iceQueueRef = useRef([]);
  const acquiringMediaRef = useRef(null);

  // Keep activeCallRef in sync
  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

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

  // Safe single-flight microphone acquisition
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
        console.log('[AdminCallContext] Requesting microphone permission & stream...');
        const stream = await webrtcService.getUserMedia({
          audio: true,
          video: false
        });
        localStreamRef.current = stream;
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

    const pc = webrtcService.createPeerConnection({
      onIceCandidate: (candidateData) => {
        const target = peerIdRef.current || targetPeerId;
        if (target) {
          socketService.emit('send-candidate', {
            candidate: candidateData,
            targetId: target,
            callId: activeCallRef.current?.callId
          });
        }
      },
      onTrack: (remoteStream, track) => {
        console.log('[AdminCallContext] Remote track received:', track?.kind);
        remoteStreamRef.current = remoteStream;
      },
      onConnectionStateChange: (state) => {
        console.log('[AdminCallContext] WebRTC connectionState:', state);
        if (state === 'connected') {
          setCallPhase('connected');
          setCallStatusText('In Conversation');
          startTimer();
          socketService.emit('call-connected', {
            callId: activeCallRef.current?.callId
          });
        } else if (state === 'disconnected' || state === 'failed') {
          setCallStatusText('Connection Interrupted');
        } else if (state === 'closed') {
          setCallPhase('ended');
          setCallStatusText('Call Ended');
        }
      }
    });

    peerConnectionRef.current = pc;
    return pc;
  };

  // Register Admin presence, push notifications, and listen for calls
  useEffect(() => {
    if (!user || user.role !== 'admin') return;

    // 1. Register Push Notifications on Device & sync token with backend
    notificationService.registerForPushNotifications();

    // 2. Connect to socket signaling
    const socket = socketService.connect();

    const registerPresence = () => {
      socketService.emit('admin-join', {
        adminId: user.id || user._id,
        adminName: user.name || 'Advisor Admin',
        role: 'admin'
      });
      setIsOnline(true);
      console.log(`[AdminCallContext] Registered as Admin on Socket`);
    };

    if (socketService.isConnected) {
      registerPresence();
    } else {
      socketService.on('connect', registerPresence);
    }

    // 3. Listen for Incoming Call Alerts (via Socket)
    const handleIncomingCall = (data) => {
      if (activeCallRef.current) return;
      console.log(`[AdminCallContext] 📞 INCOMING CALL ALERT:`, data);

      // Notify caller device that advisor phone is ringing (WhatsApp style ringback)
      socketService.emit('client-ringing', { callId: data.callId });

      setCallPhase('incoming');
      setIncomingCall({
        callId: data.callId,
        callerId: data.callerId,
        callerName: data.callerName || 'Friend Member',
        userId: data.userId,
        roomId: data.roomId || data.callId,
        callType: data.callType || 'Voice'
      });

      // Show local notification with sound & action buttons (if app is running/background)
      notificationService.showLocalCallNotification(data);

      // Start ringing vibration
      if (Platform.OS !== 'web') {
        try {
          Vibration.vibrate([1000, 1000, 1000, 1000], true);
        } catch (vibErr) {
          console.warn('[AdminCallContext] Vibration error:', vibErr);
        }
      }
    };

    // 4. Caller cancelled before answer
    const handleCallCancelled = (data) => {
      console.log(`[AdminCallContext] Call was cancelled:`, data);
      stopRinging();
      cleanupWebRTC();
      setIncomingCall(null);
      setCallPhase('idle');
    };

    // 5. Peer disconnected during call
    const handlePeerDisconnected = (data) => {
      console.log(`[AdminCallContext] Caller hung up / disconnected.`);
      endActiveCall('Caller Disconnected');
    };

    // 6. WebRTC call active notification from server
    const handleCallActive = (data) => {
      setCallPhase('connected');
      setCallStatusText('In Conversation');
      startTimer();
    };

    // 7. Handle WebRTC Offer from Caller
    const handleReceiveOffer = async (data) => {
      console.log('[AdminCallContext] ⚡ Received WebRTC Offer from caller:', data.senderId);
      const senderId = data.senderId;
      peerIdRef.current = senderId;

      try {
        let pc = peerConnectionRef.current;
        if (!pc) {
          pc = setupPeerConnection(senderId);
        }

        // Safely acquire microphone stream (prevents concurrent race conditions)
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
        socketService.emit('send-answer', {
          answer,
          targetId: senderId,
          callId: activeCallRef.current?.callId
        });
        console.log('[AdminCallContext] ✅ Sent WebRTC Answer back to caller:', senderId);
      } catch (offerErr) {
        console.error('[AdminCallContext] Failed to handle WebRTC offer:', offerErr);
      }
    };

    // 8. Handle ICE Candidates from Caller
    const handleReceiveCandidate = async (data) => {
      if (!data || !data.candidate) return;
      const pc = peerConnectionRef.current;
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        await webrtcService.addIceCandidate(pc, data.candidate);
      } else {
        iceQueueRef.current.push(data.candidate);
      }
    };

    socketService.on('incoming-call-alert', handleIncomingCall);
    socketService.on('call-cancelled', handleCallCancelled);
    socketService.on('peer-disconnected', handlePeerDisconnected);
    socketService.on('call-active', handleCallActive);
    socketService.on('receive-offer', handleReceiveOffer);
    socketService.on('receive-candidate', handleReceiveCandidate);

    // 9. Listen for Push Notifications when app is woken up from background / running
    const notifReceivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification?.request?.content?.data;
      if (data?.type === 'INCOMING_CALL' && !activeCallRef.current) {
        console.log('[AdminCallContext] Received INCOMING_CALL Push Notification in foreground/background:', data);
        handleIncomingCall(data);
      } else if (data?.type === 'CALL_CANCELLED') {
        handleCallCancelled(data);
      }
    });

    // 10. Listen for User tapping Notification or Action Buttons (🟢 Accept / 🔴 Decline)
    const notifResponseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data;
      const actionId = response?.actionIdentifier;
      console.log('[AdminCallContext] User interacted with Notification action:', actionId, data);

      notificationService.dismissCallNotifications();

      if (data?.type === 'INCOMING_CALL') {
        if (actionId === 'ACCEPT_CALL') {
          acceptCall(data);
        } else if (actionId === 'DECLINE_CALL') {
          rejectCall(data);
        } else {
          // User clicked notification banner - show full incoming call modal
          handleIncomingCall(data);
        }
      }
    });

    // 11. Check if App was COLD STARTED directly by tapping an incoming call notification while closed
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        const data = response?.notification?.request?.content?.data;
        const actionId = response?.actionIdentifier;
        console.log('[AdminCallContext] Cold start from closed state via Notification:', actionId, data);

        if (data?.type === 'INCOMING_CALL' && !activeCallRef.current) {
          notificationService.dismissCallNotifications();
          if (actionId === 'ACCEPT_CALL') {
            acceptCall(data);
          } else if (actionId === 'DECLINE_CALL') {
            rejectCall(data);
          } else {
            // Tapped notification banner on cold start: show incoming call ringing modal
            handleIncomingCall(data);
          }
        }
      }
    }).catch(() => {});

    return () => {
      socketService.off('incoming-call-alert', handleIncomingCall);
      socketService.off('call-cancelled', handleCallCancelled);
      socketService.off('peer-disconnected', handlePeerDisconnected);
      socketService.off('call-active', handleCallActive);
      socketService.off('receive-offer', handleReceiveOffer);
      socketService.off('receive-candidate', handleReceiveCandidate);
      notifReceivedSub.remove();
      notifResponseSub.remove();
      stopRinging();
      cleanupWebRTC();
    };
  }, [user]);

  const stopRinging = () => {
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

  // ACCEPT INCOMING CALL (can accept incomingCall state or callData from Push notification)
  const acceptCall = async (callDataOverride) => {
    const callData = callDataOverride || incomingCall;
    if (!callData) return;

    stopRinging();

    setIncomingCall(null);
    setActiveCall(callData);
    activeCallRef.current = callData;
    peerIdRef.current = callData.callerId;
    setCallPhase('connecting');
    setCallStatusText('Connecting to caller audio...');

    // Make sure socket is connected and join room
    const socket = socketService.connect();

    const sendAccept = () => {
      socketService.emit('admin-join', {
        adminId: user?.id || user?._id,
        adminName: user?.name || 'Life Advisor',
        role: 'admin'
      });
      socketService.emit('admin-accept-call', {
        callId: callData.callId,
        adminId: user?.id || user?._id,
        adminName: user?.name || 'Life Advisor',
        callerId: callData.callerId
      });
      console.log(`[AdminCallContext] Emitted admin-accept-call for ${callData.callId}`);
    };

    if (socketService.isConnected && socket && socket.connected) {
      sendAccept();
    } else if (socket) {
      socket.once('connect', sendAccept);
    }

    // Initialize local WebRTC & Microphone right away
    try {
      const pc = setupPeerConnection(callData.callerId);
      await acquireMicrophoneStream(pc);
      console.log('[AdminCallContext] Microphone ready for incoming WebRTC offer');
    } catch (err) {
      console.error('[AdminCallContext] Error acquiring microphone during accept:', err);
      setCallStatusText('Microphone permission needed');
    }
  };

  // REJECT INCOMING CALL
  const rejectCall = (callDataOverride) => {
    const callData = callDataOverride || incomingCall;
    if (!callData) return;

    stopRinging();
    cleanupWebRTC();

    socketService.emit('admin-reject-call', {
      callId: callData.callId,
      callerId: callData.callerId
    });

    setIncomingCall(null);
    setCallPhase('idle');
  };

  // END ACTIVE CALL
  const endActiveCall = (reason = 'Completed') => {
    stopTimer();
    stopRinging();
    cleanupWebRTC();

    if (activeCall) {
      socketService.emit('hangup', {
        callId: activeCall.callId,
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
      socketService.emit('admin-join', {
        adminId: user?.id || user?._id,
        adminName: user?.name || 'Advisor Admin',
        role: 'admin'
      });
    }
  };

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

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
