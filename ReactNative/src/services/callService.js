import apiClient from './api';

export const callService = {
  getAdvisorStatus: async () => {
    const res = await apiClient.get('/calls/advisor-status');
    return res.data;
  },

  initiateCall: async (callType = 'Voice') => {
    const res = await apiClient.post('/calls/initiate', { callType });
    return res.data;
  },

  endCall: async (callId, reason = 'Completed') => {
    const res = await apiClient.post('/calls/end', { callId, reason });
    return res.data;
  },

  getCallHistory: async (params = {}) => {
    const res = await apiClient.get('/calls/history', { params });
    return res.data;
  }
};

export default callService;
