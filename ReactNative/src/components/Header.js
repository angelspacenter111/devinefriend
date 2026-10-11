import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';

export const Header = ({ onProfilePress, onWalletPress }) => {
  const { user } = useAuth();
  const { advisorStatus } = useCall();

  return (
    <View style={styles.container}>
      <View style={styles.brandRow}>
        <View style={styles.logoBadge}>
          <Ionicons name="heart" size={20} color="#fff" />
        </View>
        <View>
          <Text style={styles.brandTitle}>Friend</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: advisorStatus.online ? COLORS.success : COLORS.textMuted }
              ]}
            />
            <Text style={styles.statusText}>
              {advisorStatus.online ? 'Advisor Online' : 'Advisor Offline'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.rightActions}>
        <TouchableOpacity style={styles.creditPill} onPress={onWalletPress}>
          <Ionicons name="sparkles" size={15} color="#fbbf24" />
          <Text style={styles.creditText}>{user?.credits ?? 0}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.avatarBtn} onPress={onProfilePress}>
          <Text style={styles.avatarInitials}>
            {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceLight
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  logoBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.5
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6
  },
  statusText: {
    fontSize: 11,
    color: COLORS.textSecondary
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  creditPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#374151',
    gap: 5
  },
  creditText: {
    color: '#fbbf24',
    fontSize: 13,
    fontWeight: '700'
  },
  avatarBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.primaryLight
  },
  avatarInitials: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 14
  }
});

export default Header;
