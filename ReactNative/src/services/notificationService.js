import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import apiClient from './api';

// Configure foreground notification presentation
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isCall = notification?.request?.content?.data?.type === 'INCOMING_CALL';
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      priority: Notifications.AndroidNotificationPriority.MAX
    };
  }
});

class NotificationService {
  constructor() {
    this.pushToken = null;
    this.isInitialized = false;
  }

  /**
   * Initialize notification channels, action categories, and request permissions
   */
  async init() {
    if (this.isInitialized) return;

    try {
      console.log('[NotificationService] Initializing notification channels and categories...');

      // 1. Setup Android High-Priority Calling Notification Channel
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('incoming-calls', {
          name: 'Incoming Phone Calls',
          description: 'High-priority full-screen incoming call ringtones and alerts',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 1000, 800, 1000, 800, 1000],
          lightColor: '#1769E0',
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          sound: 'default',
          bypassDnd: true,
          enableVibrate: true,
          enableLights: true
        });
        console.log('[NotificationService] Android "incoming-calls" channel configured');
      }

      // 2. Setup Interactive Notification Actions (Accept / Decline) like WhatsApp
      await Notifications.setNotificationCategoryAsync('INCOMING_CALL_CATEGORY', [
        {
          identifier: 'ACCEPT_CALL',
          buttonTitle: '🟢 Accept Call',
          options: {
            opensAppToForeground: true
          }
        },
        {
          identifier: 'DECLINE_CALL',
          buttonTitle: '🔴 Decline',
          options: {
            opensAppToForeground: false
          }
        }
      ]);

      this.isInitialized = true;
    } catch (err) {
      console.warn('[NotificationService] Error during channel/category setup:', err);
    }
  }

  /**
   * Request user permission and obtain Expo Push Token
   */
  async registerForPushNotifications() {
    await this.init();

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync({
          android: {},
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
            allowAnnouncements: true
          }
        });
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('[NotificationService] Notification permission was denied by user.');
        return null;
      }

      // Fetch Expo Push Token with projectId from app.json
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ??
        Constants?.easConfig?.projectId ??
        'ba4e869c-76a1-4f66-95b0-c79dad48d99e';

      let tokenResult = null;
      try {
        tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
      } catch (tokenErr) {
        console.warn('[NotificationService] getExpoPushTokenAsync with projectId error, retrying without:', tokenErr.message);
        try {
          tokenResult = await Notifications.getExpoPushTokenAsync();
        } catch (innerErr) {
          console.warn('[NotificationService] getExpoPushTokenAsync fallback error:', innerErr.message);
        }
      }

      if (tokenResult && tokenResult.data) {
        this.pushToken = tokenResult.data;
        console.log(`[NotificationService] Expo Push Token obtained: ${this.pushToken}`);
        
        // Sync push token with backend server
        await this.syncPushTokenWithBackend(this.pushToken);
        return this.pushToken;
      }

      return null;
    } catch (err) {
      console.warn('[NotificationService] Error getting push token:', err.message);
      return null;
    }
  }

  /**
   * Send the obtained push token to backend API for user record
   */
  async syncPushTokenWithBackend(token, adminData = null) {
    if (!token) return;
    try {
      console.log('[NotificationService] Syncing admin push token with backend...');
      const payload = { pushToken: token };
      if (adminData && (adminData.id || adminData._id)) {
        payload.adminId = adminData.id || adminData._id;
      }
      if (adminData && adminData.mobile) {
        payload.mobile = adminData.mobile;
      }

      try {
        await apiClient.post('/admin/push-token', payload);
      } catch (adminErr) {
        console.log('[NotificationService] /admin/push-token error, falling back to /user/push-token:', adminErr.message);
        await apiClient.post('/user/push-token', payload);
      }
      console.log('[NotificationService] Push token successfully registered on server.');
    } catch (err) {
      console.warn('[NotificationService] Could not register push token on server:', err.message);
    }
  }

  /**
   * Show local heads-up incoming call alert banner with sound and vibration (when app is in foreground/background)
   */
  async showLocalCallNotification(callData) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `📞 Incoming ${callData?.callType || 'Voice'} Call`,
          body: `${callData?.callerName || 'Member'} is calling... Tap to answer`,
          sound: 'default',
          priority: Notifications.AndroidNotificationPriority.MAX,
          categoryIdentifier: 'INCOMING_CALL_CATEGORY',
          data: {
            type: 'INCOMING_CALL',
            ...callData
          }
        },
        trigger: null
      });
      console.log('[NotificationService] Triggered local call ringing notification');
    } catch (err) {
      console.warn('[NotificationService] Error showing local notification:', err.message);
    }
  }

  /**
   * Dismiss all ringing call notifications from system tray
   */
  async dismissCallNotifications() {
    try {
      await Notifications.dismissAllNotificationsAsync();
    } catch (e) {
      // Ignored
    }
  }
}

export const notificationService = new NotificationService();
export default notificationService;
