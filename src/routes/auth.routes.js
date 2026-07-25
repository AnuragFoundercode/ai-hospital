const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const validate = require('../middlewares/validate');
const { sendOtpSchema, verifyOtpSchema, registerSchema } = require('../validators/auth.validator');

router.post('/send-otp', validate(sendOtpSchema), authController.sendOtp);
router.post('/verify-otp', validate(verifyOtpSchema), authController.verifyOtp);
router.post('/register', validate(registerSchema), authController.register);

module.exports = router;
