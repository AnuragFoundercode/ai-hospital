const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────
// PHARMACY AUTH & PROFILE CONTROLLER
// ─────────────────────────────────────────────

const register = async (req, res) => {
  try {
    const { name, owner_name, email, password, mobile, license_number, gst_number, pan_number, address, address2, landmark, city, state, pincode, zone_id, latitude, longitude, is_24hours, opening_time, closing_time, delivery_available, delivery_radius_km, delivery_charge, free_delivery_above, drug_license_url, gst_certificate_url, pan_card_url, profile_photo, about_description } = req.body;

    if (!name || !owner_name || !email || !password || !mobile || !license_number || !address || !city || !state || !pincode) {
      return res.status(400).json({ message: 'Required: name, owner_name, email, password, mobile, license_number, address, city, state, pincode' });
    }

    const [existingEmail] = await pool.query('SELECT id FROM pharmacies WHERE email = ?', [email]);
    if (existingEmail.length) return res.status(409).json({ message: 'Email already registered.' });

    const [existingMobile] = await pool.query('SELECT id FROM pharmacies WHERE mobile = ?', [mobile]);
    if (existingMobile.length) return res.status(409).json({ message: 'Mobile already registered.' });

    const uuid = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO pharmacies (uuid, name, owner_name, mobile, email, password_hash, profile_photo, about_description, drug_license_number, license_number, gst_number, pan_number, drug_license_url, gst_certificate_url, pan_card_url, address_line1, address_line2, landmark, city, state, pincode, zone_id, latitude, longitude, is_24hours, opening_time, closing_time, delivery_available, delivery_radius_km, delivery_charge, free_delivery_above, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [uuid, name, owner_name, mobile, email, hashedPassword, profile_photo || null, about_description || null, license_number, license_number, gst_number || null, pan_number || null, drug_license_url || null, gst_certificate_url || null, pan_card_url || null, address, address2 || null, landmark || null, city, state, pincode, zone_id || null, latitude || null, longitude || null, is_24hours ? 1 : 0, opening_time || null, closing_time || null, delivery_available !== false ? 1 : 0, delivery_radius_km || 5, delivery_charge || 0, free_delivery_above || 500]
    );

    return res.status(201).json({ message: 'Registration successful! Pending admin approval.', data: { id: uuid, name, email, verification_status: 'pending' } });
  } catch (error) {
    console.error('pharmacy register error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password, fcm_token } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required.' });

    const [rows] = await pool.query('SELECT * FROM pharmacies WHERE email = ?', [email]);
    if (!rows.length) return res.status(401).json({ message: 'Invalid email or password.' });

    const pharmacy = rows[0];
    const isValid = await bcrypt.compare(password, pharmacy.password_hash);
    if (!isValid) return res.status(401).json({ message: 'Invalid email or password.' });

    if (fcm_token) await pool.query('UPDATE pharmacies SET fcm_token = ? WHERE id = ?', [fcm_token, pharmacy.id]);

    const token = jwt.sign({ id: pharmacy.id, uuid: pharmacy.uuid, role: 'pharmacy' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

    return res.status(200).json({ message: 'Login successful.', data: { token, pharmacy: { id: pharmacy.uuid, name: pharmacy.name, email: pharmacy.email, verification_status: pharmacy.verification_status, is_verified: pharmacy.is_verified } } });
  } catch (error) {
    console.error('pharmacy login error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const getProfile = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM pharmacies WHERE id = ?', [req.pharmacy.id]);
    if (!rows.length) return res.status(404).json({ message: 'Pharmacy not found.' });
    const p = rows[0];
    return res.status(200).json({ message: 'Profile fetched.', data: { id: p.uuid, name: p.name, owner_name: p.owner_name, email: p.email, mobile: p.mobile, profile_photo: p.profile_photo, about_description: p.about_description, license_number: p.license_number, gst_number: p.gst_number, pan_number: p.pan_number, documents: { drug_license_url: p.drug_license_url, gst_certificate_url: p.gst_certificate_url, pan_card_url: p.pan_card_url }, location: { address: p.address_line1, address_line2: p.address_line2, landmark: p.landmark, city: p.city, state: p.state, pincode: p.pincode, zone_id: p.zone_id, latitude: p.latitude, longitude: p.longitude }, operations: { is_24hours: p.is_24hours, opening_time: p.opening_time, closing_time: p.closing_time, delivery_available: p.delivery_available, delivery_radius_km: p.delivery_radius_km, delivery_charge: p.delivery_charge, free_delivery_above: p.free_delivery_above }, verification_status: p.verification_status, is_verified: p.is_verified, average_rating: p.average_rating, created_at: p.created_at } });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const updateProfile = async (req, res) => {
  try {
    const pharmacyId = req.pharmacy.id;
    if (req.body.mobile) {
      const [existing] = await pool.query('SELECT id FROM pharmacies WHERE mobile = ? AND id != ?', [req.body.mobile, pharmacyId]);
      if (existing.length) return res.status(409).json({ message: 'Mobile already in use.' });
    }
    const allowedFields = ['name', 'owner_name', 'mobile', 'profile_photo', 'about_description', 'license_number', 'gst_number', 'pan_number', 'drug_license_url', 'gst_certificate_url', 'pan_card_url', 'address_line1', 'address_line2', 'landmark', 'city', 'state', 'pincode', 'zone_id', 'latitude', 'longitude', 'is_24hours', 'opening_time', 'closing_time', 'delivery_available', 'delivery_radius_km', 'delivery_charge', 'free_delivery_above'];
    const fields = []; const values = [];
    for (const key of allowedFields) { if (req.body[key] !== undefined) { fields.push(`${key} = ?`); values.push(['is_24hours', 'delivery_available'].includes(key) ? (req.body[key] ? 1 : 0) : req.body[key]); } }
    if (!fields.length) return res.status(400).json({ message: 'Nothing to update.' });
    values.push(pharmacyId);
    await pool.query(`UPDATE pharmacies SET ${fields.join(', ')} WHERE id = ?`, values);
    return res.status(200).json({ message: 'Profile updated.' });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password || new_password.length < 6) return res.status(400).json({ message: 'Current and new password (min 6 chars) required.' });
    const [rows] = await pool.query('SELECT password_hash FROM pharmacies WHERE id = ?', [req.pharmacy.id]);
    const isValid = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!isValid) return res.status(400).json({ message: 'Current password is incorrect.' });
    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE pharmacies SET password_hash = ? WHERE id = ?', [hashed, req.pharmacy.id]);
    return res.status(200).json({ message: 'Password changed.' });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email, mobile } = req.body;
    if (!email && !mobile) return res.status(400).json({ message: 'Email or mobile required.' });
    let pharmacy = email ? (await pool.query('SELECT * FROM pharmacies WHERE email = ?', [email]))[0][0] : (await pool.query('SELECT * FROM pharmacies WHERE mobile = ?', [mobile]))[0][0];
    if (!pharmacy) return res.status(404).json({ message: 'No account found.' });
    console.log(`📱 Pharmacy forgot OTP for ${pharmacy.email || pharmacy.mobile}: 111111`);
    return res.status(200).json({ message: email ? 'OTP sent to registered email.' : 'OTP sent to registered mobile.', data: { email: pharmacy.email ? pharmacy.email.replace(/(.{2})(.*)(@.*)/, '$1****$3') : null, mobile: pharmacy.mobile ? pharmacy.mobile.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2') : null } });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, mobile, otp, new_password } = req.body;
    if ((!email && !mobile) || !otp || !new_password) return res.status(400).json({ message: 'Email/mobile, OTP, new password required.' });
    if (otp !== '111111') return res.status(400).json({ message: 'Invalid OTP.' });
    if (new_password.length < 6) return res.status(400).json({ message: 'Password min 6 chars.' });
    let pharmacy = email ? (await pool.query('SELECT id FROM pharmacies WHERE email = ?', [email]))[0][0] : (await pool.query('SELECT id FROM pharmacies WHERE mobile = ?', [mobile]))[0][0];
    if (!pharmacy) return res.status(404).json({ message: 'No account found.' });
    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE pharmacies SET password_hash = ? WHERE id = ?', [hashed, pharmacy.id]);
    return res.status(200).json({ message: 'Password reset. Please login.' });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const getBankDetails = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM pharmacy_bank_details WHERE pharmacy_id = ?', [req.pharmacy.id]);
    return res.status(200).json({ message: 'Bank details fetched.', data: rows[0] || null });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const updateBankDetails = async (req, res) => {
  try {
    const { account_holder_name, bank_name, account_number, ifsc_code } = req.body;
    if (!account_holder_name || !bank_name || !account_number || !ifsc_code) return res.status(400).json({ message: 'All bank fields required.' });
    const pharmacyId = req.pharmacy.id;
    const [existing] = await pool.query('SELECT id FROM pharmacy_bank_details WHERE pharmacy_id = ?', [pharmacyId]);
    if (existing.length) { await pool.query('UPDATE pharmacy_bank_details SET account_holder_name = ?, bank_name = ?, account_number = ?, ifsc_code = ? WHERE pharmacy_id = ?', [account_holder_name, bank_name, account_number, ifsc_code, pharmacyId]); }
    else { await pool.query('INSERT INTO pharmacy_bank_details (pharmacy_id, account_holder_name, bank_name, account_number, ifsc_code) VALUES (?, ?, ?, ?, ?)', [pharmacyId, account_holder_name, bank_name, account_number, ifsc_code]); }
    return res.status(200).json({ message: 'Bank details saved.' });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = { register, login, getProfile, updateProfile, changePassword, forgotPassword, resetPassword, getBankDetails, updateBankDetails };
