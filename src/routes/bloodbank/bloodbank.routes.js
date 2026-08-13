const express = require('express');
const router = express.Router();
const bloodbankController = require('../../controllers/bloodbank/bloodbank.controller');
const bloodbankAuth = require('../../middlewares/bloodbank/bloodbank.auth');

// ─────────────────────────────────────────────
// BLOOD BANK ROUTES
// ─────────────────────────────────────────────

// Public routes
router.post('/register', bloodbankController.register);
router.post('/login', bloodbankController.login);
router.post('/forgot-password', bloodbankController.forgotPassword);
router.post('/reset-password', bloodbankController.resetPassword);

// Protected routes (blood bank token required)
router.get('/profile', bloodbankAuth, bloodbankController.getProfile);
router.put('/profile', bloodbankAuth, bloodbankController.updateProfile);
router.put('/change-password', bloodbankAuth, bloodbankController.changePassword);

// Bank details
router.get('/bank-details', bloodbankAuth, bloodbankController.getBankDetails);
router.put('/bank-details', bloodbankAuth, bloodbankController.updateBankDetails);

module.exports = router;
