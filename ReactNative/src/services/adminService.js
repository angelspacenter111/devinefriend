import apiClient from './api';

export const adminService = {
  login: async (mobile, password) => {
    const res = await apiClient.post('/admin/login', { mobile, password });
    return res.data;
  },

  getDashboard: async () => {
    const res = await apiClient.get('/admin/dashboard');
    return res.data;
  },

  getUsers: async (params = {}) => {
    const res = await apiClient.get('/admin/users', { params });
    return res.data;
  },

  toggleUserBlock: async (userId) => {
    const res = await apiClient.post(`/admin/users/${userId}/block`);
    return res.data;
  },

  updateUserCredits: async (userId, amount, reason) => {
    const res = await apiClient.post(`/admin/users/${userId}/credits`, { amount, reason });
    return res.data;
  },

  getCalls: async (params = {}) => {
    const res = await apiClient.get('/admin/calls', { params });
    return res.data;
  },

  getTransactions: async (params = {}) => {
    const res = await apiClient.get('/admin/transactions', { params });
    return res.data;
  },

  getPricing: async () => {
    const res = await apiClient.get('/admin/pricing');
    return res.data;
  },

  addPricing: async (planData) => {
    const res = await apiClient.post('/admin/pricing/add', planData);
    return res.data;
  },

  togglePricing: async (planId) => {
    const res = await apiClient.post(`/admin/pricing/${planId}/toggle`);
    return res.data;
  }
};

export default adminService;
