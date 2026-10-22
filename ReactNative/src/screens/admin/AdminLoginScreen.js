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
import { getServerUrl, setServerHost, loadSavedServerHost, ENV_SERVER_URL } from '../../config/api';
import socketService from '../../services/socketService';
import notificationService from '../../services/notificationService';

export const AdminLoginScreen = () => {
  const { adminLogin } = useAuth();

  const [identifier, setIdentifier] = useState(''); // Email or Mobile
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Server IP config
  const [serverUrl, setServerUrl] = useState(getServerUrl());
  const [isServerModalVisible, setIsServerModalVisible] = useState(false);
  const [inputHost, setInputHost] = useState(ENV_SERVER_URL);

  useEffect(() => {
    loadSavedServerHost().then(() => {
      setServerUrl(getServerUrl());
    });
  }, []);

  const handleAdminLogin = async () => {
    if (!identifier.trim() || !password) {
      setErrorMsg('Please enter your Admin Email or Mobile number, and password.');
      return;
    }

    setErrorMsg('');
    setIsLoading(true);

    try {
      const res = await adminLogin(identifier.trim(), password);
      // Immediately register push notifications upon admin authentication
      notificationService.registerForPushNotifications().catch(() => { });
    } catch (err) {
      setErrorMsg(err.message || 'Admin authentication failed.');
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
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Centered Main Admin Card */}
        <View style={styles.formCard}>
          {/* Header Inside Card */}
          <View style={styles.cardHeader}>
            <View style={styles.logoBadge}>
              <Ionicons name="shield-checkmark" size={28} color="#fff" />
            </View>
            <Text style={styles.brandTitle}>Friend Admin</Text>
            <View style={styles.portalBadge}>
              <View style={styles.portalDot} />
              <Text style={styles.portalText}>ADVISOR CONSOLE</Text>
            </View>
          </View>

          <Text style={styles.formSubtitle}>
            Sign in with your administrator credentials to receive live calls
          </Text>

          {errorMsg ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}

          {/* Email / Mobile Input (Supports email keyboard!) */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Admin Email or Mobile</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="mail-outline" size={18} color={COLORS.secondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="admin@admin.com or Mobile"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={identifier}
                onChangeText={(t) => {
                  setIdentifier(t);
                  setErrorMsg('');
                }}
              />
            </View>
          </View>

          {/* Password Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.secondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter admin password"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  setErrorMsg('');
                }}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeBtn}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={COLORS.textSecondary}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Sign In Button with Vibrant Purple/Pink Gradient styling */}
          <TouchableOpacity
            style={[styles.submitBtn, isLoading && styles.submitBtnDisabled]}
            onPress={handleAdminLogin}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.submitBtnText}>Sign In to Console</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </>
            )}
          </TouchableOpacity>

          {/* Server Config Row inside Card */}
          <TouchableOpacity
            style={styles.serverPill}
            onPress={() => setIsServerModalVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="server-outline" size={12} color={COLORS.textSecondary} />
            <Text style={styles.serverText}>Server: {serverUrl}</Text>
            <Ionicons name="pencil" size={11} color={COLORS.secondary} />
          </TouchableOpacity>
        </View>

        {/* Edit Server IP Modal */}
        <Modal visible={isServerModalVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Backend Server Host URL</Text>
              <Text style={styles.modalSub}>
                Enter server URL or IP (configured: {ENV_SERVER_URL}):
              </Text>
              <TextInput
                style={styles.modalInput}
                value={inputHost}
                onChangeText={setInputHost}
                placeholder="e.g. https://talkwithashu.duckdns.org"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                keyboardType="url"
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
    paddingHorizontal: 20,
    paddingVertical: 20
  },
  formCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    shadowColor: COLORS.secondary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 8
  },
  cardHeader: {
    alignItems: 'center',
    marginBottom: 6
  },
  logoBadge: {
    width: 56,
    height: 56,
    borderRadius: 20,
    backgroundColor: COLORS.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.secondary,
    shadowColor: COLORS.secondary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
    marginBottom: 10
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5
  },
  portalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(236, 72, 153, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(236, 72, 153, 0.35)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 6,
    marginTop: 8
  },
  portalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.secondary
  },
  portalText: {
    color: COLORS.secondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8
  },
  formSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 18,
    lineHeight: 16
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 14
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 12,
    flex: 1
  },
  inputGroup: {
    marginBottom: 14
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    paddingHorizontal: 12,
    height: 48
  },
  inputIcon: {
    marginRight: 8
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
    backgroundColor: COLORS.secondary,
    height: 48,
    borderRadius: 14,
    marginTop: 8,
    gap: 8,
    shadowColor: COLORS.secondary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4
  },
  submitBtnDisabled: {
    opacity: 0.7
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700'
  },
  switchUserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 8
  },
  switchUserText: {
    fontSize: 13,
    color: COLORS.secondary,
    fontWeight: '700'
  },
  serverPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 6,
    marginTop: 16,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    alignSelf: 'center'
  },
  serverText: {
    fontSize: 11,
    color: COLORS.textSecondary
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
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6
  },
  modalSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 12
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
    marginTop: 16
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  modalCancelText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600'
  },
  modalSaveBtn: {
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 10
  },
  modalSaveText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700'
  }
});

export default AdminLoginScreen;
