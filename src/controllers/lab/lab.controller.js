const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const labModel = require('../../models/lab/lab.model');

// ─────────────────────────────────────────────
// LAB CONTROLLER - Lab Panel APIs
// ─────────────────────────────────────────────

/**
 * POST /api/v1/lab/register
 * Body: { name, owner_name, email, password, mobile, lab_license_number, gst_number, pan_number, nabl_accreditation_number, address, city, state, pincode, home_collection_available, opening_time, closing_time }
 */
const register = async (req, res) => {
  try {
    const { name, owner_name, email, password, mobile, lab_license_number, gst_number, pan_number, nabl_accreditation_number, address, city, state, pincode, home_collection_available, opening_time, closing_time } = req.body;

    // Validate required
    if (!name || !owner_name || !email || !password || !mobile || !lab_license_number || !address || !city || !state || !pincode) {
      return res.status(400).json({ message: 'Required fields: name, owner_name, email, password, mobile, lab_license_number, address, city, state, pincode' });
    }

    // Check duplicate email/mobile
    const existingEmail = await labModel.findByEmail(email);
    if (existingEmail) {
      return res.status(409).json({ message: 'Email already registered.' });
    }

    const existingMobile = await labModel.findByMobile(mobile);
    if (existingMobile) {
      return res.status(409).json({ message: 'Mobile already registered.' });
    }

    // Register
    const lab = await labModel.register({
      name, owner_name, email, password, mobile, lab_license_number,
      gst_number, pan_number, nabl_accreditation_number,
      address, city, state, pincode, home_collection_available, opening_time, closing_time
    });

    return res.status(201).json({      message: 'Registration successful! Your account is pending admin approval.',
      data: {
        id: lab.uuid,
        name,
        email,
        verification_status: 'pending',
      },
    });
  } catch (error) {
    console.error('lab register error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/lab/login
 * Body: { email, password, fcm_token }
 */
const login = async (req, res) => {
  try {
    const { email, password, fcm_token } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required.' });
    }

    const lab = await labModel.findByEmail(email);
    if (!lab) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // Verify password
    const isValid = await labModel.verifyPassword(password, lab.password_hash);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // Save FCM
    if (fcm_token) {
      await labModel.updateFcmToken(lab.id, fcm_token);
    }

    // Generate token
    const token = jwt.sign(
      { id: lab.id, uuid: lab.uuid, role: 'lab' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(200).json({      message: 'Login successful.',
      data: {
        token,
        lab: {
          id: lab.uuid,
          name: lab.name,
          email: lab.email,
          owner_name: lab.owner_name,
          verification_status: lab.verification_status,
          is_verified: lab.is_verified,
        },
      },
    });
  } catch (error) {
    console.error('lab login error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/lab/profile
 */
const getProfile = async (req, res) => {
  try {
    const labId = req.lab.id;
    const lab = await labModel.findById(labId);

    if (!lab) {
      return res.status(404).json({ message: 'Lab not found.' });
    }

    return res.status(200).json({      message: 'Profile fetched.',
      data: {
        id: lab.uuid,
        name: lab.name,
        owner_name: lab.owner_name,
        email: lab.email,
        mobile: lab.mobile,
        profile_photo: lab.profile_photo,
        lab_license_number: lab.lab_license_number,
        gst_number: lab.gst_number,
        pan_number: lab.pan_number,
        nabl_accreditation_number: lab.nabl_accreditation_number,
        documents: {
          nabl_certificate_url: lab.nabl_certificate_url,
          lab_license_url: lab.lab_license_url,
          gst_certificate_url: lab.gst_certificate_url,
          pan_card_url: lab.pan_card_url,
        },
        location: {
          address: lab.address_line1,
          address_line2: lab.address_line2,
          city: lab.city,
          state: lab.state,
          pincode: lab.pincode,
          latitude: lab.latitude,
          longitude: lab.longitude,
        },
        operations: {
          home_collection_available: lab.home_collection_available,
          home_collection_radius_km: lab.home_collection_radius_km,
          opening_time: lab.opening_time,
          closing_time: lab.closing_time,
        },
        verification_status: lab.verification_status,
        is_verified: lab.is_verified,
        average_rating: lab.average_rating,
        created_at: lab.created_at,
      },
    });
  } catch (error) {
    console.error('lab getProfile error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/lab/profile
 * Update lab profile (documents, timing etc.)
 */
const updateProfile = async (req, res) => {
  try {
    const labId = req.lab.id;

    // If mobile is being updated, check duplicate
    if (req.body.mobile) {
      const existing = await labModel.findByMobile(req.body.mobile);
      if (existing && existing.id !== labId) {
        return res.status(409).json({ message: 'Mobile number already in use by another lab.' });
      }
    }

    await labModel.updateProfile(labId, req.body);
    const lab = await labModel.findById(labId);

    return res.status(200).json({      message: 'Profile updated.',
      data: { id: lab.uuid, name: lab.name, verification_status: lab.verification_status },
    });
  } catch (error) {
    console.error('lab updateProfile error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/lab/change-password
 * Body: { current_password, new_password }
 */
const changePassword = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ message: 'Current password and new password required.' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters.' });
    }

    const lab = await labModel.findById(labId);

    const isValid = await bcrypt.compare(current_password, lab.password_hash);
    if (!isValid) {
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);
    const { pool } = require('../../config/database');
    await pool.query('UPDATE pathology_labs SET password_hash = ? WHERE id = ?', [hashedPassword, labId]);

    return res.status(200).json({ message: 'Password changed successfully.' });
  } catch (error) {
    console.error('lab changePassword error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/lab/forgot-password
 * Body: { email }
 * Sends OTP to registered mobile (static 111111 for now)
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email required.' });
    }

    const lab = await labModel.findByEmail(email);
    if (!lab) {
      return res.status(404).json({ message: 'No account found with this email.' });
    }

    // In production: send OTP to registered mobile/email
    // For now: static OTP 111111
    console.log(`📱 Lab forgot password OTP for ${lab.mobile}: 111111`);

    return res.status(200).json({      message: 'OTP sent to registered mobile number.',
      data: { email, mobile: lab.mobile.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2') },
    });
  } catch (error) {
    console.error('lab forgotPassword error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/lab/reset-password
 * Body: { email, otp, new_password }
 */
const resetPassword = async (req, res) => {
  try {
    const { email, otp, new_password } = req.body;

    if (!email || !otp || !new_password) {
      return res.status(400).json({ message: 'Email, OTP, and new password required.' });
    }

    if (otp !== '111111') {
      return res.status(400).json({ message: 'Invalid OTP.' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    const lab = await labModel.findByEmail(email);
    if (!lab) {
      return res.status(404).json({ message: 'No account found with this email.' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);
    const { pool } = require('../../config/database');
    await pool.query('UPDATE pathology_labs SET password_hash = ? WHERE id = ?', [hashedPassword, lab.id]);

    return res.status(200).json({ message: 'Password reset successfully. Please login.' });
  } catch (error) {
    console.error('lab resetPassword error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
};
