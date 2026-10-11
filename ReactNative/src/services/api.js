import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '../config/api';

const apiClient = axios.create({
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

// Dynamic Base URL & Token Request Interceptor
apiClient.interceptors.request.use(
  async (config) => {
    try {
      config.baseURL = getApiUrl();
      const token = await AsyncStorage.getItem('@auth_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (e) {
      console.warn('[API Interceptor] Error in request setup:', e.message);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Format error messages
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    let errorMsg = 'An unexpected network error occurred.';
    if (error.response?.data?.message) {
      errorMsg = error.response.data.message;
    } else if (error.message === 'Network Error') {
      errorMsg = `Cannot connect to server at ${getApiUrl()}. Please check that backend server is running and your mobile is on the same Wi-Fi.`;
    } else if (error.message) {
      errorMsg = error.message;
    }
    return Promise.reject(new Error(errorMsg));
  }
);

export default apiClient;
