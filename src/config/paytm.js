require('dotenv').config();

const paytmConfig = {
  mid: process.env.PAYTM_MID,
  key: process.env.PAYTM_MERCHANT_KEY,
  website: process.env.PAYTM_WEBSITE || 'WEBSTAGING',
  callbackUrl: process.env.PAYTM_CALLBACK_URL || 'https://ai-hospital.innersoulcares.com/api/v1/user/booking/paytm/callback',
  // Staging: https://securestage.paytmpayments.com (new URL — old securegw-stage.paytm.in is deprecated)
  // Production: https://securegw.paytm.in
  baseUrl: process.env.PAYTM_ENV === 'production'
    ? 'https://securegw.paytm.in'
    : 'https://securestage.paytmpayments.com',
};

module.exports = paytmConfig;
