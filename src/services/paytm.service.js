const PaytmChecksum = require('paytmchecksum');
const https = require('https');
const paytmConfig = require('../config/paytm');

// ─────────────────────────────────────────────
// PAYTM PAYMENT SERVICE
// ─────────────────────────────────────────────

/**
 * Initiate Paytm transaction - generates txn token
 * Frontend will use this token to open Paytm SDK
 */
const initiateTransaction = async (orderId, amount, userId) => {
  const paytmParams = {
    body: {
      requestType: 'Payment',
      mid: paytmConfig.mid,
      websiteName: paytmConfig.website,
      orderId: orderId,
      callbackUrl: `${paytmConfig.callbackUrl}?orderId=${orderId}`,
      txnAmount: {
        value: amount.toFixed(2),
        currency: 'INR',
      },
      userInfo: {
        custId: userId.toString(),
      },
    },
  };

  // Generate checksum
  const checksum = await PaytmChecksum.generateSignature(
    JSON.stringify(paytmParams.body),
    paytmConfig.key
  );

  paytmParams.head = {
    signature: checksum,
  };

  // Call Paytm initiate transaction API
  const response = await callPaytmApi(
    `${paytmConfig.baseUrl}/theia/api/v1/initiateTransaction?mid=${paytmConfig.mid}&orderId=${orderId}`,
    paytmParams
  );

  return response;
};

/**
 * Verify transaction status after payment
 */
const verifyTransaction = async (orderId) => {
  const paytmParams = {
    body: {
      mid: paytmConfig.mid,
      orderId: orderId,
    },
  };

  const checksum = await PaytmChecksum.generateSignature(
    JSON.stringify(paytmParams.body),
    paytmConfig.key
  );

  paytmParams.head = {
    signature: checksum,
  };

  const response = await callPaytmApi(
    `${paytmConfig.baseUrl}/v3/order/status`,
    paytmParams
  );

  return response;
};

/**
 * Verify Paytm callback checksum
 */
const verifyChecksum = (params) => {
  const receivedChecksum = params.CHECKSUMHASH;
  const paramsWithoutChecksum = { ...params };
  delete paramsWithoutChecksum.CHECKSUMHASH;

  return PaytmChecksum.verifySignature(
    paramsWithoutChecksum,
    paytmConfig.key,
    receivedChecksum
  );
};

/**
 * Helper - Make HTTPS call to Paytm
 */
const callPaytmApi = (url, data) => {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': postData.length,
      },
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          resolve(responseData);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
};

module.exports = {
  initiateTransaction,
  verifyTransaction,
  verifyChecksum,
};
