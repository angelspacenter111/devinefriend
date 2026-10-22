import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Environment-based API & Server Configuration
 * Configured via ReactNative/.env -> EXPO_PUBLIC_API_URL
 */
export const ENV_SERVER_URL = process.env.EXPO_PUBLIC_API_URL || 'https://talkwithashu.duckdns.org';
export const PC_LAN_IP = ENV_SERVER_URL;

const sanitizeUrl = (url) => {
  if (!url) return 'https://talkwithashu.duckdns.org';
  let clean = url.trim().replace(/\/+$/, '');
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = `https://${clean}`;
  }
  return clean;
};

let activeServerUrl = sanitizeUrl(ENV_SERVER_URL);

export const getServerUrl = () => activeServerUrl;
export const getApiUrl = () => `${activeServerUrl}/api`;
export const getSocketUrl = () => activeServerUrl;

export const setServerHost = async (newUrlOrHost) => {
  if (newUrlOrHost && newUrlOrHost.trim()) {
    activeServerUrl = sanitizeUrl(newUrlOrHost);
    await AsyncStorage.setItem('@custom_server_url', activeServerUrl);
  }
};

export const loadSavedServerHost = async () => {
  try {
    const saved = await AsyncStorage.getItem('@custom_server_url');
    if (saved && saved.trim()) {
      activeServerUrl = sanitizeUrl(saved);
    } else {
      activeServerUrl = sanitizeUrl(ENV_SERVER_URL);
    }
  } catch (e) {
    activeServerUrl = sanitizeUrl(ENV_SERVER_URL);
  }
  return activeServerUrl;
};

// Exports for backward compatibility
export const BASE_SERVER_URL = activeServerUrl;
export const API_BASE_URL = `${activeServerUrl}/api`;
export const SOCKET_URL = activeServerUrl;

console.log(`[API Config] Active Server Base URL: ${activeServerUrl}`);

export default {
  getServerUrl,
  getApiUrl,
  getSocketUrl,
  setServerHost,
  loadSavedServerHost,
  ENV_SERVER_URL,
  PC_LAN_IP,
  BASE_SERVER_URL,
  API_BASE_URL,
  SOCKET_URL
};
