const User = require('../models/User');

/**
 * Service to dispatch high-priority VoIP / incoming call push notifications
 * using the Expo Push Notification Service.
 */
class PushNotificationService {
  /**
   * Send high-priority incoming call push to all active admin devices
   * @param {Object} callData - { callId, callerId, callerName, callType, userId, roomId }
   */
  async sendIncomingCallAlert(callData) {
    try {
      // Find all admin users who have registered a push token
      const admins = await User.find({
        role: 'admin',
        pushToken: { $exists: true, $ne: null }
      });

      if (!admins || admins.length === 0) {
        console.log('[Push Service] No admin users found with registered pushToken.');
        return;
      }

      const callerName = callData.callerName || 'Guest Client';
      const callType = callData.callType || 'Voice';

      const messages = admins
        .filter((admin) => admin.pushToken && admin.pushToken.startsWith('ExponentPushToken['))
        .map((admin) => ({
          to: admin.pushToken,
          sound: 'default',
          title: `📞 Incoming ${callType} Call`,
          body: `${callerName} is calling for a consultation. Tap to answer.`,
          priority: 'high',
          channelId: 'incoming-calls',
          categoryId: 'INCOMING_CALL_CATEGORY',
          _displayInForeground: true,
          data: {
            type: 'INCOMING_CALL',
            callId: callData.callId,
            callerId: callData.callerId,
            callerName: callerName,
            callType: callType,
            userId: callData.userId,
            roomId: callData.roomId || callData.callId
          }
        }));

      if (messages.length === 0) {
        console.log('[Push Service] No valid ExponentPushTokens found among admins.');
        return;
      }

      console.log(`[Push Service] Dispatching incoming call push to ${messages.length} admin device(s)...`);

      // Send to Expo Push Notification API
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(messages)
      });

      const result = await response.json();
      console.log('[Push Service] Expo Push API response:', JSON.stringify(result));
    } catch (error) {
      console.error('[Push Service Error] Failed to send push notification:', error.message);
    }
  }

  /**
   * Send notification to cancel/dismiss ringing on admin device when caller hangs up early
   */
  async sendCallCancelledAlert(callId) {
    try {
      const admins = await User.find({
        role: 'admin',
        pushToken: { $exists: true, $ne: null }
      });

      if (!admins || admins.length === 0) return;

      const messages = admins
        .filter((admin) => admin.pushToken && admin.pushToken.startsWith('ExponentPushToken['))
        .map((admin) => ({
          to: admin.pushToken,
          priority: 'high',
          data: {
            type: 'CALL_CANCELLED',
            callId: callId
          }
        }));

      if (messages.length === 0) return;

      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(messages)
      });
    } catch (e) {
      // Ignored non-critical cancellation push
    }
  }
}

module.exports = new PushNotificationService();
