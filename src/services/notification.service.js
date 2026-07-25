const { getMessaging } = require('../config/firebase');

/**
 * Firebase Push Notification Service
 */
class NotificationService {
  /**
   * Send push notification to single device
   */
  async sendToDevice(fcmToken, title, body, data = {}) {
    try {
      const messaging = getMessaging();
      if (!messaging) {
        console.warn('⚠️  Firebase not initialized, skipping notification');
        return { success: false, message: 'Firebase not configured' };
      }

      const message = {
        token: fcmToken,
        notification: { title, body },
        data: { ...data },
        android: {
          priority: 'high',
          notification: { sound: 'default' },
        },
        apns: {
          payload: { aps: { sound: 'default' } },
        },
      };

      const response = await messaging.send(message);
      console.log('🔔 Notification sent:', response);
      return { success: true, messageId: response };
    } catch (error) {
      console.error('Notification failed:', error.message);
      return { success: false, message: error.message };
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
