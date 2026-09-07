const { getMessaging } = require('../config/firebase');

/**
 * Firebase Push Notification Service
 */
class NotificationService {
  /**
   * Send push notification to single device
   */
  /**
   * @param {object} options
   *   - dataOnly (bool): if true, send a DATA-ONLY message (no notification block).
   *       Used for vendors so their app can build a custom popup/handler in background.
   *       If false (default), send notification + data (best for user app / system tray).
   */
  async sendToDevice(fcmToken, title, body, data = {}, options = {}) {
    try {
      const messaging = getMessaging();
      if (!messaging) {
        console.warn('⚠️  Firebase not initialized, skipping notification');
        return { success: false, message: 'Firebase not configured' };
      }

      // All data values MUST be strings for FCM.
      const dataStr = {};
      for (const [k, v] of Object.entries(data || {})) dataStr[k] = v == null ? '' : String(v);
      // Always include title/body in data so a data-handler can build its own UI.
      dataStr.title = String(title || '');
      dataStr.body = String(body || '');

      const message = {
        token: fcmToken,
        data: dataStr,
        android: {
          priority: 'high',
          ...(options.dataOnly ? {} : { notification: { sound: 'default', channelId: 'high_importance_channel' } }),
        },
        apns: {
          headers: { 'apns-priority': '10' },
          payload: { aps: options.dataOnly ? { 'content-available': 1 } : { sound: 'default', 'content-available': 1 } },
        },
      };

      // Vendor (dataOnly) => no notification block (app handles popup).
      // User => include notification block for guaranteed system tray + background.
      if (!options.dataOnly) {
        message.notification = { title, body };
      }

      const response = await messaging.send(message);
      return { success: true, messageId: response };
    } catch (error) {
      console.error('🔔 [FCM FAILED]', error.code || '', error.message);
      return { success: false, message: error.message, code: error.code };
    }
  }

  /**
   * Send push notification to multiple devices
   */
  async sendToMultipleDevices(fcmTokens, title, body, data = {}) {
    try {
      const messaging = getMessaging();
      if (!messaging) return { success: false, message: 'Firebase not configured' };

      const message = {
        tokens: fcmTokens,
        notification: { title, body },
        data: { ...data },
      };

      const response = await messaging.sendEachForMulticast(message);
      console.log(`🔔 Notifications sent: ${response.successCount} success, ${response.failureCount} failed`);
      return { success: true, ...response };
    } catch (error) {
      console.error('Multicast notification failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Send notification to topic subscribers
   */
  async sendToTopic(topic, title, body, data = {}) {
    try {
      const messaging = getMessaging();
      if (!messaging) return { success: false, message: 'Firebase not configured' };

      const message = {
        topic,
        notification: { title, body },
        data: { ...data },
      };

      const response = await messaging.send(message);
      return { success: true, messageId: response };
    } catch (error) {
      console.error('Topic notification failed:', error.message);
      return { success: false, message: error.message };
    }
  }
}

module.exports = new NotificationService();
