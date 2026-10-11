import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAdminCall } from '../context/AdminCallContext';

export const AdminActiveCallModal = () => {
  const {
    activeCall,
    formattedDuration,
    callStatusText,
    isMuted,
    isSpeakerOn,
    toggleMute,
    toggleSpeaker,
    endActiveCall
  } = useAdminCall();

  if (!activeCall) return null;

  return (
    <Modal
      visible={!!activeCall}
      animationType="fade"
      transparent={false}
      onRequestClose={() => endActiveCall('Completed by Advisor')}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0b141b" />
      <View style={styles.container}>
        {/* Top Info */}
        <View style={styles.topBar}>
          <View style={styles.securityBadge}>
            <Ionicons name="lock-closed" size={13} color="#25d366" />
            <Text style={styles.securityText}>End-to-end encrypted</Text>
          </View>
          <Text style={styles.callTypeLabel}>WhatsApp {activeCall.callType || 'Voice'} Call</Text>
        </View>

        {/* Center Caller Info & Timer */}
        <View style={styles.centerSection}>
          <Text style={styles.callerName}>{activeCall.callerName || 'Member'}</Text>
          {activeCall.callerMobile ? (
            <Text style={styles.callerMobileText}>{activeCall.callerMobile}</Text>
          ) : null}
          <Text style={styles.timer}>{formattedDuration || '00:00'}</Text>

          <View style={styles.avatarCircle}>
            <Ionicons name="person" size={68} color="#cfd8dc" />
          </View>

          <Text style={styles.statusText}>{callStatusText}</Text>
        </View>

        {/* Bottom Floating Control Dock */}
        <View style={styles.bottomDockWrapper}>
          <View style={styles.bottomDock}>
            {/* Speaker Toggle */}
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

            {/* Hangup / End Call Button */}
            <TouchableOpacity
              style={styles.hangupBtn}
              onPress={() => endActiveCall('Completed')}
              activeOpacity={0.8}
            >
              <Ionicons name="call" size={34} color="#fff" style={styles.hangupIcon} />
            </TouchableOpacity>

            {/* Mute Toggle */}
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
            End call anytime. Duration and credits calculate automatically.
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b141b',
    justifyContent: 'space-between',
    paddingVertical: 45,
    paddingHorizontal: 20
  },
  topBar: {
    alignItems: 'center',
    gap: 4
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(37, 211, 102, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(37, 211, 102, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14
  },
  securityText: {
    color: '#25d366',
    fontSize: 12,
    fontWeight: '600'
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
  callerName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#e9edef',
    textAlign: 'center',
    letterSpacing: 0.4
  },
  callerMobileText: {
    fontSize: 14,
    color: '#8696a0',
    marginTop: 4,
    textAlign: 'center',
    fontWeight: '500'
  },
  timer: {
    fontSize: 22,
    fontWeight: '700',
    color: '#25d366',
    marginTop: 8,
    letterSpacing: 1.5
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
    elevation: 8,
    marginTop: 35
  },
  statusText: {
    fontSize: 14,
    color: '#8696a0',
    marginTop: 18,
    fontWeight: '500'
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

export default AdminActiveCallModal;
