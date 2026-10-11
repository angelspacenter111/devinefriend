import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { useAdminCall } from '../context/AdminCallContext';

export const AdminHeader = () => {
  const { user } = useAuth();
  const { isOnline, toggleOnlinePresence } = useAdminCall();

  return (
    <View style={styles.container}>
      <View style={styles.brandRow}>
        <View style={styles.logoBadge}>
          <Ionicons name="shield-checkmark" size={20} color="#fff" />
        </View>
        <View>
          <Text style={styles.brandTitle}>Friend Admin</Text>
          <Text style={styles.brandSubtitle}>
            {user?.name || 'Administrator'} • Companion Console
          </Text>
        </View>
      </View>

      {/* Online/Offline Toggle */}
      <View style={styles.presenceToggle}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: isOnline ? COLORS.success : COLORS.textMuted }
          ]}
        />
        <Text style={[styles.statusText, { color: isOnline ? COLORS.success : COLORS.textMuted }]}>
          {isOnline ? 'Online' : 'Offline'}
        </Text>
        <Switch
          value={isOnline}
          onValueChange={toggleOnlinePresence}
          trackColor={{ false: COLORS.surfaceLight, true: 'rgba(16, 185, 129, 0.4)' }}
          thumbColor={isOnline ? COLORS.success : '#94a3b8'}
          style={styles.switch}
        />
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
    alignItems: 'center',
    gap: 10
  },
  logoBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: COLORS.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.secondary
  },
  brandTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: 0.3
  },
  brandSubtitle: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 1
  },
  presenceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    gap: 6
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700'
  },
  switch: {
    transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }]
  }
});

export default AdminHeader;
