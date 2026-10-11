import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';
import { useAuth } from '../context/AuthContext';

// Components & Modals
import AdminHeader from '../components/AdminHeader';
import IncomingCallModal from '../components/IncomingCallModal';
import AdminActiveCallModal from '../components/AdminActiveCallModal';

// Screens
import AdminLoginScreen from '../screens/admin/AdminLoginScreen';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import AdminCallCenterScreen from '../screens/admin/AdminCallCenterScreen';
import AdminUsersScreen from '../screens/admin/AdminUsersScreen';
import AdminCallsScreen from '../screens/admin/AdminCallsScreen';
import AdminMoreScreen from '../screens/admin/AdminMoreScreen';

export const AdminAppNavigator = ({ onSwitchToUserPortal }) => {
  const { isAuthenticated, isAdmin, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'users' | 'callcenter' | 'calls' | 'more'

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.secondary} />
        <Text style={styles.loadingText}>Connecting to Admin Console...</Text>
      </View>
    );
  }

  // If not logged in as Admin, show Admin Login Portal
  if (!isAuthenticated || !isAdmin) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AdminLoginScreen onSwitchToUser={onSwitchToUserPortal} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Admin Header Bar with Online/Offline presence toggle */}
      <AdminHeader />

      {/* Main Tab Screen Content */}
      <View style={styles.tabContent}>
        {activeTab === 'dashboard' && <AdminDashboardScreen onNavigateTab={(tab) => setActiveTab(tab)} />}
        {activeTab === 'users' && <AdminUsersScreen />}
        {activeTab === 'callcenter' && <AdminCallCenterScreen />}
        {activeTab === 'calls' && <AdminCallsScreen />}
        {activeTab === 'more' && <AdminMoreScreen />}
      </View>

      {/* Admin Bottom Navigation Bar with Center Floating Call Station Button */}
      <View style={styles.bottomBar}>
        {/* 1. Dashboard */}
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('dashboard')}
          activeOpacity={0.7}
        >
          <Ionicons
            name={activeTab === 'dashboard' ? 'grid' : 'grid-outline'}
            size={22}
            color={activeTab === 'dashboard' ? COLORS.secondary : COLORS.textMuted}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'dashboard' && styles.tabLabelActive
            ]}
          >
            Dashboard
          </Text>
        </TouchableOpacity>

        {/* 2. Users */}
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('users')}
          activeOpacity={0.7}
        >
          <Ionicons
            name={activeTab === 'users' ? 'people' : 'people-outline'}
            size={22}
            color={activeTab === 'users' ? COLORS.secondary : COLORS.textMuted}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'users' && styles.tabLabelActive
            ]}
          >
            Users
          </Text>
        </TouchableOpacity>

        {/* 3. Center Call Station Floating Button */}
        <TouchableOpacity
          style={styles.centerCallItem}
          onPress={() => setActiveTab('callcenter')}
          activeOpacity={0.8}
        >
          <View style={[styles.centerCallBubble, activeTab === 'callcenter' && styles.centerCallBubbleActive]}>
            <Ionicons name="headset" size={26} color="#fff" />
          </View>
          <Text
            style={[
              styles.tabLabel,
              styles.centerCallLabel,
              activeTab === 'callcenter' && styles.tabLabelActive
            ]}
          >
            Call Center
          </Text>
        </TouchableOpacity>

        {/* 4. Calls */}
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('calls')}
          activeOpacity={0.7}
        >
          <Ionicons
            name={activeTab === 'calls' ? 'call' : 'call-outline'}
            size={22}
            color={activeTab === 'calls' ? COLORS.secondary : COLORS.textMuted}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'calls' && styles.tabLabelActive
            ]}
          >
            Call Logs
          </Text>
        </TouchableOpacity>

        {/* 5. More */}
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('more')}
          activeOpacity={0.7}
        >
          <Ionicons
            name={activeTab === 'more' ? 'options' : 'options-outline'}
            size={22}
            color={activeTab === 'more' ? COLORS.secondary : COLORS.textMuted}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'more' && styles.tabLabelActive
            ]}
          >
            More
          </Text>
        </TouchableOpacity>
      </View>

      {/* Global Ringing and Active Call Modals */}
      <IncomingCallModal />
      <AdminActiveCallModal />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '600'
  },
  tabContent: {
    flex: 1
  },
  bottomBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceLight,
    paddingVertical: 8,
    paddingHorizontal: 12,
    justifyContent: 'space-around',
    alignItems: 'center'
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1
  },
  tabLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 4,
    fontWeight: '600'
  },
  tabLabelActive: {
    color: COLORS.secondary,
    fontWeight: '800'
  },
  centerCallItem: {
    alignItems: 'center',
    justifyContent: 'center',
    top: -16,
    flex: 1
  },
  centerCallBubble: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.secondary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 4,
    borderColor: COLORS.background
  },
  centerCallBubbleActive: {
    transform: [{ scale: 1.08 }]
  },
  centerCallLabel: {
    marginTop: 2
  }
});

export default AdminAppNavigator;
