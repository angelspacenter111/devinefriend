import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  StatusBar
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCall } from '../context/CallContext';

export const CallModal = () => {
  const {
    activeCall,
    callPhase,
    formattedDuration,
    callStatusText,
    isMuted,
    isSpeakerOn,
    isCallingModalVisible,
    endCall,
    toggleMute,
    toggleSpeaker
  } = useCall();

  const waveAnim1 = useRef(new Animated.Value(1)).current;
  const waveAnim2 = useRef(new Animated.Value(1)).current;

  const isRingingOrCalling = callPhase === 'calling' || callPhase === 'ringing';

  useEffect(() => {
    if (isCallingModalVisible && isRingingOrCalling) {
      Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(waveAnim1, {
              toValue: 1.45,
              duration: 1200,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true
            }),
            Animated.timing(waveAnim1, {
              toValue: 1,
              duration: 1200,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true
            })
          ]),
          Animated.sequence([
            Animated.timing(waveAnim2, {
              toValue: 1.25,
              duration: 1200,
              delay: 350,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true
            }),
            Animated.timing(waveAnim2, {
              toValue: 1,
              duration: 1200,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true
            })
          ])
        ])
      ).start();
    } else {
      waveAnim1.setValue(1);
      waveAnim2.setValue(1);
    }
  }, [isCallingModalVisible, isRingingOrCalling]);

  if (!isCallingModalVisible) return null;

  // Derive WhatsApp call status string
  const renderStatus = () => {
    if (callPhase === 'connected') {
      return formattedDuration;
    }
    if (callPhase === 'ringing') {
      return 'Ringing...';
    }
    if (callPhase === 'connecting') {
      return 'Connecting...';
    }
    if (callPhase === 'declined') {
      return 'Call Declined';
    }
    if (callPhase === 'ended') {
      return 'Call Ended';
    }
    return callStatusText || 'Calling...';
  };

  return (
    <Modal
      visible={isCallingModalVisible}
      animationType="fade"
      transparent={false}
      onRequestClose={() => endCall('Cancelled by User')}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0b141b" />
      <View style={styles.container}>
        {/* Top Header - WhatsApp Encrypted Badge */}
        <View style={styles.topHeader}>
          <View style={styles.securityBadge}>
            <Ionicons name="lock-closed" size={13} color="#25d366" />
            <Text style={styles.securityText}>End-to-end encrypted</Text>
          </View>
          <Text style={styles.callTypeLabel}>WhatsApp Voice Call</Text>
        </View>

        {/* Center Contact & Rippling Avatar */}
        <View style={styles.centerSection}>
          <Text style={styles.contactName}>
            {activeCall?.receiverName || 'Life Advisor'}
          </Text>

          <Text style={[
            styles.statusLabel,
            callPhase === 'connected' && styles.statusTimer,
            callPhase === 'declined' && styles.statusDeclined
          ]}>
            {renderStatus()}
          </Text>

          {/* Avatar Waves */}
          <View style={styles.avatarContainer}>
            {isRingingOrCalling && (
              <>
                <Animated.View
                  style={[
                    styles.pulseWaveOuter,
                    {
                      transform: [{ scale: waveAnim1 }],
                      opacity: waveAnim1.interpolate({
                        inputRange: [1, 1.45],
                        outputRange: [0.35, 0.05]
                      })
                    }
                  ]}
                />
                <Animated.View
                  style={[
                    styles.pulseWaveInner,
                    {
                      transform: [{ scale: waveAnim2 }],
                      opacity: waveAnim2.interpolate({
                        inputRange: [1, 1.25],
                        outputRange: [0.55, 0.15]
                      })
                    }
                  ]}
                />
              </>
            )}

            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={68} color="#cfd8dc" />
            </View>
          </View>
        </View>

        {/* Bottom Floating Control Dock */}
        <View style={styles.bottomDockWrapper}>
          <View style={styles.bottomDock}>
            {/* Speakerphone Toggle */}
            <TouchableOpacity
              style={[
                styles.actionBtn,
                isSpeakerOn ? styles.actionBtnActiveSpeaker : styles.actionBtnDefault
              ]}
              onPress={toggleSpeaker}
              activeOpacity={0.75}
            >
              <Ionicons
                name={isSpeakerOn ? 'volume-high' : 'volume-mute'}
                size={26}
                color={isSpeakerOn ? '#111b21' : '#e9edef'}
              />
              <Text style={[
                styles.actionBtnText,
                isSpeakerOn && styles.actionBtnTextActiveSpeaker
              ]}>
                {isSpeakerOn ? 'Speaker' : 'Earpiece'}
              </Text>
            </TouchableOpacity>

            {/* End Call Button (Big Red Button) */}
            <TouchableOpacity
              style={styles.hangupBtn}
              onPress={() => endCall('Completed')}
              activeOpacity={0.8}
            >
              <Ionicons name="call" size={34} color="#fff" style={styles.hangupIcon} />
            </TouchableOpacity>

            {/* Microphone Mute Toggle */}
            <TouchableOpacity
              style={[
                styles.actionBtn,
                isMuted ? styles.actionBtnMuted : styles.actionBtnDefault
              ]}
              onPress={toggleMute}
              activeOpacity={0.75}
            >
              <Ionicons
                name={isMuted ? 'mic-off' : 'mic'}
                size={26}
                color={isMuted ? '#ea0038' : '#e9edef'}
              />
              <Text style={[
                styles.actionBtnText,
                isMuted && styles.actionBtnTextMuted
              ]}>
                {isMuted ? 'Muted' : 'Mute'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.encryptionNotice}>
            Private high-definition voice call • 1 Credit/min
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b141b', // WhatsApp Dark Calling screen background
    justifyContent: 'space-between',
    paddingVertical: 45,
    paddingHorizontal: 20
  },
  topHeader: {
    alignItems: 'center',
    gap: 4
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(37, 211, 102, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(37, 211, 102, 0.25)'
  },
  securityText: {
    color: '#25d366',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3
  },
  callTypeLabel: {
    color: '#8696a0',
    fontSize: 13,
    marginTop: 4
  },
  centerSection: {
    alignItems: 'center',
    marginVertical: 20
  },
  contactName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#e9edef',
    textAlign: 'center',
    letterSpacing: 0.4
  },
  statusLabel: {
    fontSize: 16,
    color: '#8696a0',
    marginTop: 8,
    fontWeight: '500'
  },
  statusTimer: {
    color: '#25d366',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 6
  },
  statusDeclined: {
    color: '#ea0038',
    fontWeight: '700'
  },
  avatarContainer: {
    position: 'relative',
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 35
  },
  pulseWaveOuter: {
    position: 'absolute',
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: 'rgba(37, 211, 102, 0.35)'
  },
  pulseWaveInner: {
    position: 'absolute',
    width: 175,
    height: 175,
    borderRadius: 87.5,
    backgroundColor: 'rgba(37, 211, 102, 0.5)'
  },
  avatarCircle: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: '#1f2c34',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#2a3942',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8
  },
  bottomDockWrapper: {
    alignItems: 'center',
    width: '100%'
  },
  bottomDock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    backgroundColor: '#111b21',
    borderRadius: 36,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#202c33',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6
  },
  actionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 62,
    height: 62,
    borderRadius: 31
  },
  actionBtnDefault: {
    backgroundColor: '#202c33'
  },
  actionBtnActiveSpeaker: {
    backgroundColor: '#25d366'
  },
  actionBtnMuted: {
    backgroundColor: 'rgba(234, 0, 56, 0.15)',
    borderWidth: 1,
    borderColor: '#ea0038'
  },
  actionBtnText: {
    fontSize: 10,
    color: '#8696a0',
    marginTop: 4,
    fontWeight: '600'
  },
  actionBtnTextActiveSpeaker: {
    color: '#111b21',
    fontWeight: '700'
  },
  actionBtnTextMuted: {
    color: '#ea0038',
    fontWeight: '700'
  },
  hangupBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ea0038',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ea0038',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8
  },
  hangupIcon: {
    transform: [{ rotate: '135deg' }]
  },
  encryptionNotice: {
    color: '#8696a0',
    fontSize: 11,
    marginTop: 18,
    textAlign: 'center'
  }
});

export default CallModal;
