import React, { createContext, useState, useEffect, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import authService from '../services/authService';

import adminService from '../services/adminService';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check stored token and load user profile on startup
  useEffect(() => {
    loadUserFromStorage();
  }, []);

  const loadUserFromStorage = async () => {
    try {
      const storedToken = await AsyncStorage.getItem('@auth_token');
      const storedUser = await AsyncStorage.getItem('@auth_user');

      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));

        // Fetch fresh profile from API in background
        try {
          const res = await authService.getMe();
          if (res && res.user) {
            setUser(res.user);
            await AsyncStorage.setItem('@auth_user', JSON.stringify(res.user));
          }
        } catch (fetchErr) {
          console.warn('[AuthContext] Background user refresh error:', fetchErr.message);
        }
      }
    } catch (e) {
      console.error('[AuthContext] Storage read error', e);
    } finally {
      setIsLoading(false);
    }
  };

  const adminLogin = async (mobile, password) => {
    const res = await adminService.login(mobile, password);
    if (res && res.token && res.admin) {
      setToken(res.token);
      setUser(res.admin);
      await AsyncStorage.setItem('@auth_token', res.token);
      await AsyncStorage.setItem('@auth_user', JSON.stringify(res.admin));
    }
    return res;
  };

  const login = async (mobile, password) => {
    const res = await authService.login(mobile, password);
    if (res && res.token && res.user) {
      setToken(res.token);
      setUser(res.user);
      await AsyncStorage.setItem('@auth_token', res.token);
      await AsyncStorage.setItem('@auth_user', JSON.stringify(res.user));
    }
    return res;
  };

  const register = async (name, mobile, password) => {
    const res = await authService.register(name, mobile, password);
    if (res && res.token && res.user) {
      setToken(res.token);
      setUser(res.user);
      await AsyncStorage.setItem('@auth_token', res.token);
      await AsyncStorage.setItem('@auth_user', JSON.stringify(res.user));
    }
    return res;
  };

  const logout = async () => {
    try {
      await AsyncStorage.removeItem('@auth_token');
      await AsyncStorage.removeItem('@auth_user');
    } catch (e) {
      console.error('[AuthContext] Logout clear error', e);
    } finally {
      setToken(null);
      setUser(null);
    }
  };

  const refreshUser = async () => {
    try {
      const res = await authService.getMe();
      if (res && res.user) {
        setUser(res.user);
        await AsyncStorage.setItem('@auth_user', JSON.stringify(res.user));
      }
      return res?.user;
    } catch (e) {
      console.warn('[AuthContext] Refresh user error:', e.message);
      return null;
    }
  };

  const updateUserCredits = (newCredits) => {
    if (user) {
      const updated = { ...user, credits: newCredits };
      setUser(updated);
      AsyncStorage.setItem('@auth_user', JSON.stringify(updated)).catch(() => {});
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!token && !!user,
        isAdmin: !!user && user.role === 'admin',
        adminLogin,
        login,
        register,
        logout,
        refreshUser,
        updateUserCredits
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
export default AuthContext;
