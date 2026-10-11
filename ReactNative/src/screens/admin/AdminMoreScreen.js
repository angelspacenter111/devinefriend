import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  ActivityIndicator,
  Modal,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';
import { getServerUrl, setServerHost, ENV_SERVER_URL } from '../../config/api';
import adminService from '../../services/adminService';
import socketService from '../../services/socketService';

export const AdminMoreScreen = () => {
  const { user, logout } = useAuth();

  const [activeSection, setActiveSection] = useState('pricing'); // 'pricing' | 'transactions' | 'settings'

  // Pricing state
  const [plans, setPlans] = useState([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);
  const [isAddPlanModal, setIsAddPlanModal] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanBadge, setNewPlanBadge] = useState('');
  const [newPlanCredits, setNewPlanCredits] = useState('');
  const [newPlanPrice, setNewPlanPrice] = useState('');
  const [newPlanDesc, setNewPlanDesc] = useState('');

  // Transactions state
  const [transactions, setTransactions] = useState([]);
  const [isLoadingTxns, setIsLoadingTxns] = useState(false);

  // Server IP state
  const [serverUrl, setServerUrl] = useState(getServerUrl());
  const [isServerModal, setIsServerModal] = useState(false);
  const [inputHost, setInputHost] = useState(ENV_SERVER_URL);

  const fetchPricing = async () => {
    try {
      setIsLoadingPlans(true);
      const res = await adminService.getPricing();
      if (res && res.plans) setPlans(res.plans);
    } catch (e) {
      console.warn('[AdminMore] Pricing error:', e.message);
    } finally {
      setIsLoadingPlans(false);
    }
  };

  const fetchTransactions = async () => {
    try {
      setIsLoadingTxns(true);
      const res = await adminService.getTransactions({ limit: 20 });
      if (res && res.data && res.data.transactions) setTransactions(res.data.transactions);
    } catch (e) {
      console.warn('[AdminMore] Txns error:', e.message);
    } finally {
      setIsLoadingTxns(false);
    }
  };

  useEffect(() => {
    if (activeSection === 'pricing') fetchPricing();
    if (activeSection === 'transactions') fetchTransactions();
  }, [activeSection]);

  const handleTogglePlan = async (plan) => {
    try {
      const res = await adminService.togglePricing(plan._id);
      setPlans((prev) =>
        prev.map((p) => (p._id === plan._id ? { ...p, isActive: res.isActive } : p))
      );
    } catch (err) {
      Alert.alert('Error', 'Failed to toggle plan status.');
    }
  };

  const handleCreatePlan = async () => {
    if (!newPlanName.trim() || !newPlanCredits || !newPlanPrice) {
      Alert.alert('Validation Error', 'Name, Credits, and Price are required.');
      return;
    }

    try {
      await adminService.addPricing({
        name: newPlanName.trim(),
        badge: newPlanBadge.trim(),
        credits: parseInt(newPlanCredits, 10),
        price: parseInt(newPlanPrice, 10),
        description: newPlanDesc.trim()
      });
      setIsAddPlanModal(false);
      setNewPlanName('');
      setNewPlanBadge('');
      setNewPlanCredits('');
      setNewPlanPrice('');
      setNewPlanDesc('');
      fetchPricing();
      Alert.alert('Success', 'New pricing pack created successfully.');
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to add pack.');
    }
  };

  const handleSaveServer = async () => {
    if (!inputHost.trim()) return;
    await setServerHost(inputHost.trim());
    setServerUrl(getServerUrl());
    socketService.connect();
    setIsServerModal(false);
    Alert.alert('Updated', `Server set to: ${getServerUrl()}`);
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to log out of the Admin Console?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: logout }
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Segmented Tabs: Pricing | Transactions | Settings */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeSection === 'pricing' && styles.tabBtnActive]}
          onPress={() => setActiveSection('pricing')}
        >
          <Ionicons
            name="pricetags"
            size={16}
            color={activeSection === 'pricing' ? '#fff' : COLORS.textMuted}
          />
          <Text style={[styles.tabBtnText, activeSection === 'pricing' && styles.tabBtnTextActive]}>
            Pricing Packs
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeSection === 'transactions' && styles.tabBtnActive]}
          onPress={() => setActiveSection('transactions')}
        >
          <Ionicons
            name="receipt"
            size={16}
            color={activeSection === 'transactions' ? '#fff' : COLORS.textMuted}
          />
          <Text style={[styles.tabBtnText, activeSection === 'transactions' && styles.tabBtnTextActive]}>
            Transactions
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeSection === 'settings' && styles.tabBtnActive]}
          onPress={() => setActiveSection('settings')}
        >
          <Ionicons
            name="settings"
            size={16}
            color={activeSection === 'settings' ? '#fff' : COLORS.textMuted}
          />
          <Text style={[styles.tabBtnText, activeSection === 'settings' && styles.tabBtnTextActive]}>
            Settings
          </Text>
        </TouchableOpacity>
      </View>

      {/* SECTION 1: PRICING PACKS */}
      {activeSection === 'pricing' && (
        <View>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Manage Voice Packs</Text>
            <TouchableOpacity
              style={styles.addPackBtn}
              onPress={() => setIsAddPlanModal(true)}
            >
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.addPackBtnText}>Add Pack</Text>
            </TouchableOpacity>
          </View>

          {isLoadingPlans ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 30 }} />
          ) : (
            plans.map((p) => (
              <View key={p._id || p.planId} style={styles.planCard}>
                <View style={styles.planTop}>
                  <View>
                    <View style={styles.planBadgeRow}>
                      <Text style={styles.planName}>{p.name}</Text>
                      {p.badge ? (
                        <View style={styles.badgePill}>
                          <Text style={styles.badgeText}>{p.badge}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.planDesc}>{p.description || 'Voice talk pack'}</Text>
                  </View>

                  <View style={styles.planPriceCol}>
                    <Text style={styles.planPrice}>AED {p.price}</Text>
                    <Text style={styles.planCredits}>{p.credits} Credits</Text>
                  </View>
                </View>

                <View style={styles.planDivider} />

                <View style={styles.planBottom}>
                  <Text style={[styles.activeStatusText, { color: p.isActive ? COLORS.success : COLORS.textMuted }]}>
                    {p.isActive ? '🟢 Active on Web & App' : '⚪ Inactive (Hidden)'}
                  </Text>
                  <Switch
                    value={p.isActive}
                    onValueChange={() => handleTogglePlan(p)}
                    trackColor={{ false: COLORS.surfaceLight, true: 'rgba(16, 185, 129, 0.4)' }}
                    thumbColor={p.isActive ? COLORS.success : '#94a3b8'}
                  />
                </View>
              </View>
            ))
          )}
        </View>
      )}

      {/* SECTION 2: TRANSACTIONS */}
      {activeSection === 'transactions' && (
        <View>
          <Text style={[styles.sectionTitle, { marginBottom: 12 }]}>All Platform Transactions</Text>

          {isLoadingTxns ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 30 }} />
          ) : transactions.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No transaction records available.</Text>
            </View>
          ) : (
            transactions.map((t) => (
              <View key={t._id || t.txnId} style={styles.txnCard}>
                <View style={styles.txnLeft}>
                  <View
                    style={[
                      styles.txnIconWrap,
                      { backgroundColor: t.type === 'credit' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)' }
                    ]}
                  >
                    <Ionicons
                      name={t.type === 'credit' ? 'arrow-down' : 'arrow-up'}
                      size={16}
                      color={t.type === 'credit' ? '#10b981' : COLORS.danger}
                    />
                  </View>
                  <View>
                    <Text style={styles.txnUser}>{t.user?.name || 'User'} {t.user?.mobile ? `(+91 ${t.user.mobile})` : ''}</Text>
                    <Text style={styles.txnDesc}>{t.desc || 'Credit adjustment'}</Text>
                    <Text style={styles.txnDate}>{t.date ? new Date(t.date).toLocaleString() : ''}</Text>
                  </View>
                </View>

                <View style={styles.txnRight}>
                  <Text style={[styles.txnCredits, { color: t.type === 'credit' ? '#10b981' : COLORS.text }]}>
                    {t.type === 'credit' ? `+${t.credits}` : `-${t.credits}`} Cr
                  </Text>
                  <Text style={styles.txnAmount}>{t.amount || 'AED 0'}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      )}

      {/* SECTION 3: SETTINGS */}
      {activeSection === 'settings' && (
        <View>
          <View style={styles.profileCard}>
            <View style={styles.adminAvatar}>
              <Ionicons name="shield-checkmark" size={32} color="#fff" />
            </View>
            <Text style={styles.adminName}>{user?.name || 'Administrator'}</Text>
            <Text style={styles.adminMobile}>+91 {user?.mobile || '----------'}</Text>
            <View style={styles.adminRoleBadge}>
              <Text style={styles.adminRoleText}>SUPER ADMINISTRATOR</Text>
            </View>
          </View>

          <View style={styles.settingsSection}>
            <Text style={styles.settingsHeader}>System Settings</Text>

            <TouchableOpacity style={styles.settingItem} onPress={() => setIsServerModal(true)}>
              <View style={styles.settingLeft}>
                <Ionicons name="server-outline" size={20} color={COLORS.primaryLight} />
                <View>
                  <Text style={styles.settingLabel}>Backend Server URL</Text>
                  <Text style={styles.settingSub}>{serverUrl}</Text>
                </View>
              </View>
              <Ionicons name="pencil" size={16} color={COLORS.secondary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
            <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />
            <Text style={styles.logoutText}>Log Out from Admin Console</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Add Plan Modal */}
      <Modal visible={isAddPlanModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Pricing Pack</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Pack Name (e.g. Starter Pack)"
              placeholderTextColor={COLORS.textMuted}
              value={newPlanName}
              onChangeText={setNewPlanName}
            />

            <TextInput
              style={[styles.modalInput, { marginTop: 10 }]}
              placeholder="Badge (e.g. Popular, Best Value)"
              placeholderTextColor={COLORS.textMuted}
              value={newPlanBadge}
              onChangeText={setNewPlanBadge}
            />

            <TextInput
              style={[styles.modalInput, { marginTop: 10 }]}
              placeholder="Voice Credits (e.g. 25)"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="number-pad"
              value={newPlanCredits}
              onChangeText={setNewPlanCredits}
            />

            <TextInput
              style={[styles.modalInput, { marginTop: 10 }]}
              placeholder="Price in AED (e.g. 50)"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="number-pad"
              value={newPlanPrice}
              onChangeText={setNewPlanPrice}
            />

            <TextInput
              style={[styles.modalInput, { marginTop: 10 }]}
              placeholder="Description"
              placeholderTextColor={COLORS.textMuted}
              value={newPlanDesc}
              onChangeText={setNewPlanDesc}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setIsAddPlanModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleCreatePlan}>
                <Text style={styles.modalSaveText}>Create Pack</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Server IP Modal */}
      <Modal visible={isServerModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Backend Server Host IP</Text>
            <TextInput
              style={styles.modalInput}
              value={inputHost}
              onChangeText={setInputHost}
              placeholder="192.168.0.102"
              placeholderTextColor={COLORS.textMuted}
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setIsServerModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveServer}>
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  tabRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    padding: 4,
    borderRadius: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6
  },
  tabBtnActive: {
    backgroundColor: COLORS.primaryDark
  },
  tabBtnText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600'
  },
  tabBtnTextActive: {
    color: '#fff',
    fontWeight: '700'
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text
  },
  addPackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4
  },
  addPackBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700'
  },
  planCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  planTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start'
  },
  planBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  planName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text
  },
  badgePill: {
    backgroundColor: 'rgba(236, 72, 153, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(236, 72, 153, 0.4)'
  },
  badgeText: {
    color: COLORS.secondary,
    fontSize: 10,
    fontWeight: '700'
  },
  planDesc: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  planPriceCol: {
    alignItems: 'flex-end'
  },
  planPrice: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text
  },
  planCredits: {
    fontSize: 12,
    color: '#fbbf24',
    fontWeight: '700'
  },
  planDivider: {
    height: 1,
    backgroundColor: COLORS.surfaceLight,
    marginVertical: 12
  },
  planBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  activeStatusText: {
    fontSize: 12,
    fontWeight: '600'
  },
  txnCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: 14,
    borderRadius: 16,
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
  txnIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  txnUser: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text
  },
  txnDesc: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  txnDate: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 1
  },
  txnRight: {
    alignItems: 'flex-end'
  },
  txnCredits: {
    fontSize: 14,
    fontWeight: '800'
  },
  txnAmount: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  profileCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: 24,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    marginBottom: 16
  },
  adminAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.secondary,
    marginBottom: 12
  },
  adminName: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text
  },
  adminMobile: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  adminRoleBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary,
    marginTop: 12
  },
  adminRoleText: {
    color: COLORS.primaryLight,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  settingsSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    marginBottom: 16
  },
  settingsHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text
  },
  settingSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 16,
    height: 50,
    gap: 8
  },
  logoutText: {
    color: COLORS.danger,
    fontSize: 14,
    fontWeight: '700'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  modalCard: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 14
  },
  modalInput: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
    color: COLORS.text,
    fontSize: 14
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  modalCancelText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '600'
  },
  modalSaveBtn: {
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12
  },
  modalSaveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700'
  },
  emptyCard: {
    backgroundColor: COLORS.surface,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 13
  }
});

export default AdminMoreScreen;
