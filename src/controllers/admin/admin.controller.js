const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN CONTROLLER
// ─────────────────────────────────────────────

/**
 * POST /api/v1/admin/login
 * Body: { email, password }
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required.' });
    }

    const [rows] = await pool.query('SELECT * FROM admins WHERE email = ? AND is_active = 1', [email]);
    if (!rows.length) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const admin = rows[0];
    const isValid = await bcrypt.compare(password, admin.password_hash);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // Update last login
    await pool.query('UPDATE admins SET last_login = NOW() WHERE id = ?', [admin.id]);

    const token = jwt.sign(
      { id: admin.id, uuid: admin.uuid, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(200).json({
      message: 'Login successful.',
      data: {
        token,
        admin: {
          id: admin.uuid,
          full_name: admin.full_name,
          email: admin.email,
          role: admin.role,
        },
      },
    });
  } catch (error) {
    console.error('admin login error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/profile
 */
const getProfile = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT uuid, full_name, email, mobile, role, last_login, created_at FROM admins WHERE id = ?', [req.admin.id]);
    if (!rows.length) return res.status(404).json({ message: 'Admin not found.' });

    return res.status(200).json({ message: 'Profile fetched.', data: rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/change-password
 * Body: { current_password, new_password }
 */
const changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password || new_password.length < 6) {
      return res.status(400).json({ message: 'Current and new password (min 6 chars) required.' });
    }

    const [rows] = await pool.query('SELECT password_hash FROM admins WHERE id = ?', [req.admin.id]);
    const isValid = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!isValid) return res.status(400).json({ message: 'Current password incorrect.' });

    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE admins SET password_hash = ? WHERE id = ?', [hashed, req.admin.id]);

    return res.status(200).json({ message: 'Password changed.' });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  login,
  getProfile,
  changePassword,
};
