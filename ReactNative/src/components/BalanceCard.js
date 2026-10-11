import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';

export const BalanceCard = ({ credits = 0, onRechargePress }) => {
  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.subtitle}>Available Balance</Text>
          <View style={styles.creditValueRow}>
            <Text style={styles.creditValue}>{credits}</Text>
            <Text style={styles.unitText}>Credits</Text>
          </View>
        </View>
        <View style={styles.iconCircle}>
          <Ionicons name="wallet-outline" size={28} color={COLORS.primaryLight} />
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.bottomRow}>
        <View style={styles.rateInfo}>
          <Ionicons name="time-outline" size={14} color={COLORS.textSecondary} />
          <Text style={styles.rateText}>1 Credit = 1 Minute Talktime</Text>
        </View>
        <TouchableOpacity style={styles.rechargeBtn} onPress={onRechargePress}>
          <Ionicons name="add-circle-outline" size={16} color="#fff" />
          <Text style={styles.rechargeBtnText}>Add Credits</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  creditValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 4,
    gap: 8
  },
  creditValue: {
    fontSize: 34,
    fontWeight: '800',
    color: COLORS.text
  },
  unitText: {
    fontSize: 16,
    color: COLORS.primaryLight,
    fontWeight: '600'
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)'
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.surfaceLight,
    marginVertical: 16
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  rateInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  rateText: {
    fontSize: 12,
    color: COLORS.textSecondary
  },
  rechargeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6
  },
  rechargeBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700'
  }
});

export default BalanceCard;
