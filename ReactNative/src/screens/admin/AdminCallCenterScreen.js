import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { useAdminCall } from '../../context/AdminCallContext';
import socketService from '../../services/socketService';

export const AdminCallCenterScreen = () => {
  const { isOnline, toggleOnlinePresence } = useAdminCall();
  const [autoAnswer, setAutoAnswer] = useState(false);
  const [ringtoneVolume, setRingtoneVolume] = useState(true);

  // Test feature: simulate an incoming call directly to verify ringing UI
  const handleTestIncomingCall = () => {
    const mockCallId = 'CALL-TEST-' + Math.floor(1000 + Math.random() * 9000);
    socketService.emit('join-call-room', {
      callId: mockCallId,
      userId: 'test_user_id',
      userName: 'Priya Sharma (Web Demo)'
    });
    Alert.alert('Simulating Call', 'Sent incoming call event. The app will ring in 1 second!');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Live Monitor Card */}
      <View style={styles.monitorCard}>
        <View style={styles.monitorHeader}>
          <View style={styles.radarCircle}>
            <Ionicons name="radio" size={32} color={isOnline ? COLORS.secondary : COLORS.textMuted} />
          </View>
          <View style={styles.monitorText}>
            <Text style={styles.monitorTitle}>Live Advisor Station</Text>
            <Text style={styles.monitorSub}>
              {isOnline ? '🟢 Connected to Socket Signaling Server' : '⚪ Disconnected / Offline'}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Accept Incoming Calls</Text>
          <Switch
            value={isOnline}
            onValueChange={toggleOnlinePresence}
            trackColor={{ false: COLORS.surfaceLight, true: 'rgba(236, 72, 153, 0.4)' }}
            thumbColor={isOnline ? COLORS.secondary : '#94a3b8'}
          />
        </View>

        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Ringing Vibration & Alerts</Text>
          <Switch
            value={ringtoneVolume}
            onValueChange={setRingtoneVolume}
            trackColor={{ false: COLORS.surfaceLight, true: 'rgba(139, 92, 246, 0.4)' }}
            thumbColor={ringtoneVolume ? COLORS.primary : '#94a3b8'}
          />
        </View>
      </View>

      {/* Test Calling Tool */}
      <View style={styles.testCard}>
        <View style={styles.testHeader}>
          <Ionicons name="sparkles" size={20} color={COLORS.secondary} />
          <Text style={styles.testTitle}>Test Incoming Ringing</Text>
        </View>
        <Text style={styles.testDesc}>
          Simulate a user initiating a call from the Web platform to verify the incoming call ringing screen.
        </Text>
        <TouchableOpacity
          style={styles.testBtn}
          onPress={handleTestIncomingCall}
          activeOpacity={0.8}
        >
          <Ionicons name="call" size={18} color="#fff" />
          <Text style={styles.testBtnText}>Simulate Web Call Ringing</Text>
        </TouchableOpacity>
      </View>

      {/* Guidelines Section */}
      <View style={styles.guidelinesCard}>
        <Text style={styles.guidelinesTitle}>Call Center Protocol</Text>

        <View style={styles.guideItem}>
          <Ionicons name="checkmark-circle" size={18} color="#10b981" />
          <Text style={styles.guideText}>
            Speak in a calm, empathetic and reassuring voice.
          </Text>
        </View>

        <View style={styles.guideItem}>
          <Ionicons name="checkmark-circle" size={18} color="#10b981" />
          <Text style={styles.guideText}>
            Keep all user disclosures 100% confidential and secure.
          </Text>
        </View>

        <View style={styles.guideItem}>
          <Ionicons name="checkmark-circle" size={18} color="#10b981" />
          <Text style={styles.guideText}>
            Never request financial credentials, OTPs, or passwords.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background
  },
  content: {
    padding: 18,
    paddingBottom: 40
  },
  monitorCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    marginBottom: 16
  },
  monitorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14
  },
  radarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(236, 72, 153, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(236, 72, 153, 0.3)'
  },
  monitorText: {
    flex: 1
  },
  monitorTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text
  },
  monitorSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 3
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.surfaceLight,
    marginVertical: 16
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8
  },
  settingLabel: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '600'
  },
  testCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(236, 72, 153, 0.3)',
    marginBottom: 16
  },
  testHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6
  },
  testTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text
  },
  testDesc: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: 16
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.secondary,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    shadowColor: COLORS.secondary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4
  },
  testBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700'
  },
  guidelinesCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  guidelinesTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 14
  },
  guideItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12
  },
  guideText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    flex: 1,
    lineHeight: 18
  }
});

export default AdminCallCenterScreen;
