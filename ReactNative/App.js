import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ErrorBoundary from './src/components/ErrorBoundary';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { CallProvider } from './src/context/CallContext';
import { AdminCallProvider } from './src/context/AdminCallContext';
import AppNavigator from './src/navigation/AppNavigator';
import AdminAppNavigator from './src/navigation/AdminAppNavigator';
import notificationService from './src/services/notificationService';
import { COLORS } from './src/theme/colors';

function AppRootContent() {
  const { isAuthenticated, isAdmin, isLoading } = useAuth();
  const [showAdminPortal, setShowAdminPortal] = useState(false);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#25d366" />
        <Text style={styles.loadingText}>Connecting to Friend...</Text>
      </View>
    );
  }

  // If authenticated as Admin, or user opted to open Admin/Advisor Portal
  if (isAdmin || (showAdminPortal && !isAuthenticated)) {
    return (
      <AdminCallProvider>
        <AdminAppNavigator onSwitchToUserPortal={() => setShowAdminPortal(false)} />
      </AdminCallProvider>
    );
  }

  // Member / User Flow (Default: CallProvider & User App Navigator)
  return (
    <CallProvider>
      <AppNavigator onSwitchToAdminPortal={() => setShowAdminPortal(true)} />
    </CallProvider>
  );
}

export default function App() {
  useEffect(() => {
    notificationService.init();
  }, []);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor="#0b141b" />
        <AuthProvider>
          <AppRootContent />
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0b141b',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12
  },
  loadingText: {
    color: '#8696a0',
    fontSize: 14,
    fontWeight: '600'
  }
});
