const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const userAuth = require('../middlewares/user.auth');

// ─────────────────────────────────────────────
// USER ROUTES - Patient APIs
// ─────────────────────────────────────────────

// Public routes (no token needed)
router.post('/send-otp', userController.sendOtp);
router.post('/verify-otp', userController.verifyOtp);

// Protected routes (token required)
router.get('/profile', userAuth, userController.getProfile);
router.put('/profile', userAuth, userController.updateProfile);

module.exports = router;
