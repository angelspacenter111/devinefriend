import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';
import { useCall } from '../../context/CallContext';

export const CallScreen = ({ onNavigateWallet }) => {
  const { user } = useAuth();
  const { advisorStatus, startCall } = useCall();
  const [isStarting, setIsStarting] = useState(false);

  const handleStartCall = async () => {
    if ((user?.credits ?? 0) < 1) {
      Alert.alert(
        'Insufficient Credits',
        'You need at least 1 credit to start a call. Please add credits to your wallet.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add Credits', onPress: onNavigateWallet }
        ]
      );
      return;
    }

    try {
      setIsStarting(true);
      await startCall('Voice');
    } catch (err) {
      Alert.alert('Call Failed', err.message || 'Could not initiate voice call.');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Call Header Card */}
      <View style={styles.headerCard}>
        <View style={styles.advisorAvatar}>
          <Ionicons name="headset" size={44} color="#fff" />
          <View
            style={[
              styles.onlineDot,
              { backgroundColor: advisorStatus.online ? COLORS.success : COLORS.textMuted }
            ]}
          />
        </View>

        <Text style={styles.advisorRole}>Compassionate Voice Companion</Text>
        <Text style={styles.advisorStatusText}>
          {advisorStatus.online
            ? '🟢 Life Advisors are currently Online & Ready'
            : '⚪ Advisors may take a minute to answer'}
        </Text>

        <View style={styles.creditPill}>
          <Ionicons name="sparkles" size={14} color="#fbbf24" />
          <Text style={styles.creditPillText}>Your Balance: {user?.credits ?? 0} Credits</Text>
        </View>
      </View>

      {/* Centered Main Start Call Button */}
      <View style={styles.centerCallWrapper}>
        <View style={styles.callRingOuter}>
          <TouchableOpacity
            style={[styles.centerCallCircle, isStarting && styles.centerCallCircleDisabled]}
            onPress={handleStartCall}
            disabled={isStarting}
            activeOpacity={0.85}
          >
            {isStarting ? (
              <ActivityIndicator color="#fff" size="large" />
            ) : (
              <Ionicons name="call" size={42} color="#fff" />
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.centerCallTitle}>
          {isStarting ? 'Connecting...' : 'Tap to Start Voice Call'}
        </Text>
        <Text style={styles.centerCallSubtitle}>
          100% private, anonymous & compassionate talk
        </Text>
      </View>

      {/* Guidelines / Privacy Features */}
      <View style={styles.featuresSection}>
        <Text style={styles.featuresTitle}>What to Expect</Text>

        <View style={styles.featureItem}>
          <View style={styles.featureIcon}>
            <Ionicons name="shield-checkmark" size={20} color="#10b981" />
          </View>
          <View style={styles.featureText}>
            <Text style={styles.featureHeading}>100% Anonymous & Confidential</Text>
            <Text style={styles.featureBody}>
              Your identity and conversations remain strictly private and safe.
            </Text>
          </View>
        </View>

        <View style={styles.featureItem}>
          <View style={styles.featureIcon}>
            <Ionicons name="ear" size={20} color={COLORS.primaryLight} />
          </View>
          <View style={styles.featureText}>
            <Text style={styles.featureHeading}>Empathetic & Non-judgmental</Text>
            <Text style={styles.featureBody}>
              Share work stress, relationship troubles, loneliness, or personal worries.
            </Text>
          </View>
        </View>

        <View style={styles.featureItem}>
          <View style={styles.featureIcon}>
            <Ionicons name="card" size={20} color="#fbbf24" />
          </View>
          <View style={styles.featureText}>
            <Text style={styles.featureHeading}>Pay-per-minute Flexibility</Text>
            <Text style={styles.featureBody}>
              1 credit per minute. End anytime with zero recurring commitments.
            </Text>
          </View>
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
    padding: 20,
    paddingBottom: 40
  },
  headerCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    marginBottom: 20
  },
  advisorAvatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: COLORS.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: COLORS.primaryLight,
    position: 'relative',
    marginBottom: 16
  },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: COLORS.surface
  },
  advisorRole: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center'
  },
  advisorStatusText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 6,
    textAlign: 'center'
  },
  creditPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.background,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 14
  },
  creditPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fbbf24'
  },
  centerCallWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 20
  },
  callRingOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(16, 185, 129, 0.35)'
  },
  centerCallCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: COLORS.success,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8
  },
  centerCallCircleDisabled: {
    opacity: 0.7
  },
  centerCallTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 14,
    textAlign: 'center'
  },
  centerCallSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
    textAlign: 'center'
  },
  featuresSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  featuresTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 16
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2
  },
  featureText: {
    flex: 1
  },
  featureHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text
  },
  featureBody: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
    lineHeight: 16
  }
});

export default CallScreen;
