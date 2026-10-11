import apiClient from './api';

export const walletService = {
  getBalance: async () => {
    const res = await apiClient.get('/wallet/balance');
    return res.data;
  },

  getPlans: async () => {
    const res = await apiClient.get('/wallet/plans');
    return res.data;
  },

  getTransactions: async (params = {}) => {
    const res = await apiClient.get('/wallet/transactions', { params });
    return res.data;
  },

  createOrder: async (planId) => {
    const res = await apiClient.post('/wallet/create-order', { planId });
    return res.data;
  },

  verifyPayment: async (paymentData) => {
    const res = await apiClient.post('/wallet/verify-payment', paymentData);
    return res.data;
  }
};

export default walletService;
