require('dotenv').config();

const agoraConfig = {
  appId: process.env.AGORA_APP_ID,
  appCertificate: process.env.AGORA_APP_CERTIFICATE,
};

module.exports = agoraConfig;
