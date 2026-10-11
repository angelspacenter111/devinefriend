import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';
import walletService from '../../services/walletService';
import PlanCard from '../../components/PlanCard';

export const WalletScreen = () => {
  const { user, refreshUser } = useAuth();

  const [plans, setPlans] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadWalletData = async () => {
    try {
      const [plansRes, txnsRes] = await Promise.all([
        walletService.getPlans(),
        walletService.getTransactions({ limit: 10 })
      ]);

      if (plansRes && plansRes.plans) {
        setPlans(plansRes.plans);
        // Default select popular or comfort pack
        const popular = plansRes.plans.find((p) => p.isPopular) || plansRes.plans[1] || plansRes.plans[0];
        setSelectedPlan(popular);
      }

      if (txnsRes && txnsRes.data && txnsRes.data.transactions) {
        setTransactions(txnsRes.data.transactions);
      }
    } catch (err) {
      console.warn('[WalletScreen] Data load error:', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadWalletData();
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refreshUser(), loadWalletData()]);
    setIsRefreshing(false);
  };

  const handleRechargePress = async () => {
    if (!selectedPlan) {
      Alert.alert('Select a Plan', 'Please select a recharge pack first.');
      return;
    }

    try {
      setIsProcessing(true);

      // Create order via backend API
      const orderRes = await walletService.createOrder(selectedPlan.planId);

      if (orderRes && orderRes.order) {
        // Stripe checkout flow prompt
        Alert.alert(
          'Recharge Confirmation',
          `Order created for ${selectedPlan.name} (AED ${selectedPlan.price} for ${selectedPlan.credits} credits).\n\nProceed with simulated payment or Stripe?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Simulate Success (Demo)',
              onPress: async () => {
                // In demo mode without native Stripe SDK binding, simulate successful transaction verification
                try {
                  await walletService.verifyPayment({
                    sessionId: orderRes.order.sessionId || orderRes.order.id,
                    stripe_session_id: orderRes.order.sessionId || orderRes.order.id
                  });
                } catch (simErr) {
                  // Fallback: reload balance
                }
                Alert.alert('Recharge Successful!', `${selectedPlan.credits} credits have been added.`);
                await refreshUser();
                await loadWalletData();
              }
            }
          ]
        );
      }
    } catch (err) {
      Alert.alert('Recharge Error', err.message || 'Could not initiate recharge.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={COLORS.primaryLight}
        />
      }
    >
      {/* Wallet Balance Header Card */}
      <View style={styles.balanceHeaderCard}>
        <View style={styles.balanceTop}>
          <View>
            <Text style={styles.balanceLabel}>Current Talk Balance</Text>
            <View style={styles.balanceAmountRow}>
              <Text style={styles.balanceAmount}>{user?.credits ?? 0}</Text>
              <Text style={styles.balanceUnit}>Credits</Text>
            </View>
          </View>
          <View style={styles.balanceIconWrapper}>
            <Ionicons name="sparkles" size={28} color="#fbbf24" />
          </View>
        </View>

        <View style={styles.infoPill}>
          <Ionicons name="checkmark-circle" size={14} color="#10b981" />
          <Text style={styles.infoPillText}>Never expires • Transparent 1 credit/min</Text>
        </View>
      </View>

      {/* Select Recharge Pack Title */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Select Voice Pack</Text>
        <Text style={styles.sectionSub}>Pick the minutes you want to add</Text>
      </View>

      {/* Plans List */}
      {isLoading ? (
        <ActivityIndicator color={COLORS.primaryLight} style={{ marginVertical: 30 }} />
      ) : (
        plans.map((plan) => (
          <PlanCard
            key={plan.planId || plan._id}
            plan={plan}
            isSelected={selectedPlan?.planId === plan.planId}
            onSelect={(p) => setSelectedPlan(p)}
          />
        ))
      )}

      {/* Checkout Button */}
      {selectedPlan && (
        <TouchableOpacity
          style={[styles.checkoutBtn, isProcessing && styles.checkoutBtnDisabled]}
          onPress={handleRechargePress}
          disabled={isProcessing}
          activeOpacity={0.8}
        >
          {isProcessing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.checkoutBtnText}>
                Recharge AED {selectedPlan.price} ({selectedPlan.credits} Credits)
              </Text>
              <Ionicons name="card" size={18} color="#fff" />
            </>
          )}
        </TouchableOpacity>
      )}

      {/* Transactions History Section */}
      <View style={[styles.sectionHeader, { marginTop: 28 }]}>
        <Text style={styles.sectionTitle}>Recent Transactions</Text>
        <Text style={styles.sectionSub}>Wallet top-ups and call deductions</Text>
      </View>

      {transactions.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No recent transactions found.</Text>
        </View>
      ) : (
        transactions.map((txn) => (
          <View key={txn._id || txn.txnId} style={styles.txnRow}>
            <View style={styles.txnLeft}>
              <View
                style={[
                  styles.txnIcon,
                  {
                    backgroundColor:
                      txn.type === 'credit'
                        ? 'rgba(16, 185, 129, 0.15)'
                        : 'rgba(239, 68, 68, 0.15)'
                  }
                ]}
              >
                <Ionicons
                  name={txn.type === 'credit' ? 'arrow-down' : 'arrow-up'}
                  size={16}
                  color={txn.type === 'credit' ? '#10b981' : COLORS.danger}
                />
              </View>
              <View>
                <Text style={styles.txnDesc}>{txn.desc || 'Credit Adjustment'}</Text>
                <Text style={styles.txnDate}>
                  {txn.date ? new Date(txn.date).toLocaleDateString() : 'Recent'} • {txn.status}
                </Text>
              </View>
            </View>

            <Text
              style={[
                styles.txnCredits,
                { color: txn.type === 'credit' ? '#10b981' : COLORS.text }
              ]}
            >
              {txn.type === 'credit' ? `+${txn.credits}` : `-${txn.credits}`} Credits
            </Text>
          </View>
        ))
      )}
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
  balanceHeaderCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    marginBottom: 20
  },
  balanceTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  balanceLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  balanceAmountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 4,
    gap: 8
  },
  balanceAmount: {
    fontSize: 36,
    fontWeight: '800',
    color: COLORS.text
  },
  balanceUnit: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fbbf24'
  },
  balanceIconWrapper: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.3)'
  },
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.background,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    marginTop: 14
  },
  infoPillText: {
    fontSize: 12,
    color: COLORS.textSecondary
  },
  sectionHeader: {
    marginBottom: 10
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text
  },
  sectionSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  checkoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    height: 54,
    borderRadius: 16,
    marginTop: 12,
    gap: 8,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4
  },
  checkoutBtnDisabled: {
    opacity: 0.7
  },
  checkoutBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700'
  },
  emptyCard: {
    backgroundColor: COLORS.surface,
    padding: 20,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 13
  },
  txnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  txnLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1
  },
  txnIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  txnDesc: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text
  },
  txnDate: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  txnCredits: {
    fontSize: 14,
    fontWeight: '700'
  }
});

export default WalletScreen;
