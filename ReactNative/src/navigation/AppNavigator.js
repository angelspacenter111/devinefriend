import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import Header from '../components/Header';
import CallModal from '../components/CallModal';
import CallSummaryModal from '../components/CallSummaryModal';

// Auth Screens
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';

// Main Screens
import HomeScreen from '../screens/main/HomeScreen';
import CallScreen from '../screens/main/CallScreen';
import WalletScreen from '../screens/main/WalletScreen';
import HistoryScreen from '../screens/main/HistoryScreen';
import ProfileScreen from '../screens/main/ProfileScreen';

export const AppNavigator = ({ onSwitchToAdminPortal }) => {
  const { isAuthenticated, isLoading } = useAuth();

  // Auth flow sub-screen
  const [authScreen, setAuthScreen] = useState('login'); // 'login' | 'register' | 'forgot'

  // Main App Tab navigation
  const [activeTab, setActiveTab] = useState('home'); // 'home' | 'call' | 'wallet' | 'history' | 'profile'

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primaryLight} />
        <Text style={styles.loadingText}>Connecting to Friend...</Text>
      </View>
    );
  }

  // Unauthenticated Flow
  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.safeArea}>
        {authScreen === 'login' && (
          <LoginScreen
            onNavigateRegister={() => setAuthScreen('register')}
            onNavigateForgotPassword={() => setAuthScreen('forgot')}
            onNavigateAdmin={onSwitchToAdminPortal}
          />
        )}
        {authScreen === 'register' && (
          <RegisterScreen onNavigateLogin={() => setAuthScreen('login')} />
        )}
        {authScreen === 'forgot' && (
          <ForgotPasswordScreen onNavigateLogin={() => setAuthScreen('login')} />
        )}
      </SafeAreaView>
    );
  }

  // Authenticated Flow
  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header Bar */}
      <Header
        onProfilePress={() => setActiveTab('profile')}
        onWalletPress={() => setActiveTab('wallet')}
      />

      {/* Main Tab Screen View */}
      <View style={styles.tabContent}>
        {activeTab === 'home' && <HomeScreen onNavigateTab={(tab) => setActiveTab(tab)} />}
        {activeTab === 'call' && <CallScreen onNavigateWallet={() => setActiveTab('wallet')} />}
        {activeTab === 'wallet' && <WalletScreen />}
        {activeTab === 'history' && <HistoryScreen />}
        {activeTab === 'profile' && <ProfileScreen />}
      </View>

      {/* Modern Bottom Navigation Bar with Centered Call Button */}
      <View style={styles.bottomBar}>
        {/* 1. Home */}
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('home')}
          activeOpacity={0.7}
        >
          <Ionicons
            name={activeTab === 'home' ? 'home' : 'home-outline'}
            size={22}
            color={activeTab === 'home' ? COLORS.primaryLight : COLORS.textMuted}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'home' && styles.tabLabelActive
            ]}
          >
            Home
          </Text>
        </TouchableOpacity>

        {/* 2. Wallet */}
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('wallet')}
          activeOpacity={0.7}
        >
          <Ionicons
            name={activeTab === 'wallet' ? 'wallet' : 'wallet-outline'}
            size={22}
            color={activeTab === 'wallet' ? COLORS.primaryLight : COLORS.textMuted}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'wallet' && styles.tabLabelActive
            ]}
          >
            Wallet
          </Text>
        </TouchableOpacity>

        {/* 3. Center Call Button (Elevated) */}
        <TouchableOpacity
          style={styles.centerCallItem}
          onPress={() => setActiveTab('call')}
          activeOpacity={0.8}
        >
          <View style={[styles.centerCallBubble, activeTab === 'call' && styles.centerCallBubbleActive]}>
            <Ionicons name="call" size={26} color="#fff" />
          </View>
          <Text
            style={[
              styles.tabLabel,
              styles.centerCallLabel,
              activeTab === 'call' && styles.tabLabelActive
            ]}
          >
            Call
          </Text>
        </TouchableOpacity>

        {/* 4. History */}
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('history')}
          activeOpacity={0.7}
        >
          <Ionicons
            name={activeTab === 'history' ? 'time' : 'time-outline'}
            size={22}
            color={activeTab === 'history' ? COLORS.primaryLight : COLORS.textMuted}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'history' && styles.tabLabelActive
            ]}
          >
            History
          </Text>
        </TouchableOpacity>

        {/* 5. Profile */}
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('profile')}
          activeOpacity={0.7}
        >
          <Ionicons
            name={activeTab === 'profile' ? 'person' : 'person-outline'}
            size={22}
            color={activeTab === 'profile' ? COLORS.primaryLight : COLORS.textMuted}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'profile' && styles.tabLabelActive
            ]}
          >
            Profile
          </Text>
        </TouchableOpacity>
      </View>

      {/* Global Realtime Modals */}
      <CallModal />
      <CallSummaryModal />
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
    fontWeight: '500'
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
    fontWeight: '500'
  },
  tabLabelActive: {
    color: COLORS.primaryLight,
    fontWeight: '700'
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
    backgroundColor: COLORS.success,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.success,
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

export default AppNavigator;
