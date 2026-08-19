const jwt = require('jsonwebtoken');
const userModel = require('../../models/user/user.model');

// ─────────────────────────────────────────────
// USER CONTROLLER - Patient APIs
// ─────────────────────────────────────────────

// Static OTP for development
const STATIC_OTP = '111111';

/**
 * POST /api/v1/user/send-otp
 * Body: { mobile }
 */
const sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({        message: 'Valid 10-digit mobile number required.',
      });
    }

    let user = await userModel.findByMobile(mobile);

    if (!user) {
      await userModel.create(mobile);
    }

    console.log(`📱 OTP for ${mobile}: ${STATIC_OTP}`);

    return res.status(200).json({      message: 'OTP sent successfully.',
      data: { mobile },
    });
  } catch (error) {
    console.error('sendOtp error:', error.message);
    return res.status(500).json({      message: 'Something went wrong.',
    });
  }
};

/**
 * POST /api/v1/user/verify-otp
 * Body: { mobile, otp, fcm_token }
 */
const verifyOtp = async (req, res) => {
  try {
    const { mobile, otp, fcm_token } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({        message: 'Mobile and OTP required.',
      });
    }

    if (otp !== STATIC_OTP) {
      return res.status(400).json({        message: 'Invalid OTP.',
      });
    }

    const user = await userModel.findByMobile(mobile);
    if (!user) {
      return res.status(404).json({        message: 'User not found. Please send OTP first.',
      });
    }

    await userModel.markVerified(user.id);

    if (fcm_token) {
      await userModel.updateFcmToken(user.id, fcm_token);
    }

    const is_new_user = !user.full_name || user.full_name.trim() === '';

    const token = jwt.sign(
      { id: user.id, uuid: user.uuid, role: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(200).json({      message: is_new_user ? 'OTP verified. Please complete your profile.' : 'Login successful.',
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
    return res.status(500).json({      message: 'Something went wrong.',
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

    if (!full_name || full_name.trim() === '') {
      return res.status(400).json({        message: 'Full name is required.',
      });
    }

    await userModel.updateProfile(userId, {
      full_name: full_name.trim(),
      email: email || null,
      gender: gender || null,
      date_of_birth: date_of_birth || null,
    });

    const user = await userModel.findById(userId);

    return res.status(200).json({      message: 'Profile updated successfully.',
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
    return res.status(500).json({      message: 'Something went wrong.',
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
      return res.status(404).json({        message: 'User not found.',
      });
    }

    return res.status(200).json({      message: 'Profile fetched.',
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
    return res.status(500).json({      message: 'Something went wrong.',
    });
  }
};

// ─────────────────────────────────────────────
// ADDRESS MANAGEMENT
// ─────────────────────────────────────────────

const getAddresses = async (req, res) => {
  try {
    const { pool } = require('../../config/database');
    const [rows] = await pool.query('SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC', [req.user.id]);
    return res.status(200).json({
      message: 'Addresses fetched.',
      data: rows.map(a => ({ id: a.id, label: a.label, name: a.name, mobile: a.mobile, address_line1: a.address_line1, address_line2: a.address_line2, landmark: a.landmark, city: a.city, state: a.state, pincode: a.pincode, latitude: a.latitude, longitude: a.longitude, is_default: a.is_default })),
    });
  } catch (error) {
    console.error('getAddresses error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const addAddress = async (req, res) => {
  try {
    const { pool } = require('../../config/database');
    const userId = req.user.id;
    const { label, name, mobile, address_line1, address_line2, landmark, city, state, pincode, latitude, longitude, is_default } = req.body;

    if (!name || !mobile || !address_line1 || !city || !state || !pincode) {
      return res.status(400).json({ message: 'Required: name, mobile, address_line1, city, state, pincode' });
    }

    // If setting as default, remove other defaults
    if (is_default) {
      await pool.query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [userId]);
    }

    const [result] = await pool.query(
      'INSERT INTO user_addresses (user_id, label, name, mobile, address_line1, address_line2, landmark, city, state, pincode, latitude, longitude, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, label || 'home', name, mobile, address_line1, address_line2 || null, landmark || null, city, state, pincode, latitude || null, longitude || null, is_default ? 1 : 0]
    );

    return res.status(201).json({ message: 'Address added.', data: { id: result.insertId } });
  } catch (error) {
    console.error('addAddress error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const updateAddress = async (req, res) => {
  try {
    const { pool } = require('../../config/database');
    const userId = req.user.id;
    const { id } = req.params;

    const [existing] = await pool.query('SELECT id FROM user_addresses WHERE id = ? AND user_id = ?', [id, userId]);
    if (!existing.length) return res.status(404).json({ message: 'Address not found.' });

    const allowedFields = ['label', 'name', 'mobile', 'address_line1', 'address_line2', 'landmark', 'city', 'state', 'pincode', 'latitude', 'longitude', 'is_default'];
    const fields = []; const values = [];

    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(key === 'is_default' ? (req.body[key] ? 1 : 0) : req.body[key]);
      }
    }

    if (!fields.length) return res.status(400).json({ message: 'Nothing to update.' });

    // If setting as default, remove other defaults
    if (req.body.is_default) {
      await pool.query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [userId]);
    }

    values.push(id, userId);
    await pool.query(`UPDATE user_addresses SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
    return res.status(200).json({ message: 'Address updated.' });
  } catch (error) {
    console.error('updateAddress error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const deleteAddress = async (req, res) => {
  try {
    const { pool } = require('../../config/database');
    const [result] = await pool.query('DELETE FROM user_addresses WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Address not found.' });
    return res.status(200).json({ message: 'Address deleted.' });
  } catch (error) {
    console.error('deleteAddress error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  sendOtp,
  verifyOtp,
  updateProfile,
  getProfile,
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
};
