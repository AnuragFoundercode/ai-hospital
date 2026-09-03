const jwt = require('jsonwebtoken');
const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

const STATIC_OTP = '111111';

/**
 * POST /api/v1/partner-auth/send-otp
 * Common OTP for all partner types
 * Checks if mobile already registered in any role
 */
const sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ message: 'Valid 10-digit mobile required.' });

    // Check all partner tables
    const [delivery] = await pool.query('SELECT id FROM delivery_partners WHERE mobile = ?', [mobile]);
    const [collector] = await pool.query('SELECT id FROM sample_collectors WHERE mobile = ?', [mobile]);
    const [doctor] = await pool.query('SELECT id FROM doctors WHERE mobile = ?', [mobile]);
    const [ambulance] = await pool.query('SELECT id FROM ambulance_services WHERE mobile = ?', [mobile]);

    // Collect existing roles
    const existingRoles = [];
    if (delivery.length) existingRoles.push('delivery');
    if (collector.length) existingRoles.push('collector');
    if (doctor.length) existingRoles.push('doctor');
    if (ambulance.length) existingRoles.push('ambulance');

    console.log(`📱 Partner OTP for ${mobile}: ${STATIC_OTP}`);
    return res.status(200).json({
      message: 'OTP sent.',
      data: {
        mobile,
        is_registered: existingRoles.length > 0,
        registered_as: existingRoles.length > 0 ? existingRoles : null,
      },
    });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * POST /api/v1/partner-auth/verify-otp
 * Body: { mobile, otp, fcm_token }
 * Checks all partner tables - auto login if found, else select role (if not already registered anywhere)
 */
const verifyOtp = async (req, res) => {
  try {
    const { mobile, otp, fcm_token } = req.body;
    if (!mobile || !otp) return res.status(400).json({ message: 'Mobile and OTP required.' });
    if (otp !== STATIC_OTP) return res.status(400).json({ message: 'Invalid OTP.' });

    // Check all partner tables
    const [deliveryRows] = await pool.query('SELECT * FROM delivery_partners WHERE mobile = ?', [mobile]);
    const [collectorRows] = await pool.query('SELECT * FROM sample_collectors WHERE mobile = ?', [mobile]);
    const [doctorRows] = await pool.query('SELECT * FROM doctors WHERE mobile = ?', [mobile]);
    const [ambulanceRows] = await pool.query('SELECT * FROM ambulance_services WHERE mobile = ?', [mobile]);

    // Collect found roles
    const foundRoles = [];
    if (deliveryRows.length) foundRoles.push({ role: 'delivery', data: deliveryRows[0] });
    if (collectorRows.length) foundRoles.push({ role: 'collector', data: collectorRows[0] });
    if (doctorRows.length) foundRoles.push({ role: 'doctor', data: doctorRows[0] });
    if (ambulanceRows.length) foundRoles.push({ role: 'ambulance', data: ambulanceRows[0] });

    // Already registered in exactly 1 role → auto login
    if (foundRoles.length === 1) {
      const found = foundRoles[0];

      if (found.role === 'delivery') {
        if (fcm_token) await pool.query('UPDATE delivery_partners SET fcm_token = ?, is_verified_mobile = 1 WHERE id = ?', [fcm_token, found.data.id]);
        const token = jwt.sign({ id: found.data.id, uuid: found.data.uuid, role: 'delivery' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
        return res.status(200).json({ message: 'Login successful.', data: { token, role: 'delivery', is_new_user: !found.data.full_name, registration_step: found.data.registration_step || 0, verification_status: found.data.verification_status, partner: { id: found.data.uuid, full_name: found.data.full_name, mobile } } });
      }

      if (found.role === 'collector') {
        if (fcm_token) await pool.query('UPDATE sample_collectors SET fcm_token = ?, is_verified_mobile = 1 WHERE id = ?', [fcm_token, found.data.id]);
        const token = jwt.sign({ id: found.data.id, uuid: found.data.uuid, role: 'collector' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
        return res.status(200).json({ message: 'Login successful.', data: { token, role: 'collector', is_new_user: !found.data.full_name, registration_step: found.data.registration_step || 0, verification_status: found.data.verification_status, partner: { id: found.data.uuid, full_name: found.data.full_name, mobile } } });
      }

      if (found.role === 'doctor') {
        if (fcm_token) await pool.query('UPDATE doctors SET fcm_token = ? WHERE id = ?', [fcm_token, found.data.id]);
        const token = jwt.sign({ id: found.data.id, uuid: found.data.uuid, role: 'doctor' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
        return res.status(200).json({ message: 'Login successful.', data: { token, role: 'doctor', is_new_user: !found.data.full_name, registration_step: found.data.registration_step || 0, verification_status: found.data.verification_status, partner: { id: found.data.uuid, full_name: found.data.full_name, mobile } } });
      }

      if (found.role === 'ambulance') {
        if (fcm_token) await pool.query('UPDATE ambulance_services SET fcm_token = ?, is_verified_mobile = 1 WHERE id = ?', [fcm_token, found.data.id]);
        const token = jwt.sign({ id: found.data.id, uuid: found.data.uuid, role: 'ambulance' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
        return res.status(200).json({ message: 'Login successful.', data: { token, role: 'ambulance', is_new_user: !found.data.full_name, registration_step: found.data.registration_step || 0, verification_status: found.data.verification_status, partner: { id: found.data.uuid, full_name: found.data.full_name, mobile } } });
      }
    }

    // Multiple roles (rare) → let user pick
    if (foundRoles.length > 1) {
      return res.status(200).json({ message: 'Multiple roles found. Select role.', data: { is_new_user: false, select_role: true, available_roles: foundRoles.map(r => r.role), mobile } });
    }

    // New user → not in any table → select role to register
    return res.status(200).json({ message: 'OTP verified. Select your role to register.', data: { is_new_user: true, select_role: true, available_roles: ['delivery', 'collector', 'doctor', 'ambulance'], mobile } });

  } catch (error) { console.error('partner-auth verifyOtp error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * POST /api/v1/partner-auth/select-role
 * Body: { mobile, role, fcm_token }
 * Called after verify-otp when select_role = true (new user registration)
 * Enforces: 1 mobile = 1 role only
 */
const selectRole = async (req, res) => {
  try {
    const { mobile, role, fcm_token } = req.body;
    if (!mobile || !role) return res.status(400).json({ message: 'mobile and role required.' });
    if (!['delivery', 'collector', 'doctor', 'ambulance'].includes(role)) return res.status(400).json({ message: 'role must be "delivery", "collector", "doctor", or "ambulance".' });

    // Enforce 1 mobile = 1 role
    const [d] = await pool.query('SELECT id FROM delivery_partners WHERE mobile = ?', [mobile]);
    const [c] = await pool.query('SELECT id FROM sample_collectors WHERE mobile = ?', [mobile]);
    const [doc] = await pool.query('SELECT id FROM doctors WHERE mobile = ?', [mobile]);
    const [amb] = await pool.query('SELECT id FROM ambulance_services WHERE mobile = ?', [mobile]);
    if (d.length || c.length || doc.length || amb.length) {
      return res.status(409).json({ message: 'This mobile is already registered. One mobile can only have one role.' });
    }

    if (role === 'delivery') {
      const uuid = uuidv4();
      await pool.query('INSERT INTO delivery_partners (uuid, mobile, is_verified_mobile, fcm_token) VALUES (?, ?, 1, ?)', [uuid, mobile, fcm_token || null]);
      const [rows] = await pool.query('SELECT * FROM delivery_partners WHERE mobile = ?', [mobile]);
      const token = jwt.sign({ id: rows[0].id, uuid: rows[0].uuid, role: 'delivery' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
      return res.status(201).json({ message: 'Registered as Delivery Partner.', data: { token, role: 'delivery', is_new_user: true, registration_step: 0, verification_status: 'incomplete', partner: { id: rows[0].uuid, full_name: null, mobile } } });
    }

    if (role === 'collector') {
      const uuid = uuidv4();
      await pool.query('INSERT INTO sample_collectors (uuid, mobile, is_verified_mobile, fcm_token) VALUES (?, ?, 1, ?)', [uuid, mobile, fcm_token || null]);
      const [rows] = await pool.query('SELECT * FROM sample_collectors WHERE mobile = ?', [mobile]);
      const token = jwt.sign({ id: rows[0].id, uuid: rows[0].uuid, role: 'collector' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
      return res.status(201).json({ message: 'Registered as Sample Collector.', data: { token, role: 'collector', is_new_user: true, registration_step: 0, verification_status: 'incomplete', partner: { id: rows[0].uuid, full_name: null, mobile } } });
    }

    if (role === 'doctor') {
      const uuid = uuidv4();
      await pool.query("INSERT INTO doctors (uuid, full_name, mobile) VALUES (?, '', ?)", [uuid, mobile]);
      const [rows] = await pool.query('SELECT * FROM doctors WHERE mobile = ?', [mobile]);
      if (fcm_token) await pool.query('UPDATE doctors SET fcm_token = ? WHERE id = ?', [fcm_token, rows[0].id]);
      const token = jwt.sign({ id: rows[0].id, uuid: rows[0].uuid, role: 'doctor' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
      return res.status(201).json({ message: 'Registered as Doctor.', data: { token, role: 'doctor', is_new_user: true, registration_step: 0, verification_status: 'pending', partner: { id: rows[0].uuid, full_name: null, mobile } } });
    }

    if (role === 'ambulance') {
      const uuid = uuidv4();
      await pool.query("INSERT INTO ambulance_services (uuid, mobile, is_verified_mobile, fcm_token, verification_status, registration_step) VALUES (?, ?, 1, ?, 'incomplete', 0)", [uuid, mobile, fcm_token || null]);
      const [rows] = await pool.query('SELECT * FROM ambulance_services WHERE mobile = ?', [mobile]);
      const token = jwt.sign({ id: rows[0].id, uuid: rows[0].uuid, role: 'ambulance' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
      return res.status(201).json({ message: 'Registered as Ambulance Partner.', data: { token, role: 'ambulance', is_new_user: true, registration_step: 0, verification_status: 'incomplete', partner: { id: rows[0].uuid, full_name: null, mobile } } });
    }
  } catch (error) { console.error('partner-auth selectRole error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * POST /api/v1/partner-auth/login-as
 * Body: { mobile, role, fcm_token }
 * Called when user has both roles and selects one
 */
const loginAs = async (req, res) => {
  try {
    const { mobile, role, fcm_token } = req.body;
    if (!mobile || !role) return res.status(400).json({ message: 'mobile and role required.' });

    if (role === 'delivery') {
      const [rows] = await pool.query('SELECT * FROM delivery_partners WHERE mobile = ?', [mobile]);
      if (!rows.length) return res.status(404).json({ message: 'Not found.' });
      if (fcm_token) await pool.query('UPDATE delivery_partners SET fcm_token = ? WHERE id = ?', [fcm_token, rows[0].id]);
      const token = jwt.sign({ id: rows[0].id, uuid: rows[0].uuid, role: 'delivery' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
      return res.status(200).json({ message: 'Login successful.', data: { token, role: 'delivery', is_new_user: !rows[0].full_name, registration_step: rows[0].registration_step || 0, verification_status: rows[0].verification_status, partner: { id: rows[0].uuid, full_name: rows[0].full_name, mobile } } });
    }

    if (role === 'collector') {
      const [rows] = await pool.query('SELECT * FROM sample_collectors WHERE mobile = ?', [mobile]);
      if (!rows.length) return res.status(404).json({ message: 'Not found.' });
      if (fcm_token) await pool.query('UPDATE sample_collectors SET fcm_token = ? WHERE id = ?', [fcm_token, rows[0].id]);
      const token = jwt.sign({ id: rows[0].id, uuid: rows[0].uuid, role: 'collector' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
      return res.status(200).json({ message: 'Login successful.', data: { token, role: 'collector', is_new_user: !rows[0].full_name, registration_step: rows[0].registration_step || 0, verification_status: rows[0].verification_status, partner: { id: rows[0].uuid, full_name: rows[0].full_name, mobile } } });
    }

    return res.status(400).json({ message: 'Invalid role.' });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = { sendOtp, verifyOtp, selectRole, loginAs };
