const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const diagnosticModel = require('../../models/diagnostic/diagnostic.model');

// ─────────────────────────────────────────────
// DIAGNOSTIC CENTER CONTROLLER
// ─────────────────────────────────────────────

/**
 * POST /api/v1/diagnostic/register
 */
const register = async (req, res) => {
  try {
    const { name, owner_name, email, password, mobile, registration_number, gst_number, pan_number, nabh_accreditation_number, address, city, state, pincode, opening_time, closing_time } = req.body;

    if (!name || !owner_name || !email || !password || !mobile || !registration_number || !address || !city || !state || !pincode) {
      return res.status(400).json({ message: 'Required: name, owner_name, email, password, mobile, registration_number, address, city, state, pincode' });
    }

    const existingEmail = await diagnosticModel.findByEmail(email);
    if (existingEmail) {
      return res.status(409).json({ message: 'Email already registered.' });
    }

    const existingMobile = await diagnosticModel.findByMobile(mobile);
    if (existingMobile) {
      return res.status(409).json({ message: 'Mobile already registered.' });
    }

    const center = await diagnosticModel.register({
      name, owner_name, email, password, mobile, registration_number,
      gst_number, pan_number, nabh_accreditation_number,
      address, city, state, pincode, opening_time, closing_time
    });

    return res.status(201).json({
      message: 'Registration successful! Your account is pending admin approval.',
      data: { id: center.uuid, name, email, verification_status: 'pending' },
    });
  } catch (error) {
    console.error('diagnostic register error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/diagnostic/login
 */
const login = async (req, res) => {
  try {
    const { email, password, fcm_token } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required.' });
    }

    const center = await diagnosticModel.findByEmail(email);
    if (!center) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const isValid = await diagnosticModel.verifyPassword(password, center.password_hash);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    if (fcm_token) {
      await diagnosticModel.updateFcmToken(center.id, fcm_token);
    }

    const token = jwt.sign(
      { id: center.id, uuid: center.uuid, role: 'diagnostic' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(200).json({
      message: 'Login successful.',
      data: {
        token,
        center: {
          id: center.uuid,
          name: center.name,
          email: center.email,
          verification_status: center.verification_status,
          is_verified: center.is_verified,
        },
      },
    });
  } catch (error) {
    console.error('diagnostic login error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/diagnostic/profile
 */
const getProfile = async (req, res) => {
  try {
    const center = await diagnosticModel.findById(req.diagnostic.id);
    if (!center) {
      return res.status(404).json({ message: 'Not found.' });
    }

    return res.status(200).json({
      message: 'Profile fetched.',
      data: {
        id: center.uuid,
        name: center.name,
        owner_name: center.owner_name,
        email: center.email,
        mobile: center.mobile,
        profile_photo: center.profile_photo,
        registration_number: center.registration_number,
        gst_number: center.gst_number,
        pan_number: center.pan_number,
        nabh_accreditation_number: center.nabh_accreditation_number,
        documents: {
          nabh_certificate_url: center.nabh_certificate_url,
          registration_certificate_url: center.registration_certificate_url,
          gst_certificate_url: center.gst_certificate_url,
          pan_card_url: center.pan_card_url,
        },
        location: {
          address: center.address_line1,
          address_line2: center.address_line2,
          city: center.city,
          state: center.state,
          pincode: center.pincode,
          latitude: center.latitude,
          longitude: center.longitude,
        },
        timing: {
          opening_time: center.opening_time,
          closing_time: center.closing_time,
        },
        verification_status: center.verification_status,
        is_verified: center.is_verified,
        average_rating: center.average_rating,
        created_at: center.created_at,
      },
    });
  } catch (error) {
    console.error('diagnostic getProfile error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/diagnostic/profile
 */
const updateProfile = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;

    if (req.body.mobile) {
      const existing = await diagnosticModel.findByMobile(req.body.mobile);
      if (existing && existing.id !== centerId) {
        return res.status(409).json({ message: 'Mobile already in use.' });
      }
    }

    await diagnosticModel.updateProfile(centerId, req.body);
    const center = await diagnosticModel.findById(centerId);

    return res.status(200).json({
      message: 'Profile updated.',
      data: { id: center.uuid, name: center.name, verification_status: center.verification_status },
    });
  } catch (error) {
    console.error('diagnostic updateProfile error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/diagnostic/change-password
 */
const changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password || new_password.length < 6) {
      return res.status(400).json({ message: 'Current and new password (min 6 chars) required.' });
    }

    const center = await diagnosticModel.findById(req.diagnostic.id);
    const isValid = await bcrypt.compare(current_password, center.password_hash);
    if (!isValid) {
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }

    const hashed = await bcrypt.hash(new_password, 10);
    const { pool } = require('../../config/database');
    await pool.query('UPDATE diagnostic_centers SET password_hash = ? WHERE id = ?', [hashed, req.diagnostic.id]);

    return res.status(200).json({ message: 'Password changed.' });
  } catch (error) {
    console.error('diagnostic changePassword error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/diagnostic/forgot-password
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required.' });

    const center = await diagnosticModel.findByEmail(email);
    if (!center) return res.status(404).json({ message: 'No account found.' });

    console.log(`📱 Diagnostic forgot OTP for ${center.mobile}: 111111`);

    return res.status(200).json({
      message: 'OTP sent to registered mobile.',
      data: { email, mobile: center.mobile.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2') },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/diagnostic/reset-password
 */
const resetPassword = async (req, res) => {
  try {
    const { email, otp, new_password } = req.body;

    if (!email || !otp || !new_password) return res.status(400).json({ message: 'Email, OTP, new password required.' });
    if (otp !== '111111') return res.status(400).json({ message: 'Invalid OTP.' });
    if (new_password.length < 6) return res.status(400).json({ message: 'Password min 6 chars.' });

    const center = await diagnosticModel.findByEmail(email);
    if (!center) return res.status(404).json({ message: 'No account found.' });

    const hashed = await bcrypt.hash(new_password, 10);
    const { pool } = require('../../config/database');
    await pool.query('UPDATE diagnostic_centers SET password_hash = ? WHERE id = ?', [hashed, center.id]);

    return res.status(200).json({ message: 'Password reset. Please login.' });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/diagnostic/bank-details
 */
const getBankDetails = async (req, res) => {
  try {
    const { pool } = require('../../config/database');
    const [rows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM diagnostic_bank_details WHERE diagnostic_center_id = ?', [req.diagnostic.id]);

    return res.status(200).json({ message: 'Bank details fetched.', data: rows[0] || null });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/diagnostic/bank-details
 * Body: { account_holder_name, bank_name, account_number, ifsc_code }
 */
const updateBankDetails = async (req, res) => {
  try {
    const { account_holder_name, bank_name, account_number, ifsc_code } = req.body;

    if (!account_holder_name || !bank_name || !account_number || !ifsc_code) {
      return res.status(400).json({ message: 'All bank fields required.' });
    }

    const { pool } = require('../../config/database');
    const centerId = req.diagnostic.id;

    const [existing] = await pool.query('SELECT id FROM diagnostic_bank_details WHERE diagnostic_center_id = ?', [centerId]);

    if (existing.length) {
      await pool.query('UPDATE diagnostic_bank_details SET account_holder_name = ?, bank_name = ?, account_number = ?, ifsc_code = ? WHERE diagnostic_center_id = ?',
        [account_holder_name, bank_name, account_number, ifsc_code, centerId]);
    } else {
      await pool.query('INSERT INTO diagnostic_bank_details (diagnostic_center_id, account_holder_name, bank_name, account_number, ifsc_code) VALUES (?, ?, ?, ?, ?)',
        [centerId, account_holder_name, bank_name, account_number, ifsc_code]);
    }

    return res.status(200).json({ message: 'Bank details saved.' });
  } catch (error) {
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
  getBankDetails,
  updateBankDetails,
};
