require('dotenv').config();

const paytmConfig = {
  mid: process.env.PAYTM_MID,
  key: process.env.PAYTM_MERCHANT_KEY,
  website: process.env.PAYTM_WEBSITE || 'WEBSTAGING',
  callbackUrl: process.env.PAYTM_CALLBACK_URL || 'http://localhost:3000/api/v1/user/booking/paytm/callback',
  // For testing: https://securegw-stage.paytm.in
  // For production: https://securegw.paytm.in
  baseUrl: process.env.PAYTM_ENV === 'production'
    ? 'https://securegw.paytm.in'
    : 'https://securegw-stage.paytm.in',
};

module.exports = paytmConfig;
