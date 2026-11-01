import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import ErrorBoundary from './src/components/ErrorBoundary';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { CallProvider } from './src/context/CallContext';
import { AdminCallProvider } from './src/context/AdminCallContext';
import AppNavigator from './src/navigation/AppNavigator';
import AdminAppNavigator from './src/navigation/AdminAppNavigator';
import notificationService from './src/services/notificationService';

function RootNavigator() {
  const { isAuthenticated, isAdmin } = useAuth();
  const [portal, setPortal] = useState('user'); // 'user' | 'admin'

  useEffect(() => {
    if (isAuthenticated) {
      setPortal(isAdmin ? 'admin' : 'user');
    }
  }, [isAuthenticated, isAdmin]);

  if (portal === 'admin') {
    return (
      <AdminCallProvider>
        <AdminAppNavigator onSwitchToUserPortal={() => setPortal('user')} />
      </AdminCallProvider>
    );
  }

  return (
    <CallProvider>
      <AppNavigator onSwitchToAdminPortal={() => setPortal('admin')} />
    </CallProvider>
  );
}

export default function App() {
  useEffect(() => {
    // Hide splash screen smoothly once root app mounts
    SplashScreen.hideAsync().catch(() => {});
    // Initialize notification channels (incoming-calls) and action categories
    notificationService.init().catch(() => {});
  }, []);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor="#0b141b" />
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
