const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
const agoraConfig = require('../config/agora');

/**
 * Agora Video Consultation Service
 * Generates tokens for video calls between patient & doctor
 */
class AgoraService {
  /**
   * Generate RTC token for video consultation
   * @param {string} channelName - Unique channel (e.g., appointment_id)
   * @param {number} uid - User ID (0 for dynamic)
   * @param {string} role - 'publisher' or 'subscriber'
   * @param {number} expireTime - Token expiry in seconds (default 1 hour)
   */
  generateToken(channelName, uid = 0, role = 'publisher', expireTime = 3600) {
    if (!agoraConfig.appId || !agoraConfig.appCertificate) {
      throw new Error('Agora credentials not configured');
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const privilegeExpireTime = currentTime + expireTime;

    const rtcRole = role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

    const token = RtcTokenBuilder.buildTokenWithUid(
      agoraConfig.appId,
      agoraConfig.appCertificate,
      channelName,
      uid,
      rtcRole,
      privilegeExpireTime
    );

    return {
      token,
      appId: agoraConfig.appId,
      channelName,
      uid,
      expireAt: privilegeExpireTime,
    };
  }
}

module.exports = new AgoraService();
