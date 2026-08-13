const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const bloodbankModel = require('../../models/bloodbank/bloodbank.model');

// ─────────────────────────────────────────────
// BLOOD BANK CONTROLLER
// ─────────────────────────────────────────────

/**
 * POST /api/v1/bloodbank/register
 * Body: { name, contact_person, email, password, mobile, license_number, gst_number, pan_number, blood_bank_category, address, city, state, pincode, is_24hours, opening_time, closing_time }
 */
const register = async (req, res) => {
  try {
    const { name, contact_person, email, password, mobile, license_number, gst_number, pan_number, blood_bank_category, address, address2, landmark, city, state, pincode, zone_id, latitude, longitude, is_24hours, opening_time, closing_time, license_url, gst_certificate_url, pan_card_url, profile_photo } = req.body;

    // Validate required fields
    if (!name || !contact_person || !email || !password || !mobile || !license_number || !address || !city || !state || !pincode) {
      return res.status(400).json({ message: 'Required fields: name, contact_person, email, password, mobile, license_number, address, city, state, pincode' });
    }

    // Check duplicate email
    const existingEmail = await bloodbankModel.findByEmail(email);
    if (existingEmail) {
      return res.status(409).json({ message: 'Email already registered.' });
    }

    // Check duplicate mobile
    const existingMobile = await bloodbankModel.findByMobile(mobile);
    if (existingMobile) {
      return res.status(409).json({ message: 'Mobile already registered.' });
    }

    // Register
    const bloodbank = await bloodbankModel.register({
      name, contact_person, email, password, mobile, license_number,
      gst_number, pan_number, blood_bank_category,
      address, address2, landmark, city, state, pincode, zone_id, latitude, longitude,
      is_24hours, opening_time, closing_time,
      license_url, gst_certificate_url, pan_card_url, profile_photo
    });

    return res.status(201).json({
      message: 'Registration successful! Your account is pending admin approval.',
      data: {
        id: bloodbank.uuid,
        name,
        email,
        verification_status: 'pending',
      },
    });
  } catch (error) {
    console.error('bloodbank register error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/bloodbank/login
 * Body: { email, password, fcm_token }
 */
const login = async (req, res) => {
  try {
    const { email, password, fcm_token } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required.' });
    }

    const bloodbank = await bloodbankModel.findByEmail(email);
    if (!bloodbank) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // Verify password
    const isValid = await bloodbankModel.verifyPassword(password, bloodbank.password_hash);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // Save FCM token
    if (fcm_token) {
      await bloodbankModel.updateFcmToken(bloodbank.id, fcm_token);
    }

    // Generate JWT
    const token = jwt.sign(
      { id: bloodbank.id, uuid: bloodbank.uuid, role: 'bloodbank' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(200).json({
      message: 'Login successful.',
      data: {
        token,
        bloodbank: {
          id: bloodbank.uuid,
          name: bloodbank.name,
          email: bloodbank.email,
          contact_person: bloodbank.contact_person,
          verification_status: bloodbank.verification_status,
          is_verified: bloodbank.is_verified,
        },
      },
    });
  } catch (error) {
    console.error('bloodbank login error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/bloodbank/profile
 */
const getProfile = async (req, res) => {
  try {
    const bloodbankId = req.bloodbank.id;
    const bloodbank = await bloodbankModel.findById(bloodbankId);

    if (!bloodbank) {
      return res.status(404).json({ message: 'Blood bank not found.' });
    }

    return res.status(200).json({
      message: 'Profile fetched.',
      data: {
        id: bloodbank.uuid,
        name: bloodbank.name,
        contact_person: bloodbank.contact_person,
        email: bloodbank.email,
        mobile: bloodbank.mobile,
        profile_photo: bloodbank.profile_photo,
        license_number: bloodbank.license_number,
        gst_number: bloodbank.gst_number,
        pan_number: bloodbank.pan_number,
        blood_bank_category: bloodbank.blood_bank_category,
        documents: {
          license_url: bloodbank.license_url,
          gst_certificate_url: bloodbank.gst_certificate_url,
          pan_card_url: bloodbank.pan_card_url,
        },
        location: {
          address: bloodbank.address_line1,
          address_line2: bloodbank.address_line2,
          landmark: bloodbank.landmark,
          city: bloodbank.city,
          state: bloodbank.state,
          pincode: bloodbank.pincode,
          zone_id: bloodbank.zone_id,
          latitude: bloodbank.latitude,
          longitude: bloodbank.longitude,
        },
        operations: {
          is_24hours: bloodbank.is_24hours,
          opening_time: bloodbank.opening_time,
          closing_time: bloodbank.closing_time,
        },
        verification_status: bloodbank.verification_status,
        is_verified: bloodbank.is_verified,
        created_at: bloodbank.created_at,
      },
    });
  } catch (error) {
    console.error('bloodbank getProfile error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/bloodbank/profile
 */
const updateProfile = async (req, res) => {
  try {
    const bloodbankId = req.bloodbank.id;

    // If mobile is being updated, check duplicate
    if (req.body.mobile) {
      const existing = await bloodbankModel.findByMobile(req.body.mobile);
      if (existing && existing.id !== bloodbankId) {
        return res.status(409).json({ message: 'Mobile number already in use by another blood bank.' });
      }
    }

    await bloodbankModel.updateProfile(bloodbankId, req.body);
    const bloodbank = await bloodbankModel.findById(bloodbankId);

    return res.status(200).json({
      message: 'Profile updated.',
      data: {
        id: bloodbank.uuid,
        name: bloodbank.name,
        contact_person: bloodbank.contact_person,
        email: bloodbank.email,
        mobile: bloodbank.mobile,
        profile_photo: bloodbank.profile_photo,
        license_number: bloodbank.license_number,
        gst_number: bloodbank.gst_number,
        pan_number: bloodbank.pan_number,
        blood_bank_category: bloodbank.blood_bank_category,
        documents: {
          license_url: bloodbank.license_url,
          gst_certificate_url: bloodbank.gst_certificate_url,
          pan_card_url: bloodbank.pan_card_url,
        },
        location: {
          address: bloodbank.address_line1,
          address_line2: bloodbank.address_line2,
          landmark: bloodbank.landmark,
          city: bloodbank.city,
          state: bloodbank.state,
          pincode: bloodbank.pincode,
          zone_id: bloodbank.zone_id,
          latitude: bloodbank.latitude,
          longitude: bloodbank.longitude,
        },
        operations: {
          is_24hours: bloodbank.is_24hours,
          opening_time: bloodbank.opening_time,
          closing_time: bloodbank.closing_time,
        },
        verification_status: bloodbank.verification_status,
        is_verified: bloodbank.is_verified,
      },
    });
  } catch (error) {
    console.error('bloodbank updateProfile error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/bloodbank/change-password
 * Body: { current_password, new_password }
 */
const changePassword = async (req, res) => {
  try {
    const bloodbankId = req.bloodbank.id;
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ message: 'Current password and new password required.' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters.' });
    }

    const bloodbank = await bloodbankModel.findById(bloodbankId);

    const isValid = await bcrypt.compare(current_password, bloodbank.password_hash);
    if (!isValid) {
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);
    const { pool } = require('../../config/database');
    await pool.query('UPDATE blood_banks SET password_hash = ? WHERE id = ?', [hashedPassword, bloodbankId]);

    return res.status(200).json({ message: 'Password changed successfully.' });
  } catch (error) {
    console.error('bloodbank changePassword error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/bloodbank/forgot-password
 * Body: { email } OR { mobile }
 * Sends OTP to registered email or mobile (static 111111 for dev)
 */
const forgotPassword = async (req, res) => {
  try {
    const { email, mobile } = req.body;

    if (!email && !mobile) {
      return res.status(400).json({ message: 'Email or mobile required.' });
    }

    let bloodbank = null;

    if (email) {
      bloodbank = await bloodbankModel.findByEmail(email);
    } else {
      bloodbank = await bloodbankModel.findByMobile(mobile);
    }

    if (!bloodbank) {
      return res.status(404).json({ message: 'No account found.' });
    }

    // In production: send OTP via email/SMS service
    // For now: static OTP 111111
    console.log(`📱 Blood bank forgot password OTP for ${bloodbank.email || bloodbank.mobile}: 111111`);

    return res.status(200).json({
      message: email ? 'OTP sent to registered email.' : 'OTP sent to registered mobile number.',
      data: {
        email: bloodbank.email ? bloodbank.email.replace(/(.{2})(.*)(@.*)/, '$1****$3') : null,
        mobile: bloodbank.mobile ? bloodbank.mobile.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2') : null,
      },
    });
  } catch (error) {
    console.error('bloodbank forgotPassword error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/bloodbank/reset-password
 * Body: { email/mobile, otp, new_password }
 */
const resetPassword = async (req, res) => {
  try {
    const { email, mobile, otp, new_password } = req.body;

    if ((!email && !mobile) || !otp || !new_password) {
      return res.status(400).json({ message: 'Email or mobile, OTP, and new password required.' });
    }

    if (otp !== '111111') {
      return res.status(400).json({ message: 'Invalid OTP.' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    let bloodbank = null;
    if (email) {
      bloodbank = await bloodbankModel.findByEmail(email);
    } else {
      bloodbank = await bloodbankModel.findByMobile(mobile);
    }

    if (!bloodbank) {
      return res.status(404).json({ message: 'No account found.' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);
    const { pool } = require('../../config/database');
    await pool.query('UPDATE blood_banks SET password_hash = ? WHERE id = ?', [hashedPassword, bloodbank.id]);

    return res.status(200).json({ message: 'Password reset successfully. Please login.' });
  } catch (error) {
    console.error('bloodbank resetPassword error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/bloodbank/bank-details
 */
const getBankDetails = async (req, res) => {
  try {
    const { pool } = require('../../config/database');
    const [rows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM bloodbank_bank_details WHERE blood_bank_id = ?', [req.bloodbank.id]);

    return res.status(200).json({ message: 'Bank details fetched.', data: rows[0] || null });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/bloodbank/bank-details
 * Body: { account_holder_name, bank_name, account_number, ifsc_code }
 */
const updateBankDetails = async (req, res) => {
  try {
    const { account_holder_name, bank_name, account_number, ifsc_code } = req.body;

    if (!account_holder_name || !bank_name || !account_number || !ifsc_code) {
      return res.status(400).json({ message: 'All bank fields required.' });
    }

    const { pool } = require('../../config/database');
    const bloodbankId = req.bloodbank.id;

    const [existing] = await pool.query('SELECT id FROM bloodbank_bank_details WHERE blood_bank_id = ?', [bloodbankId]);

    if (existing.length) {
      await pool.query('UPDATE bloodbank_bank_details SET account_holder_name = ?, bank_name = ?, account_number = ?, ifsc_code = ? WHERE blood_bank_id = ?',
        [account_holder_name, bank_name, account_number, ifsc_code, bloodbankId]);
    } else {
      await pool.query('INSERT INTO bloodbank_bank_details (blood_bank_id, account_holder_name, bank_name, account_number, ifsc_code) VALUES (?, ?, ?, ?, ?)',
        [bloodbankId, account_holder_name, bank_name, account_number, ifsc_code]);
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
