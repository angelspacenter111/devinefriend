import apiClient from './api';

export const authService = {
  login: async (mobile, password) => {
    const res = await apiClient.post('/auth/login', { mobile, password });
    return res.data;
  },

  register: async (name, mobile, password, email) => {
    const res = await apiClient.post('/auth/register', { name, mobile, password, email });
    return res.data;
  },

  getMe: async () => {
    const res = await apiClient.get('/auth/me');
    return res.data;
  },

  forgotPassword: async (mobile, newPassword) => {
    const res = await apiClient.post('/auth/forgot-password', { mobile, newPassword });
    return res.data;
  }
};

export default authService;
