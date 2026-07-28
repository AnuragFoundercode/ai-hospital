const jwt = require('jsonwebtoken');
const userModel = require('../models/user.model');

// ─────────────────────────────────────────────
// USER CONTROLLER - Patient APIs
// ─────────────────────────────────────────────

// Static OTP for development
const STATIC_OTP = '111111';

/**
 * POST /api/v1/user/send-otp
 * Body: { mobile }
 * - If user exists, send OTP
 * - If user not exists, create user then send OTP
 */
const sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;

    // Validate mobile
    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: 'Valid 10-digit mobile number required.',
      });
    }

    // Check if user exists
    let user = await userModel.findByMobile(mobile);

    // If not exists, create new user
    if (!user) {
      await userModel.create(mobile);
    }

    // In production: send actual OTP via SMS
    // For now: static OTP 111111
    console.log(`📱 OTP for ${mobile}: ${STATIC_OTP}`);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully.',
      data: { mobile },
    });
  } catch (error) {
    console.error('sendOtp error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong.',
    });
  }
};

/**
 * POST /api/v1/user/verify-otp
 * Body: { mobile, otp, fcm_token }
 * - Verify OTP (static 111111)
 * - Save FCM token
 * - Return JWT + is_new_user flag
 */
const verifyOtp = async (req, res) => {
  try {
    const { mobile, otp, fcm_token } = req.body;

    // Validate
    if (!mobile || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Mobile and OTP required.',
      });
    }

    // Verify static OTP
    if (otp !== STATIC_OTP) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP.',
      });
    }

    // Find user
    const user = await userModel.findByMobile(mobile);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found. Please send OTP first.',
      });
    }

    // Mark verified
    await userModel.markVerified(user.id);

    // Save FCM token if provided
    if (fcm_token) {
      await userModel.updateFcmToken(user.id, fcm_token);
    }

    // Check if new user (no name means profile not completed)
    const is_new_user = !user.full_name || user.full_name.trim() === '';

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, uuid: user.uuid, role: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(200).json({
      success: true,
      message: is_new_user ? 'OTP verified. Please complete your profile.' : 'Login successful.',
      data: {
        token,
        is_new_user,
        user: {
          id: user.uuid,
          full_name: user.full_name,
          mobile: user.mobile,
          email: user.email,
          gender: user.gender,
          date_of_birth: user.date_of_birth,
          profile_photo: user.profile_photo,
        },
      },
    });
  } catch (error) {
    console.error('verifyOtp error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong.',
    });
  }
};

/**
 * PUT /api/v1/user/profile
 * Headers: Bearer token
 * Body: { full_name, email, gender, date_of_birth }
 */
const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { full_name, email, gender, date_of_birth } = req.body;

    // At least name is required
    if (!full_name || full_name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Full name is required.',
      });
    }

    // Update profile
    await userModel.updateProfile(userId, {
      full_name: full_name.trim(),
      email: email || null,
      gender: gender || null,
      date_of_birth: date_of_birth || null,
    });

    // Get updated user
    const user = await userModel.findById(userId);

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      data: {
        id: user.uuid,
        full_name: user.full_name,
        mobile: user.mobile,
        email: user.email,
        gender: user.gender,
        date_of_birth: user.date_of_birth,
        profile_photo: user.profile_photo,
      },
    });
  } catch (error) {
    console.error('updateProfile error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong.',
    });
  }
};

/**
 * GET /api/v1/user/profile
 * Headers: Bearer token
 */
const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await userModel.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile fetched.',
      data: {
        id: user.uuid,
        full_name: user.full_name,
        mobile: user.mobile,
        email: user.email,
        gender: user.gender,
        date_of_birth: user.date_of_birth,
        blood_group: user.blood_group,
        profile_photo: user.profile_photo,
        aadhaar_number: user.aadhaar_number,
        abha_number: user.abha_number,
        is_verified: user.is_verified,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    console.error('getProfile error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong.',
    });
  }
};

module.exports = {
  sendOtp,
  verifyOtp,
  updateProfile,
  getProfile,
};
