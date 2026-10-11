import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';
import { useCall } from '../../context/CallContext';
import apiClient from '../../services/api';
import BalanceCard from '../../components/BalanceCard';
import AdvisorCard from '../../components/AdvisorCard';

export const HomeScreen = ({ onNavigateTab }) => {
  const { user, refreshUser } = useAuth();
  const { advisorStatus, startCall } = useCall();

  const [stats, setStats] = useState({ totalCalls: 0, totalMinutes: 0 });
  const [recentCalls, setRecentCalls] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStartingCall, setIsStartingCall] = useState(false);

  const fetchDashboardData = async () => {
    try {
      const res = await apiClient.get('/user/dashboard');
      if (res.data && res.data.data) {
        setStats(res.data.data.stats || { totalCalls: 0, totalMinutes: 0 });
        setRecentCalls(res.data.data.recentCalls || []);
      }
    } catch (e) {
      console.warn('[HomeScreen] Fetch dashboard error:', e.message);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refreshUser(), fetchDashboardData()]);
    setIsRefreshing(false);
  };

  const handleStartCall = async () => {
    if ((user?.credits ?? 0) < 1) {
      Alert.alert(
        'Insufficient Credits',
        'You need at least 1 credit to start a call. Please add credits to your wallet.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add Credits', onPress: () => onNavigateTab('wallet') }
        ]
      );
      return;
    }

    try {
      setIsStartingCall(true);
      await startCall('Voice');
    } catch (err) {
      Alert.alert('Call Failed', err.message || 'Could not connect to advisor.');
    } finally {
      setIsStartingCall(false);
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
      {/* User Greeting */}
      <View style={styles.greetingSection}>
        <Text style={styles.welcomeText}>Welcome back,</Text>
        <Text style={styles.userName}>{user?.name || 'Friend'}</Text>
      </View>

      {/* Balance Card */}
      <BalanceCard
        credits={user?.credits ?? 0}
        onRechargePress={() => onNavigateTab('wallet')}
      />

      {/* Advisor Presence & Call Card */}
      <AdvisorCard
        advisorStatus={advisorStatus}
        onCallPress={handleStartCall}
        disabled={isStartingCall}
      />

      {/* Quick Stats Grid */}
      <View style={styles.statsGrid}>
        <View style={styles.statBox}>
          <View style={[styles.statIconCircle, { backgroundColor: 'rgba(99, 102, 241, 0.15)' }]}>
            <Ionicons name="call" size={20} color={COLORS.primaryLight} />
          </View>
          <Text style={styles.statNumber}>{stats.totalCalls}</Text>
          <Text style={styles.statLabel}>Total Calls</Text>
        </View>

        <View style={styles.statBox}>
          <View style={[styles.statIconCircle, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
            <Ionicons name="time" size={20} color="#10b981" />
          </View>
          <Text style={styles.statNumber}>{stats.totalMinutes} min</Text>
          <Text style={styles.statLabel}>Talk Time</Text>
        </View>
      </View>

      {/* Recent Calls Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Conversations</Text>
        <TouchableOpacity onPress={() => onNavigateTab('history')}>
          <Text style={styles.viewAllText}>View All</Text>
        </TouchableOpacity>
      </View>

      {recentCalls.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="chatbubbles-outline" size={36} color={COLORS.textMuted} />
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptySubtitle}>
            When you talk with an advisor, your call records will appear here.
          </Text>
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
                <Text style={styles.callReceiver}>{call.receiverName || 'Life Advisor'}</Text>
                <Text style={styles.callDate}>
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
    padding: 20,
    paddingBottom: 40
  },
  greetingSection: {
    marginBottom: 16
  },
  welcomeText: {
    fontSize: 14,
    color: COLORS.textSecondary
  },
  userName: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: 0.3
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 14
  },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    alignItems: 'center'
  },
  statIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 12
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text
  },
  viewAllText: {
    fontSize: 13,
    color: COLORS.primaryLight,
    fontWeight: '600'
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
  emptySubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16
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
    gap: 12
  },
  callIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  callReceiver: {
    fontSize: 14,
    fontWeight: '600',
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
    fontWeight: '600',
    marginTop: 2
  }
});

export default HomeScreen;
