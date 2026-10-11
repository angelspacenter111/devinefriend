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
import { useAdminCall } from '../context/AdminCallContext';

export const IncomingCallModal = () => {
  const { incomingCall, acceptCall, rejectCall } = useAdminCall();

  const waveAnim1 = useRef(new Animated.Value(1)).current;
  const waveAnim2 = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (incomingCall) {
      Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(waveAnim1, {
              toValue: 1.45,
              duration: 1100,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true
            }),
            Animated.timing(waveAnim1, {
              toValue: 1,
              duration: 1100,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true
            })
          ]),
          Animated.sequence([
            Animated.timing(waveAnim2, {
              toValue: 1.25,
              duration: 1100,
              delay: 300,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true
            }),
            Animated.timing(waveAnim2, {
              toValue: 1,
              duration: 1100,
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
  }, [incomingCall]);

  if (!incomingCall) return null;

  return (
    <Modal
      visible={!!incomingCall}
      animationType="slide"
      transparent={false}
      onRequestClose={rejectCall}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0b141b" />
      <View style={styles.container}>
        {/* Top Status */}
        <View style={styles.topBar}>
          <View style={styles.securityBadge}>
            <Ionicons name="lock-closed" size={13} color="#25d366" />
            <Text style={styles.securityText}>End-to-end encrypted</Text>
          </View>
          <Text style={styles.callTypeLabel}>WhatsApp Voice Call</Text>
        </View>

        {/* Center Pulsing Caller Avatar */}
        <View style={styles.centerSection}>
          <Text style={styles.callerName}>{incomingCall.callerName || 'Member'}</Text>
          {incomingCall.callerMobile ? (
            <Text style={styles.callerMobileText}>{incomingCall.callerMobile}</Text>
          ) : null}
          <Text style={styles.ringingSub}>
            Incoming {incomingCall.callType || 'Voice'} Call...
          </Text>

          <View style={styles.wavesContainer}>
            {/* Outer Green Wave */}
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

            {/* Inner Green Wave */}
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

            {/* Main Avatar */}
            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={68} color="#cfd8dc" />
            </View>
          </View>
        </View>

        {/* Bottom Actions: Accept & Decline in WhatsApp Call Style */}
        <View style={styles.bottomSection}>
          <View style={styles.actionsRow}>
            {/* Decline Button (Red) */}
            <View style={styles.actionBtnCol}>
              <TouchableOpacity
                style={styles.declineBtn}
                onPress={() => rejectCall(incomingCall)}
                activeOpacity={0.8}
              >
                <Ionicons name="call" size={32} color="#fff" style={styles.declineIcon} />
              </TouchableOpacity>
              <Text style={styles.btnLabel}>Decline</Text>
            </View>

            {/* Accept Button (Green) */}
            <View style={styles.actionBtnCol}>
              <TouchableOpacity
                style={styles.acceptBtn}
                onPress={() => acceptCall(incomingCall)}
                activeOpacity={0.8}
              >
                <Ionicons name="call" size={34} color="#fff" />
              </TouchableOpacity>
              <Text style={[styles.btnLabel, styles.acceptBtnLabel]}>Accept</Text>
            </View>
          </View>

          <Text style={styles.helperText}>
            Tap Accept to connect two-way audio with {incomingCall.callerName || 'the caller'}
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
    paddingVertical: 50,
    paddingHorizontal: 24
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
    alignItems: 'center'
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
  ringingSub: {
    fontSize: 15,
    color: '#25d366',
    marginTop: 6,
    textAlign: 'center',
    fontWeight: '600'
  },
  wavesContainer: {
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
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
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 10
  },
  bottomSection: {
    alignItems: 'center'
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 20,
    marginBottom: 20
  },
  actionBtnCol: {
    alignItems: 'center',
    gap: 8
  },
  declineBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#ea0038',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ea0038',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6
  },
  declineIcon: {
    transform: [{ rotate: '135deg' }]
  },
  acceptBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#25d366',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#25d366',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6
  },
  btnLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8696a0'
  },
  acceptBtnLabel: {
    color: '#25d366'
  },
  helperText: {
    fontSize: 11,
    color: '#8696a0',
    textAlign: 'center'
  }
});

export default IncomingCallModal;
