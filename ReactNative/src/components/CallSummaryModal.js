import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';
import { useCall } from '../context/CallContext';

export const CallSummaryModal = () => {
  const { callSummary, dismissSummary } = useCall();

  if (!callSummary) return null;

  return (
    <Modal
      visible={!!callSummary}
      transparent
      animationType="fade"
      onRequestClose={dismissSummary}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Ionicons name="checkmark-done" size={32} color="#10b981" />
          </View>

          <Text style={styles.title}>Call Completed</Text>
          <Text style={styles.subtitle}>
            We hope this conversation brought peace to your heart.
          </Text>

          <View style={styles.summaryContainer}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Call Duration</Text>
              <Text style={styles.summaryValue}>{callSummary.duration || '00:00'}</Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Credits Deducted</Text>
              <Text style={[styles.summaryValue, { color: COLORS.accent }]}>
                -{callSummary.creditsDeducted} Credits
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Remaining Balance</Text>
              <Text style={[styles.summaryValue, { color: '#fbbf24' }]}>
                {callSummary.remainingCredits} Credits
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.doneBtn}
            onPress={dismissSummary}
            activeOpacity={0.8}
          >
            <Text style={styles.doneBtnText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  card: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)'
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18
  },
  summaryContainer: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    marginBottom: 20
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  summaryLabel: {
    fontSize: 13,
    color: COLORS.textSecondary
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text
  },
  doneBtn: {
    width: '100%',
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center'
  },
  doneBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700'
  }
});

export default CallSummaryModal;
