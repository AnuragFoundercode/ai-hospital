require('dotenv').config();

/**
 * SMS Service - Send OTP & Notifications via SMS Gateway
 * Configure for MSG91 / Twilio / any provider
 */
class SmsService {
  constructor() {
    this.apiKey = process.env.SMS_API_KEY;
    this.senderId = process.env.SMS_SENDER_ID;
    this.templateId = process.env.SMS_TEMPLATE_ID;
  }

  /**
   * Send OTP to mobile number
   */
  async sendOtp(mobile, otp) {
    try {
      // TODO: Replace with actual SMS gateway API call
      console.log(`📱 OTP ${otp} sent to ${mobile}`);
      return { success: true, message: 'OTP sent successfully' };
    } catch (error) {
      console.error('SMS send failed:', error.message);
      return { success: false, message: 'Failed to send OTP' };
    }
  }

  /**
   * Send notification SMS
   */
  async sendNotification(mobile, message) {
    try {
      // TODO: Replace with actual SMS gateway API call
      console.log(`📱 SMS sent to ${mobile}: ${message}`);
      return { success: true, message: 'SMS sent successfully' };
    } catch (error) {
      console.error('SMS send failed:', error.message);
      return { success: false, message: 'Failed to send SMS' };
    }
  }

  /**
   * Generate random 6-digit OTP
   */
  generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

module.exports = new SmsService();
