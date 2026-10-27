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
  ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';

export const RegisterScreen = ({ onNavigateLogin }) => {
  const { register } = useAuth();

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleRegister = async () => {
    if (!name.trim() || !mobile.trim() || !password) {
      setErrorMsg('Please fill in all required fields.');
      return;
    }

    const isValidUAEMobile = (val) => {
      let clean = (val || '').replace(/[\s\-\(\)\.]/g, '');
      if (clean.startsWith('+971')) clean = clean.slice(4);
      else if (clean.startsWith('00971')) clean = clean.slice(5);
      else if (clean.startsWith('971') && clean.length >= 11) clean = clean.slice(3);
      if (clean.startsWith('0')) clean = clean.slice(1);
      return /^5[024568]\d{7}$/.test(clean);
    };

    if (!isValidUAEMobile(mobile.trim())) {
      setErrorMsg('Please enter a valid Dubai / UAE mobile number (e.g. 50 123 4567 or 050 123 4567). Allowed prefixes: 050, 052, 054, 055, 056, 058.');
      return;
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setErrorMsg('');
    setIsLoading(true);

    try {
      await register(name.trim(), mobile.trim(), password);
    } catch (err) {
      setErrorMsg(err.message || 'Registration failed. Please try again.');
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
        {/* Bonus Banner */}
        <View style={styles.bonusBanner}>
          <Ionicons name="gift" size={24} color="#fbbf24" />
          <View style={styles.bonusInfo}>
            <Text style={styles.bonusTitle}>5 Free Welcome Credits!</Text>
            <Text style={styles.bonusText}>
              Get 5 minutes of voice companionship on signup.
            </Text>
          </View>
        </View>

        {/* Card Form */}
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Create Account</Text>
          <Text style={styles.formSubtitle}>Join Friend today for confidential emotional support</Text>

          {errorMsg ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}

          {/* Full Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Your Name / Nickname</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="person-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="What should we call you?"
                placeholderTextColor={COLORS.textMuted}
                value={name}
                onChangeText={(text) => {
                  setName(text);
                  setErrorMsg('');
                }}
              />
            </View>
          </View>

          {/* Mobile Number */}
          <View style={styles.inputGroup}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={styles.label}>Mobile Number</Text>
              <Text style={{ fontSize: 11, color: COLORS.primary || '#1769E0', fontWeight: 'bold' }}>🇦🇪 UAE Only</Text>
            </View>
            <View style={styles.inputWrapper}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.textPrimary }}>🇦🇪 +971</Text>
              </View>
              <TextInput
                style={[styles.input, { paddingLeft: 6 }]}
                placeholder="50 123 4567"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="phone-pad"
                value={mobile}
                onChangeText={(text) => {
                  setMobile(text);
                  setErrorMsg('');
                }}
                maxLength={16}
              />
            </View>
            <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>
              Enter 9-digit UAE mobile (050, 052, 054, 055, 056, 058)
            </Text>
          </View>

          {/* Password */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Create Password</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="At least 6 characters"
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

          {/* Confirm Password */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Confirm Password</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Repeat your password"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry={!showPassword}
                value={confirmPassword}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  setErrorMsg('');
                }}
              />
            </View>
          </View>

          {/* Register Submit Button */}
          <TouchableOpacity
            style={[styles.submitBtn, isLoading && styles.submitBtnDisabled]}
            onPress={handleRegister}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.submitBtnText}>Sign Up & Claim 5 Credits</Text>
                <Ionicons name="sparkles" size={18} color="#fbbf24" />
              </>
            )}
          </TouchableOpacity>

          {/* Login Link */}
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity onPress={onNavigateLogin}>
              <Text style={styles.loginLink}>Sign In</Text>
            </TouchableOpacity>
          </View>
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
  bonusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.4)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    gap: 12
  },
  bonusInfo: {
    flex: 1
  },
  bonusTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fbbf24'
  },
  bonusText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2
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
    marginBottom: 14
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
    marginTop: 12,
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
  loginLink: {
    color: COLORS.primaryLight,
    fontSize: 13,
    fontWeight: '700'
  }
});

export default RegisterScreen;
