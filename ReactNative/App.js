import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ErrorBoundary from './src/components/ErrorBoundary';
import { AuthProvider } from './src/context/AuthContext';
import { AdminCallProvider } from './src/context/AdminCallContext';
import AdminAppNavigator from './src/navigation/AdminAppNavigator';
import notificationService from './src/services/notificationService';

export default function App() {
  useEffect(() => {
    // Initialize notification channels (incoming-calls) and action categories
    notificationService.init();
  }, []);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor="#0b141b" />
        <AuthProvider>
          <AdminCallProvider>
            <AdminAppNavigator />
          </AdminCallProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
