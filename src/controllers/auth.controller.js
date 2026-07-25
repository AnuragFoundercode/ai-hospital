const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const UserModel = require('../models/User.model');
const smsService = require('../services/sms.service');
const { pool } = require('../config/database');
const { success, created, error } = require('../utils/response');

class AuthController {
  /**
   * Send OTP to mobile number
   */
  async sendOtp(req, res, next) {
    try {
      const { mobile } = req.body;
      const otp = smsService.generateOtp();

      // Store OTP in database
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry
      await pool.query(
        'INSERT INTO otp_verifications (mobile, otp, purpose, expires_at) VALUES (?, ?, ?, ?)',
        [mobile, otp, 'login', expiresAt]
      );

      // Send OTP via SMS
      await smsService.sendOtp(mobile, otp);

      return success(res, { mobile }, 'OTP sent successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * Verify OTP and login/register
   */
  async verifyOtp(req, res, next) {
    try {
      const { mobile, otp } = req.body;

      // Check OTP
      const [otpRecords] = await pool.query(
        'SELECT * FROM otp_verifications WHERE mobile = ? AND otp = ? AND is_used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
        [mobile, otp]
      );

      if (otpRecords.length === 0) {
        return error(res, 'Invalid or expired OTP', 400);
      }

      // Mark OTP as used
      await pool.query('UPDATE otp_verifications SET is_used = 1 WHERE id = ?', [otpRecords[0].id]);

      // Check if user exists
      let user = await UserModel.findByMobile(mobile);
      let isNewUser = false;

      if (!user) {
        isNewUser = true;
        // Return that registration is needed
        return success(res, { mobile, isNewUser: true }, 'OTP verified. Please complete registration.');
      }

      // Mark user as verified
      await UserModel.verifyUser(user.id);

      // Generate JWT
      const token = jwt.sign(
        { id: user.id, uuid: user.uuid, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );

      return success(res, { token, user: { id: user.uuid, name: user.full_name, role: user.role }, isNewUser }, 'Login successful');
    } catch (err) {
      next(err);
    }
  }

  /**
   * Register new user
   */
  async register(req, res, next) {
    try {
      const { full_name, mobile, email, role } = req.body;

      // Check if already registered
      const existingUser = await UserModel.findByMobile(mobile);
      if (existingUser) {
        return error(res, 'Mobile number already registered', 409);
      }

      // Create user
      const uuid = uuidv4();
      await UserModel.create({ uuid, full_name, mobile, email, role });

      const user = await UserModel.findByMobile(mobile);

      // Create wallet for user
      await pool.query('INSERT INTO wallets (user_id) VALUES (?)', [user.id]);

      // Generate JWT
      const token = jwt.sign(
        { id: user.id, uuid: user.uuid, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );

      return created(res, { token, user: { id: uuid, name: full_name, role } }, 'Registration successful');
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AuthController();
