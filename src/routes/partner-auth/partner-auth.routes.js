const express = require('express');
const router = express.Router();
const partnerAuthController = require('../../controllers/partner-auth/partner-auth.controller');

router.post('/send-otp', partnerAuthController.sendOtp);
router.post('/verify-otp', partnerAuthController.verifyOtp);
router.post('/select-role', partnerAuthController.selectRole);
router.post('/login-as', partnerAuthController.loginAs);

module.exports = router;
