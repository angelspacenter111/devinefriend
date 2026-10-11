import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';

export const AdvisorCard = ({ advisorStatus, onCallPress, disabled }) => {
  const isOnline = advisorStatus?.online;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={26} color="#fff" />
          </View>
          <View
            style={[
              styles.onlineBadge,
              { backgroundColor: isOnline ? COLORS.success : COLORS.textMuted }
            ]}
          />
        </View>

        <View style={styles.info}>
          <Text style={styles.title}>Compassionate Life Companion</Text>
          <Text style={styles.status}>
            {isOnline ? '🟢 Available for immediate voice talk' : '⚪ Advisor currently away / on call'}
          </Text>
        </View>
      </View>

      <Text style={styles.description}>
        Feel free to share what’s on your mind. A safe, 100% confidential listening space with zero judgment.
      </Text>

      <TouchableOpacity
        style={[styles.callBtn, !isOnline && styles.callBtnOffline, disabled && styles.callBtnDisabled]}
        onPress={onCallPress}
        disabled={disabled}
      >
        <Ionicons name="call" size={18} color="#fff" />
        <Text style={styles.callBtnText}>
          {isOnline ? 'Start Voice Conversation' : 'Call Advisor (May take longer)'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.25)',
    marginVertical: 14
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 14
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.primaryLight
  },
  onlineBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: COLORS.surface
  },
  info: {
    flex: 1
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text
  },
  status: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  description: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: 16
  },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.success,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4
  },
  callBtnOffline: {
    backgroundColor: COLORS.primary
  },
  callBtnDisabled: {
    opacity: 0.6
  },
  callBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700'
  }
});

export default AdvisorCard;
