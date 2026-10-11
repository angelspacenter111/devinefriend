import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';

export const PlanCard = ({ plan, onSelect, isSelected }) => {
  const perMinute = Math.round(plan.price / plan.credits);

  return (
    <TouchableOpacity
      style={[
        styles.card,
        plan.isPopular && styles.popularCard,
        isSelected && styles.selectedCard
      ]}
      onPress={() => onSelect(plan)}
      activeOpacity={0.8}
    >
      {plan.badge ? (
        <View style={[styles.badge, plan.isPopular && styles.popularBadge]}>
          <Text style={styles.badgeText}>{plan.badge}</Text>
        </View>
      ) : null}

      <View style={styles.topRow}>
        <View>
          <Text style={styles.planName}>{plan.name}</Text>
          <Text style={styles.planDesc}>{plan.description}</Text>
        </View>
        <View style={styles.priceContainer}>
          <Text style={styles.priceText}>AED {plan.price}</Text>
          <Text style={styles.perMinuteText}>~AED {perMinute}/min</Text>
        </View>
      </View>

      <View style={styles.bottomRow}>
        <View style={styles.creditInfo}>
          <Ionicons name="sparkles" size={16} color="#fbbf24" />
          <Text style={styles.creditText}>{plan.credits} Voice Credits</Text>
        </View>

        <View style={[styles.selectBtn, isSelected && styles.selectBtnActive]}>
          <Text style={[styles.selectBtnText, isSelected && styles.selectBtnTextActive]}>
            {isSelected ? 'Selected' : 'Choose Plan'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginVertical: 8,
    borderWidth: 1.5,
    borderColor: COLORS.surfaceLight,
    position: 'relative'
  },
  popularCard: {
    borderColor: COLORS.primary
  },
  selectedCard: {
    borderColor: '#38bdf8',
    backgroundColor: '#1e293b'
  },
  badge: {
    position: 'absolute',
    top: -10,
    right: 16,
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 12
  },
  popularBadge: {
    backgroundColor: COLORS.primary
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12
  },
  planName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text
  },
  planDesc: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
    maxWidth: 200
  },
  priceContainer: {
    alignItems: 'flex-end'
  },
  priceText: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text
  },
  perMinuteText: {
    fontSize: 11,
    color: COLORS.textSecondary
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceLight
  },
  creditInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  creditText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fbbf24'
  },
  selectBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceLight
  },
  selectBtnActive: {
    backgroundColor: '#38bdf8'
  },
  selectBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text
  },
  selectBtnTextActive: {
    color: '#0f172a',
    fontWeight: '700'
  }
});

export default PlanCard;
