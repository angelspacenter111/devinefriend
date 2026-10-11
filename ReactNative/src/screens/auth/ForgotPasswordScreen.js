import React, { useState } from 'react';
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
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import authService from '../../services/authService';

export const ForgotPasswordScreen = ({ onNavigateLogin }) => {
  const [mobile, setMobile] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const handleResetPassword = async () => {
    if (!mobile.trim() || !newPassword) {
      setErrorMsg('Please enter both mobile number and new password.');
      return;
    }

    if (newPassword.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    setErrorMsg('');
    setIsLoading(true);

    try {
      await authService.forgotPassword(mobile.trim(), newPassword);
      setIsSuccess(true);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to reset password.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.formCard}>
          <TouchableOpacity style={styles.backBtn} onPress={onNavigateLogin}>
            <Ionicons name="arrow-back" size={20} color={COLORS.text} />
            <Text style={styles.backText}>Back to Sign In</Text>
          </TouchableOpacity>

          <Text style={styles.formTitle}>Recover Password</Text>
          <Text style={styles.formSubtitle}>
            Enter your registered mobile number and set your new password
          </Text>

          {isSuccess ? (
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle" size={32} color="#10b981" />
              <Text style={styles.successTitle}>Password Reset Successful!</Text>
              <Text style={styles.successSub}>
                You can now log in with your updated password.
              </Text>
              <TouchableOpacity
                style={styles.submitBtn}
                onPress={onNavigateLogin}
              >
                <Text style={styles.submitBtnText}>Go to Sign In</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {errorMsg ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              ) : null}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Registered Mobile Number</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="call-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="10-digit mobile"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="phone-pad"
                    value={mobile}
                    onChangeText={(t) => {
                      setMobile(t);
                      setErrorMsg('');
                    }}
                    maxLength={10}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>New Password</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="At least 6 characters"
                    placeholderTextColor={COLORS.textMuted}
                    secureTextEntry
                    value={newPassword}
                    onChangeText={(t) => {
                      setNewPassword(t);
                      setErrorMsg('');
                    }}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[styles.submitBtn, isLoading && styles.submitBtnDisabled]}
                onPress={handleResetPassword}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>Update Password</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
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
  formCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 22,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 6
  },
  backText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600'
  },
  formTitle: {
    fontSize: 22,
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
  successBox: {
    alignItems: 'center',
    paddingVertical: 20
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#10b981',
    marginTop: 12
  },
  successSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20
  },
  inputGroup: {
    marginBottom: 16
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
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
  submitBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    height: 52,
    borderRadius: 14,
    marginTop: 10,
    width: '100%'
  },
  submitBtnDisabled: {
    opacity: 0.7
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700'
  }
});

export default ForgotPasswordScreen;
