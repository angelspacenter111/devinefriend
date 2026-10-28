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
import { useAdminCall } from '../../context/AdminCallContext';
import adminService from '../../services/adminService';
import notificationService from '../../services/notificationService';
import apiClient from '../../services/api';

export const AdminDashboardScreen = ({ onNavigateTab }) => {
  const { user } = useAuth();
  const { isOnline, toggleOnlinePresence } = useAdminCall();

  const [stats, setStats] = useState({
    totalUsers: 0,
    totalCalls: 0,
    completedCallsCount: 0,
    missedCallsCount: 0,
    totalMinutes: 0,
    totalRevenue: 0
  });

  const [recentCalls, setRecentCalls] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTestingPush, setIsTestingPush] = useState(false);

  const handleTestCallAlert = async () => {
    setIsTestingPush(true);
    try {
      // 1. Ensure push token is active
      const token = await notificationService.registerForPushNotifications();
      // 2. Trigger test alert from server
      await apiClient.post('/admin/test-push');
      Alert.alert(
        '📞 Call Ringing Sent!',
        'A high-priority incoming call notification has been dispatched! Close or minimize the app to verify full ringing, vibration, and WhatsApp-style call alerts.'
      );
    } catch (e) {
      Alert.alert('Notification Test', e.message || 'Could not send test push alert.');
    } finally {
      setIsTestingPush(false);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const res = await adminService.getDashboard();
      if (res && res.data) {
        setStats(res.data.stats || {});
        setRecentCalls(res.data.recentCalls || []);
      }
    } catch (e) {
      console.warn('[AdminDashboard] Fetch error:', e.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchDashboardData();
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={COLORS.secondary}
        />
      }
    >
      {/* Advisor Presence Banner */}
      <View style={[styles.presenceBanner, isOnline ? styles.presenceOnline : styles.presenceOffline]}>
        <View style={styles.presenceLeft}>
          <View style={[styles.presenceDot, { backgroundColor: isOnline ? COLORS.success : '#94a3b8' }]} />
          <View>
            <Text style={styles.presenceTitle}>
              {isOnline ? 'Active & Ready for Calls' : 'Advisor Away (Offline)'}
            </Text>
            <Text style={styles.presenceSub}>
              {isOnline
                ? 'Web user calls will ring directly on this phone'
                : 'Turn ON to accept incoming calls from users'}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.toggleBtn, isOnline ? styles.toggleBtnActive : styles.toggleBtnInactive]}
          onPress={() => toggleOnlinePresence(!isOnline)}
        >
          <Text style={styles.toggleBtnText}>{isOnline ? 'Go Offline' : 'Go Online'}</Text>
        </TouchableOpacity>
      </View>

      {/* Background Call Alerts Card */}
      <View style={styles.notificationAlertCard}>
        <View style={styles.notifCardLeft}>
          <View style={styles.notifIconBadge}>
            <Ionicons name="notifications" size={18} color="#38bdf8" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.notifTitle}>Background Call Alerts</Text>
            <Text style={styles.notifSub}>
              Rings even when app is closed
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.testAlertBtn}
          onPress={handleTestCallAlert}
          disabled={isTestingPush}
          activeOpacity={0.8}
        >
          {isTestingPush ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="musical-notes" size={13} color="#fff" style={{ marginRight: 4 }} />
              <Text style={styles.testAlertBtnText}>Test Ring</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Metrics Grid (2x2) */}
      <View style={styles.metricsGrid}>
        {/* Metric 1: Total Users */}
        <TouchableOpacity
          style={styles.metricCard}
          onPress={() => onNavigateTab('users')}
          activeOpacity={0.8}
        >
          <View style={[styles.metricIconWrap, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
            <Ionicons name="people" size={22} color={COLORS.primaryLight} />
          </View>
          <Text style={styles.metricValue}>{stats.totalUsers}</Text>
          <Text style={styles.metricLabel}>New Users Today</Text>
        </TouchableOpacity>

        {/* Metric 2: Total Calls */}
        <TouchableOpacity
          style={styles.metricCard}
          onPress={() => onNavigateTab('calls')}
          activeOpacity={0.8}
        >
          <View style={[styles.metricIconWrap, { backgroundColor: 'rgba(236, 72, 153, 0.15)' }]}>
            <Ionicons name="call" size={22} color={COLORS.secondary} />
          </View>
          <Text style={styles.metricValue}>{stats.totalCalls}</Text>
          <Text style={styles.metricLabel}>Calls Today</Text>
        </TouchableOpacity>

        {/* Metric 3: Total Minutes */}
        <View style={styles.metricCard}>
          <View style={[styles.metricIconWrap, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
            <Ionicons name="time" size={22} color="#10b981" />
          </View>
          <Text style={styles.metricValue}>{stats.totalMinutes}m</Text>
          <Text style={styles.metricLabel}>Minutes Today</Text>
        </View>

        {/* Metric 4: Total Revenue */}
        <TouchableOpacity
          style={styles.metricCard}
          onPress={() => onNavigateTab('more')}
          activeOpacity={0.8}
        >
          <View style={[styles.metricIconWrap, { backgroundColor: 'rgba(251, 191, 36, 0.15)' }]}>
            <Ionicons name="wallet" size={22} color="#fbbf24" />
          </View>
          <Text style={styles.metricValue}>AED {stats.totalRevenue}</Text>
          <Text style={styles.metricLabel}>Today's Revenue</Text>
        </TouchableOpacity>
      </View>

      {/* Quick Action Shortcuts */}
      <View style={styles.shortcutsRow}>
        <TouchableOpacity
          style={styles.shortcutBtn}
          onPress={() => onNavigateTab('users')}
        >
          <Ionicons name="person-add-outline" size={18} color={COLORS.primaryLight} />
          <Text style={styles.shortcutText}>Users & Credits</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.shortcutBtn}
          onPress={() => onNavigateTab('calls')}
        >
          <Ionicons name="list-outline" size={18} color={COLORS.secondary} />
          <Text style={styles.shortcutText}>Call Logs</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.shortcutBtn}
          onPress={() => onNavigateTab('more')}
        >
          <Ionicons name="pricetags-outline" size={18} color="#fbbf24" />
          <Text style={styles.shortcutText}>Pricing Packs</Text>
        </TouchableOpacity>
      </View>

      {/* Recent Calls Stream */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Today's Conversations</Text>
        <TouchableOpacity onPress={() => onNavigateTab('calls')}>
          <Text style={styles.viewAllText}>View All</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color={COLORS.secondary} style={{ marginVertical: 30 }} />
      ) : recentCalls.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="headset-outline" size={36} color={COLORS.textMuted} />
          <Text style={styles.emptyTitle}>No call logs today yet</Text>
          <Text style={styles.emptySub}>Calls initiated today will appear here.</Text>
        </View>
      ) : (
        recentCalls.map((call) => (
          <View key={call._id || call.callId} style={styles.callRow}>
            <View style={styles.callLeft}>
              <View
                style={[
                  styles.callIcon,
                  {
                    backgroundColor:
                      call.status === 'Completed'
                        ? 'rgba(16, 185, 129, 0.15)'
                        : 'rgba(239, 68, 68, 0.15)'
                  }
                ]}
              >
                <Ionicons
                  name={call.status === 'Completed' ? 'call' : 'call-outline'}
                  size={16}
                  color={call.status === 'Completed' ? '#10b981' : COLORS.danger}
                />
              </View>
              <View>
                <Text style={styles.callerName}>{call.user?.name || call.userName || 'Web User'}</Text>
                <Text style={styles.callDate}>
                  {call.user?.mobile ? `+91 ${call.user.mobile} • ` : ''}
                  {call.date ? new Date(call.date).toLocaleDateString() : 'Recent'}
                </Text>
              </View>
            </View>

            <View style={styles.callRight}>
              <Text style={styles.callDuration}>{call.duration || '00:00'}</Text>
              <Text
                style={[
                  styles.callStatusBadge,
                  { color: call.status === 'Completed' ? '#10b981' : COLORS.danger }
                ]}
              >
                {call.status}
              </Text>
            </View>
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
    padding: 18,
    paddingBottom: 40
  },
  presenceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 18
  },
  presenceOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)'
  },
  presenceOffline: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.surfaceLight
  },
  presenceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1
  },
  presenceDot: {
    width: 12,
    height: 12,
    borderRadius: 6
  },
  presenceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text
  },
  presenceSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12
  },
  toggleBtnActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.danger
  },
  toggleBtnInactive: {
    backgroundColor: COLORS.success
  },
  toggleBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff'
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16
  },
  metricCard: {
    width: '48%',
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  metricIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text
  },
  metricLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  shortcutsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20
  },
  shortcutBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    gap: 6
  },
  shortcutText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text
  },
  viewAllText: {
    fontSize: 12,
    color: COLORS.secondary,
    fontWeight: '700'
  },
  emptyCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 10
  },
  emptySub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4
  },
  callRow: {
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
  callLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1
  },
  callIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  callerName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text
  },
  callDate: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  callRight: {
    alignItems: 'flex-end'
  },
  callDuration: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text
  },
  callStatusBadge: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2
  },
  notificationAlertCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    padding: 14,
    borderRadius: 16,
    marginBottom: 20
  },
  notifCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1
  },
  notifIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  notifTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f8fafc'
  },
  notifSub: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2
  },
  testAlertBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8
  },
  testAlertBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700'
  }
});

export default AdminDashboardScreen;
