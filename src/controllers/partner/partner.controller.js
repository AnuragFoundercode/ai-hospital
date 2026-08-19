const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────
// AMBULANCE PARTNER CONTROLLER
// ─────────────────────────────────────────────

const register = async (req, res) => {
  try {
    const { name, mobile, email, password, profile_photo, dob, gender, driving_license_number, license_expiry_date, experience_years, emergency_training_certificate_url, category_id, vehicle_number, registration_number, insurance_valid_till, rc_book_url, aadhaar_url, dl_url, insurance_url } = req.body;

    if (!name || !mobile || !password || !driving_license_number || !license_expiry_date || !vehicle_number || !registration_number) {
      return res.status(400).json({ message: 'Required: name, mobile, password, driving_license_number, license_expiry_date, vehicle_number, registration_number' });
    }

    const [existingMobile] = await pool.query('SELECT id FROM ambulance_partners WHERE mobile = ?', [mobile]);
    if (existingMobile.length) return res.status(409).json({ message: 'Mobile already registered.' });

    const uuid = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO ambulance_partners (uuid, name, mobile, email, password_hash, profile_photo, dob, gender, driving_license_number, license_expiry_date, experience_years, emergency_training_certificate_url, category_id, vehicle_number, registration_number, insurance_valid_till, rc_book_url, aadhaar_url, dl_url, insurance_url, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [uuid, name, mobile, email || null, hashedPassword, profile_photo || null, dob || null, gender || null, driving_license_number, license_expiry_date, experience_years || 0, emergency_training_certificate_url || null, category_id || null, vehicle_number, registration_number, insurance_valid_till || null, rc_book_url || null, aadhaar_url || null, dl_url || null, insurance_url || null]
    );

    return res.status(201).json({ message: 'Registration successful! Pending admin approval.', data: { id: uuid, name, verification_status: 'pending' } });
  } catch (error) {
    console.error('partner register error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const login = async (req, res) => {
  try {
    const { mobile, password, fcm_token } = req.body;
    if (!mobile || !password) return res.status(400).json({ message: 'Mobile and password required.' });

    const [rows] = await pool.query('SELECT * FROM ambulance_partners WHERE mobile = ?', [mobile]);
    if (!rows.length) return res.status(401).json({ message: 'Invalid credentials.' });

    const partner = rows[0];
    const isValid = await bcrypt.compare(password, partner.password_hash);
    if (!isValid) return res.status(401).json({ message: 'Invalid credentials.' });

    if (fcm_token) await pool.query('UPDATE ambulance_partners SET fcm_token = ? WHERE id = ?', [fcm_token, partner.id]);

    const token = jwt.sign({ id: partner.id, uuid: partner.uuid, role: 'ambulance_partner' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

    return res.status(200).json({ message: 'Login successful.', data: { token, partner: { id: partner.uuid, name: partner.name, is_online: partner.is_online, verification_status: partner.verification_status } } });
  } catch (error) {
    console.error('partner login error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const getProfile = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT ap.*, ac.name as category_name FROM ambulance_partners ap LEFT JOIN ambulance_categories ac ON ap.category_id = ac.id WHERE ap.id = ?', [req.partner.id]);
    if (!rows.length) return res.status(404).json({ message: 'Partner not found.' });
    const p = rows[0];
    return res.status(200).json({ message: 'Profile fetched.', data: { id: p.uuid, name: p.name, mobile: p.mobile, email: p.email, profile_photo: p.profile_photo, dob: p.dob, gender: p.gender, license: { number: p.driving_license_number, expiry: p.license_expiry_date, experience_years: p.experience_years, training_certificate: p.emergency_training_certificate_url }, vehicle: { category: p.category_name, category_id: p.category_id, number: p.vehicle_number, registration_number: p.registration_number, insurance_valid_till: p.insurance_valid_till }, documents: { rc_book_url: p.rc_book_url, aadhaar_url: p.aadhaar_url, dl_url: p.dl_url, insurance_url: p.insurance_url }, is_online: p.is_online, verification_status: p.verification_status, average_rating: p.average_rating, total_trips: p.total_trips } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const updateProfile = async (req, res) => {
  try {
    const allowedFields = ['name', 'email', 'profile_photo', 'dob', 'gender', 'driving_license_number', 'license_expiry_date', 'experience_years', 'emergency_training_certificate_url', 'category_id', 'vehicle_number', 'registration_number', 'insurance_valid_till', 'rc_book_url', 'aadhaar_url', 'dl_url', 'insurance_url'];
    const fields = []; const values = [];
    for (const key of allowedFields) { if (req.body[key] !== undefined) { fields.push(`${key} = ?`); values.push(req.body[key]); } }
    if (!fields.length) return res.status(400).json({ message: 'Nothing to update.' });
    values.push(req.partner.id);
    await pool.query(`UPDATE ambulance_partners SET ${fields.join(', ')} WHERE id = ?`, values);
    return res.status(200).json({ message: 'Profile updated.' });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ message: 'latitude and longitude required.' });
    await pool.query('UPDATE ambulance_partners SET latitude = ?, longitude = ?, last_location_update = NOW() WHERE id = ?', [latitude, longitude, req.partner.id]);
    return res.status(200).json({ message: 'Location updated.' });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const toggleOnline = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const [rows] = await pool.query('SELECT is_online, verification_status FROM ambulance_partners WHERE id = ?', [req.partner.id]);
    if (rows[0].verification_status !== 'approved') return res.status(400).json({ message: 'Account not verified yet.' });

    const newStatus = rows[0].is_online ? 0 : 1;

    if (newStatus === 1 && (!latitude || !longitude)) {
      return res.status(400).json({ message: 'latitude and longitude required to go online.' });
    }

    const updateFields = newStatus === 1
      ? 'is_online = 1, latitude = ?, longitude = ?, last_location_update = NOW()'
      : 'is_online = 0';

    if (newStatus === 1) {
      await pool.query(`UPDATE ambulance_partners SET ${updateFields} WHERE id = ?`, [latitude, longitude, req.partner.id]);
    } else {
      await pool.query(`UPDATE ambulance_partners SET ${updateFields} WHERE id = ?`, [req.partner.id]);
    }

    return res.status(200).json({ message: newStatus ? 'You are now online.' : 'You are now offline.', data: { is_online: newStatus } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const getBookings = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['ab.partner_id = ?']; let params = [req.partner.id];
    if (status) { where.push('ab.status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM ambulance_bookings ab WHERE ${whereClause}`, params);
    const [rows] = await pool.query(`SELECT ab.*, u.full_name as user_name, u.mobile as user_mobile, ac.name as category_name FROM ambulance_bookings ab JOIN users u ON ab.user_id = u.id JOIN ambulance_categories ac ON ab.category_id = ac.id WHERE ${whereClause} ORDER BY ab.created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);
    return res.status(200).json({ message: 'Bookings fetched.', data: rows.map(b => ({ booking_id: b.booking_id, status: b.status, category: b.category_name, pickup_address: b.pickup_address, drop_address: b.drop_address, distance_km: b.distance_km, total_fare: b.total_fare, payment_method: b.payment_method, user_name: b.user_name, user_mobile: b.user_mobile, created_at: b.created_at })), pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const acceptBooking = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, status, user_id FROM ambulance_bookings WHERE booking_id = ? AND partner_id = ? AND status = 'pending'", [req.params.booking_id, req.partner.id]);
    if (!rows.length) return res.status(404).json({ message: 'Booking not found or already handled.' });
    await pool.query('UPDATE ambulance_bookings SET status = ?, accepted_at = NOW() WHERE id = ?', ['accepted', rows[0].id]);
    const notificationService = require('../../services/notification.service');
    const [user] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [rows[0].user_id]);
    if (user[0]?.fcm_token) await notificationService.sendToDevice(user[0].fcm_token, 'Ambulance Assigned 🚑', 'Your ambulance is on the way!', { type: 'ambulance_accepted', booking_id: req.params.booking_id });
    return res.status(200).json({ message: 'Booking accepted.', data: { status: 'accepted' } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const rejectBooking = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, status FROM ambulance_bookings WHERE booking_id = ? AND partner_id = ? AND status = 'pending'", [req.params.booking_id, req.partner.id]);
    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });
    await pool.query("UPDATE ambulance_bookings SET partner_id = NULL, status = 'searching' WHERE id = ?", [rows[0].id]);
    return res.status(200).json({ message: 'Booking rejected. Reassigning to another partner.' });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const updateBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validTransitions = { accepted: ['arrived'], arrived: ['in_transit'], in_transit: ['completed'] };
    const [rows] = await pool.query('SELECT id, status as current_status, user_id, payment_method FROM ambulance_bookings WHERE booking_id = ? AND partner_id = ?', [req.params.booking_id, req.partner.id]);
    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });
    const allowed = validTransitions[rows[0].current_status] || [];
    if (!allowed.includes(status)) return res.status(400).json({ message: `Cannot change to "${status}". Allowed: ${allowed.join(', ')}` });

    const tsField = { arrived: 'arrived_at', in_transit: 'started_at', completed: 'completed_at' };
    await pool.query(`UPDATE ambulance_bookings SET status = ?, ${tsField[status]} = NOW() WHERE id = ?`, [status, rows[0].id]);

    if (status === 'completed') {
      if (rows[0].payment_method === 'cash') await pool.query("UPDATE ambulance_bookings SET payment_status = 'paid', paid_at = NOW() WHERE id = ?", [rows[0].id]);
      await pool.query('UPDATE ambulance_partners SET total_trips = total_trips + 1 WHERE id = ?', [req.partner.id]);
    }

    const notificationService = require('../../services/notification.service');
    const [user] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [rows[0].user_id]);
    const msgs = { arrived: 'Ambulance has arrived at pickup location.', in_transit: 'You are on the way to destination.', completed: 'Trip completed. Thank you!' };
    if (user[0]?.fcm_token) await notificationService.sendToDevice(user[0].fcm_token, `Ambulance ${status.replace('_', ' ')}`, msgs[status], { type: 'ambulance_status', booking_id: req.params.booking_id, status });

    return res.status(200).json({ message: `Status updated to ${status}.`, data: { status } });
  } catch (error) { console.error('partner updateBookingStatus error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = { register, login, getProfile, updateProfile, updateLocation, toggleOnline, getBookings, acceptBooking, rejectBooking, updateBookingStatus };
