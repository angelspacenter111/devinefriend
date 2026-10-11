import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';
import { getServerUrl, setServerHost, loadSavedServerHost, PC_LAN_IP } from '../../config/api';
import socketService from '../../services/socketService';

export const LoginScreen = ({ onNavigateRegister, onNavigateForgotPassword, onNavigateAdmin }) => {
  const { login } = useAuth();

  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Server IP config state
  const [serverUrl, setServerUrl] = useState(getServerUrl());
  const [isServerModalVisible, setIsServerModalVisible] = useState(false);
  const [inputHost, setInputHost] = useState(PC_LAN_IP);

  useEffect(() => {
    loadSavedServerHost().then(() => {
      setServerUrl(getServerUrl());
    });
  }, []);

  const handleLogin = async () => {
    if (!mobile.trim() || !password) {
      setErrorMsg('Please enter both mobile number and password.');
      return;
    }

    setErrorMsg('');
    setIsLoading(true);

    try {
      await login(mobile.trim(), password);
    } catch (err) {
      setErrorMsg(err.message || 'Login failed. Please check credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveServerHost = async () => {
    if (!inputHost.trim()) {
      Alert.alert('Validation Error', 'Please enter a valid IP address or hostname.');
      return;
    }

    await setServerHost(inputHost.trim());
    setServerUrl(getServerUrl());
    socketService.connect();
    setIsServerModalVisible(false);
    Alert.alert('Server Updated', `Connecting to: ${getServerUrl()}`);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Brand Logo & Title */}
        <View style={styles.brandHeader}>
          <View style={styles.logoBadge}>
            <Ionicons name="heart" size={32} color="#fff" />
          </View>
          <Text style={styles.brandTitle}>Friend</Text>
          <Text style={styles.brandSubtitle}>
            Your compassionate emotional support and voice companion
          </Text>
        </View>

        {/* Card Form */}
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Welcome Back</Text>
          <Text style={styles.formSubtitle}>Log in to talk with your advisor</Text>

          {errorMsg ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}

          {/* Mobile Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Mobile Number</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="call-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter 10-digit mobile"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="phone-pad"
                value={mobile}
                onChangeText={(text) => {
                  setMobile(text);
                  setErrorMsg('');
                }}
                maxLength={10}
              />
            </View>
          </View>

          {/* Password Input */}
          <View style={styles.inputGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Password</Text>
              <TouchableOpacity onPress={onNavigateForgotPassword}>
                <Text style={styles.forgotLink}>Forgot?</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  setErrorMsg('');
                }}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeBtn}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={COLORS.textSecondary}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Login Submit Button */}
          <TouchableOpacity
            style={[styles.submitBtn, isLoading && styles.submitBtnDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.submitBtnText}>Sign In</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </>
            )}
          </TouchableOpacity>

          {/* Register Link */}
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <TouchableOpacity onPress={onNavigateRegister}>
              <Text style={styles.registerLink}>Create Account</Text>
            </TouchableOpacity>
          </View>

          {/* Switch to Advisor Portal */}
          {onNavigateAdmin ? (
            <TouchableOpacity
              style={styles.adminSwitchBtn}
              onPress={onNavigateAdmin}
              activeOpacity={0.75}
            >
              <Ionicons name="shield-checkmark" size={14} color={COLORS.secondary} />
              <Text style={styles.adminSwitchText}>Advisor / Admin Console Portal</Text>
              <Ionicons name="arrow-forward" size={13} color={COLORS.secondary} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Server IP Indicator Pill */}
        <TouchableOpacity
          style={styles.serverPill}
          onPress={() => setIsServerModalVisible(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="server-outline" size={13} color={COLORS.textSecondary} />
          <Text style={styles.serverText}>API: {serverUrl}</Text>
          <Ionicons name="pencil" size={11} color={COLORS.primaryLight} />
        </TouchableOpacity>

        <View style={styles.bottomBadge}>
          <Ionicons name="shield-checkmark" size={14} color="#10b981" />
          <Text style={styles.bottomBadgeText}>100% Confidential & Secure</Text>
        </View>

        {/* Edit Server IP Modal */}
        <Modal visible={isServerModalVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Backend Server Host URL</Text>
              <Text style={styles.modalSub}>
                Enter server URL or IP (configured: {PC_LAN_IP}):
              </Text>
              <TextInput
                style={styles.modalInput}
                value={inputHost}
                onChangeText={setInputHost}
                placeholder="e.g. https://devinefriend.duckdns.org"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
              />
              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setIsServerModalVisible(false)}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalSaveBtn}
                  onPress={handleSaveServerHost}
                >
                  <Text style={styles.modalSaveText}>Save & Connect</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 30
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
    marginBottom: 14
  },
  brandTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: 0.5
  },
  brandSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 280
  },
  formCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 22,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 5
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text
  },
  formSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
    marginBottom: 20
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 12,
    flex: 1
  },
  inputGroup: {
    marginBottom: 16
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6
  },
  forgotLink: {
    fontSize: 12,
    color: COLORS.primaryLight,
    fontWeight: '600'
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    paddingHorizontal: 14,
    height: 50
  },
  inputIcon: {
    marginRight: 10
  },
  input: {
    flex: 1,
    color: COLORS.text,
    fontSize: 14
  },
  eyeBtn: {
    padding: 6
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    height: 52,
    borderRadius: 14,
    marginTop: 10,
    gap: 8
  },
  submitBtnDisabled: {
    opacity: 0.7
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700'
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20
  },
  footerText: {
    color: COLORS.textSecondary,
    fontSize: 13
  },
  registerLink: {
    color: COLORS.primaryLight,
    fontSize: 13,
    fontWeight: '700'
  },
  adminSwitchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 18,
    paddingVertical: 10,
    backgroundColor: 'rgba(236, 72, 153, 0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(236, 72, 153, 0.25)'
  },
  adminSwitchText: {
    color: COLORS.secondary,
    fontSize: 12,
    fontWeight: '700'
  },
  serverPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    gap: 6,
    marginTop: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    alignSelf: 'center'
  },
  serverText: {
    fontSize: 12,
    color: COLORS.textSecondary
  },
  bottomBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16
  },
  bottomBadgeText: {
    color: COLORS.textMuted,
    fontSize: 12
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  modalCard: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6
  },
  modalSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 14
  },
  modalInput: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
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
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10
  },
  modalSaveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700'
  }
});

export default LoginScreen;
