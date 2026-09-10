const jwt = require('jsonwebtoken');
const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');
const notificationService = require('../../services/notification.service');
const { clearRejectedStep } = require('../../utils/rejectedSteps');
const { normalizeQualifications, parseQualifications } = require('../../utils/qualifications');

const STATIC_OTP = '111111';

// ─── AUTH ───
const sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ message: 'Valid 10-digit mobile required.' });
    const [existing] = await pool.query('SELECT id FROM sample_collectors WHERE mobile = ?', [mobile]);
    if (!existing.length) await pool.query('INSERT INTO sample_collectors (uuid, mobile) VALUES (?, ?)', [uuidv4(), mobile]);
    console.log(`📱 Collector OTP for ${mobile}: ${STATIC_OTP}`);
    return res.status(200).json({ message: 'OTP sent.', data: { mobile } });
  } catch (error) { console.error('collector sendOtp error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

const verifyOtp = async (req, res) => {
  try {
    const { mobile, otp, fcm_token } = req.body;
    if (!mobile || !otp) return res.status(400).json({ message: 'Mobile and OTP required.' });
    if (otp !== STATIC_OTP) return res.status(400).json({ message: 'Invalid OTP.' });
    const [rows] = await pool.query('SELECT * FROM sample_collectors WHERE mobile = ?', [mobile]);
    if (!rows.length) return res.status(404).json({ message: 'Not found. Send OTP first.' });
    const collector = rows[0];
    if (fcm_token) await pool.query('UPDATE sample_collectors SET fcm_token = ?, is_verified_mobile = 1 WHERE id = ?', [fcm_token, collector.id]);
    else await pool.query('UPDATE sample_collectors SET is_verified_mobile = 1 WHERE id = ?', [collector.id]);
    const is_new_user = !collector.full_name;
    const token = jwt.sign({ id: collector.id, uuid: collector.uuid, role: 'collector' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    return res.status(200).json({ message: is_new_user ? 'OTP verified. Complete profile.' : 'Login successful.', data: { token, role: 'collector', is_new_user, registration_step: collector.registration_step || 0, verification_status: collector.verification_status, collector: { id: collector.uuid, full_name: collector.full_name, mobile: collector.mobile } } });
  } catch (error) { console.error('collector verifyOtp error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── REGISTRATION STEPS ───
const step1Personal = async (req, res) => {
  try {
    const { full_name, email, date_of_birth, gender } = req.body;
    if (!full_name) return res.status(400).json({ message: 'full_name required.' });
    await pool.query('UPDATE sample_collectors SET full_name = ?, email = ?, date_of_birth = ?, gender = ?, registration_step = GREATEST(registration_step, 1) WHERE id = ?', [full_name, email || null, date_of_birth || null, gender || null, req.collector.id]);
    await clearRejectedStep('sample_collectors', req.collector.id, 1);
    return res.status(200).json({ message: 'Step 1 saved.', data: { registration_step: 1 } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const step2Experience = async (req, res) => {
  try {
    const { experience_years, zone_id } = req.body;
    await pool.query('UPDATE sample_collectors SET experience_years = ?, zone_id = ?, registration_step = GREATEST(registration_step, 2) WHERE id = ?', [experience_years || 0, zone_id || null, req.collector.id]);
    await clearRejectedStep('sample_collectors', req.collector.id, 2);
    return res.status(200).json({ message: 'Step 2 saved.', data: { registration_step: 2 } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const step3Documents = async (req, res) => {
  try {
    const { aadhaar_url, pan_url, dl_url, profile_photo_url, qualifications } = req.body;
    if (!aadhaar_url || !profile_photo_url) return res.status(400).json({ message: 'aadhaar_url and profile_photo_url required.' });
    const quals = normalizeQualifications(qualifications);
    if (quals === undefined) {
      await pool.query('UPDATE sample_collectors SET aadhaar_url = ?, pan_url = ?, dl_url = ?, profile_photo_url = ?, registration_step = GREATEST(registration_step, 3) WHERE id = ?', [aadhaar_url, pan_url || null, dl_url || null, profile_photo_url, req.collector.id]);
    } else {
      await pool.query('UPDATE sample_collectors SET aadhaar_url = ?, pan_url = ?, dl_url = ?, profile_photo_url = ?, qualifications = ?, registration_step = GREATEST(registration_step, 3) WHERE id = ?', [aadhaar_url, pan_url || null, dl_url || null, profile_photo_url, quals, req.collector.id]);
    }
    await clearRejectedStep('sample_collectors', req.collector.id, 3);
    return res.status(200).json({ message: 'Step 3 saved.', data: { registration_step: 3 } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const step4Bank = async (req, res) => {
  try {
    const { account_holder_name, bank_name, account_number, ifsc_code } = req.body;
    if (!account_holder_name || !bank_name || !account_number || !ifsc_code) return res.status(400).json({ message: 'All bank fields required.' });
    const collectorId = req.collector.id;
    const [existing] = await pool.query('SELECT id FROM sample_collector_bank_details WHERE collector_id = ?', [collectorId]);
    if (existing.length) await pool.query('UPDATE sample_collector_bank_details SET account_holder_name = ?, bank_name = ?, account_number = ?, ifsc_code = ? WHERE collector_id = ?', [account_holder_name, bank_name, account_number, ifsc_code, collectorId]);
    else await pool.query('INSERT INTO sample_collector_bank_details (collector_id, account_holder_name, bank_name, account_number, ifsc_code) VALUES (?, ?, ?, ?, ?)', [collectorId, account_holder_name, bank_name, account_number, ifsc_code]);
    await pool.query("UPDATE sample_collectors SET registration_step = 4, verification_status = 'pending' WHERE id = ?", [collectorId]);
    await clearRejectedStep('sample_collectors', collectorId, 4);
    return res.status(200).json({ message: 'Bank details saved. Profile under review.', data: { registration_step: 4, verification_status: 'pending' } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── PROFILE ───
const getProfile = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT sc.*, z.name as zone_name FROM sample_collectors sc LEFT JOIN zones z ON sc.zone_id = z.id WHERE sc.id = ?', [req.collector.id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found.' });
    const p = rows[0];
    const [bankRows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM sample_collector_bank_details WHERE collector_id = ?', [req.collector.id]);
    return res.status(200).json({ message: 'Profile fetched.', data: { id: p.uuid, mobile: p.mobile, registration_step: p.registration_step, verification_status: p.verification_status, rejection_reason: p.rejection_reason, rejected_steps: p.rejected_steps ? p.rejected_steps.split(',').map(Number) : [], personal: { full_name: p.full_name, email: p.email, date_of_birth: p.date_of_birth, gender: p.gender, profile_photo_url: p.profile_photo_url }, experience: { years: p.experience_years, zone_id: p.zone_id, zone_name: p.zone_name }, documents: { aadhaar_url: p.aadhaar_url, pan_url: p.pan_url, dl_url: p.dl_url }, qualifications: parseQualifications(p.qualifications), bank: bankRows[0] || null, status: { is_online: p.is_online, is_active: p.is_active }, stats: { average_rating: p.average_rating, total_collections: p.total_collections, total_earned: p.total_earned } } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── ONLINE/LOCATION ───
const toggleOnline = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const [rows] = await pool.query('SELECT is_online, verification_status FROM sample_collectors WHERE id = ?', [req.collector.id]);
    if (rows[0].verification_status !== 'approved') return res.status(400).json({ message: 'Account not verified yet.' });
    const newStatus = rows[0].is_online ? 0 : 1;
    if (newStatus === 1 && (!latitude || !longitude)) return res.status(400).json({ message: 'latitude, longitude required to go online.' });
    if (newStatus === 1) await pool.query('UPDATE sample_collectors SET is_online = 1, latitude = ?, longitude = ?, last_location_update = NOW() WHERE id = ?', [latitude, longitude, req.collector.id]);
    else await pool.query('UPDATE sample_collectors SET is_online = 0 WHERE id = ?', [req.collector.id]);
    return res.status(200).json({ message: newStatus ? 'You are now online.' : 'You are now offline.', data: { is_online: newStatus } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ message: 'latitude, longitude required.' });
    await pool.query('UPDATE sample_collectors SET latitude = ?, longitude = ?, last_location_update = NOW() WHERE id = ?', [latitude, longitude, req.collector.id]);
    return res.status(200).json({ message: 'Location updated.' });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── COLLECTION REQUESTS ───
const getRequests = async (req, res) => {
  try {
    const [collector] = await pool.query('SELECT latitude, longitude FROM sample_collectors WHERE id = ?', [req.collector.id]);
    const [configRows] = await pool.query("SELECT config_value FROM admin_config WHERE config_key = 'sample_collection_search_radius_km'");
    const radiusKm = configRows.length ? parseFloat(configRows[0].config_value) : 10;
    const [rows] = await pool.query(
      `SELECT scr.*, pl.name as lab_name, b.booking_id as booking_number, b.metadata, u.full_name as patient_name, u.mobile as patient_mobile, u.gender as patient_gender, u.date_of_birth as patient_dob
       FROM sample_collection_requests scr
       JOIN pathology_labs pl ON scr.lab_id = pl.id
       JOIN bookings b ON scr.booking_id = b.id
       JOIN users u ON b.user_id = u.id
       WHERE scr.status = 'searching' AND (6371 * acos(cos(radians(?)) * cos(radians(scr.pickup_latitude)) * cos(radians(scr.pickup_longitude) - radians(?)) + sin(radians(?)) * sin(radians(scr.pickup_latitude)))) <= ? ORDER BY scr.created_at DESC`,
      [collector[0].latitude, collector[0].longitude, collector[0].latitude, radiusKm]
    );
    return res.status(200).json({ message: 'Requests fetched.', data: rows.map(r => {
      const metadata = r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : {};
      return { id: r.id, request_id: r.request_id, lab_name: r.lab_name, patient: { name: r.patient_name, mobile: r.patient_mobile, gender: r.patient_gender, dob: r.patient_dob }, tests: metadata.tests || [], pickup: { address: r.pickup_address, lat: r.pickup_latitude, lng: r.pickup_longitude }, lab: { address: r.lab_address, lat: r.lab_latitude, lng: r.lab_longitude }, distance_km: r.distance_km, collection_earning: r.collection_earning, created_at: r.created_at };
    }) });
  } catch (error) { console.error('collector getRequests error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

const getActiveCollection = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT scr.*, pl.name as lab_name, pl.mobile as lab_mobile, b.booking_id as booking_number, b.metadata, u.full_name as patient_name, u.mobile as patient_mobile, u.gender as patient_gender, u.date_of_birth as patient_dob
       FROM sample_collection_requests scr JOIN pathology_labs pl ON scr.lab_id = pl.id JOIN bookings b ON scr.booking_id = b.id JOIN users u ON b.user_id = u.id
       WHERE scr.collector_id = ? AND scr.status IN ('assigned', 'reached_patient', 'sample_collected') ORDER BY scr.assigned_at DESC LIMIT 1`, [req.collector.id]
    );
    if (!rows.length) return res.status(200).json({ message: 'No active collection.', data: null });
    const r = rows[0];
    const metadata = r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : {};
    return res.status(200).json({ message: 'Active collection fetched.', data: { id: r.id, request_id: r.request_id, status: r.status, patient: { name: r.patient_name, mobile: r.patient_mobile, gender: r.patient_gender, dob: r.patient_dob }, tests: metadata.tests || [], pickup: { address: r.pickup_address, lat: r.pickup_latitude, lng: r.pickup_longitude }, lab: { name: r.lab_name, mobile: r.lab_mobile, address: r.lab_address, lat: r.lab_latitude, lng: r.lab_longitude }, booking_id: r.booking_number, distance_km: r.distance_km, collection_earning: r.collection_earning, collection_otp: r.collection_otp, assigned_at: r.assigned_at } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const acceptRequest = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM sample_collection_requests WHERE id = ? AND status = 'searching'", [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Request not found or already assigned.' });
    await pool.query("UPDATE sample_collection_requests SET collector_id = ?, status = 'assigned', assigned_at = NOW() WHERE id = ?", [req.collector.id, req.params.id]);
    await pool.query("UPDATE bookings SET status = 'collector_assigned' WHERE id = ?", [rows[0].booking_id]);
    return res.status(200).json({ message: 'Collection accepted!', data: { status: 'assigned' } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const rejectRequest = async (req, res) => {
  try { return res.status(200).json({ message: 'Request skipped.' }); }
  catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const markReachedPatient = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, booking_id, status FROM sample_collection_requests WHERE id = ? AND collector_id = ?", [req.params.id, req.collector.id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found.' });
    if (rows[0].status !== 'assigned') return res.status(400).json({ message: `Cannot. Current: ${rows[0].status}` });
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    await pool.query("UPDATE sample_collection_requests SET status = 'reached_patient', reached_at = NOW(), collection_otp = ? WHERE id = ?", [otp, rows[0].id]);
    await pool.query("UPDATE bookings SET status = 'collector_reached' WHERE id = ?", [rows[0].booking_id]);
    // Notify user
    const [bookingRows] = await pool.query('SELECT user_id FROM bookings WHERE id = ?', [rows[0].booking_id]);
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [bookingRows[0].user_id]);
    if (userRows[0]?.fcm_token) await notificationService.sendToDevice(userRows[0].fcm_token, 'Collector Arrived 🧪', `Sample collector has arrived. OTP: ${otp}`, { type: 'collector_arrived', otp });
    return res.status(200).json({ message: 'Marked reached. OTP sent to patient.', data: { status: 'reached_patient' } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const markSampleCollected = async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ message: 'OTP required.' });
    const [rows] = await pool.query("SELECT * FROM sample_collection_requests WHERE id = ? AND collector_id = ?", [req.params.id, req.collector.id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found.' });
    if (rows[0].status !== 'reached_patient') return res.status(400).json({ message: `Cannot. Current: ${rows[0].status}` });
    if (rows[0].collection_otp !== otp) return res.status(400).json({ message: 'Invalid OTP.' });
    await pool.query("UPDATE sample_collection_requests SET status = 'sample_collected', collected_at = NOW() WHERE id = ?", [rows[0].id]);
    await pool.query("UPDATE bookings SET status = 'sample_collected' WHERE id = ?", [rows[0].booking_id]);
    return res.status(200).json({ message: 'Sample collected!', data: { status: 'sample_collected' } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const markDeliveredToLab = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM sample_collection_requests WHERE id = ? AND collector_id = ?", [req.params.id, req.collector.id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found.' });
    if (rows[0].status !== 'sample_collected') return res.status(400).json({ message: `Cannot. Current: ${rows[0].status}` });
    await pool.query("UPDATE sample_collection_requests SET status = 'delivered_to_lab', delivered_at = NOW() WHERE id = ?", [rows[0].id]);
    // Credit wallet
    const collectorId = req.collector.id;
    await pool.query('UPDATE sample_collectors SET total_collections = total_collections + 1, total_earned = total_earned + ? WHERE id = ?', [rows[0].collection_earning, collectorId]);
    const [walletExists] = await pool.query('SELECT id FROM sample_collector_wallets WHERE collector_id = ?', [collectorId]);
    if (!walletExists.length) await pool.query('INSERT INTO sample_collector_wallets (collector_id) VALUES (?)', [collectorId]);
    await pool.query('UPDATE sample_collector_wallets SET balance = balance + ?, total_earned = total_earned + ? WHERE collector_id = ?', [rows[0].collection_earning, rows[0].collection_earning, collectorId]);
    const [wallet] = await pool.query('SELECT balance FROM sample_collector_wallets WHERE collector_id = ?', [collectorId]);
    await pool.query("INSERT INTO sample_collector_wallet_transactions (collector_id, type, amount, description, reference_type, reference_id, balance_after) VALUES (?, 'credit', ?, ?, 'collection_earning', ?, ?)", [collectorId, rows[0].collection_earning, `Collection ${rows[0].request_id} completed. Distance: ${rows[0].distance_km} km`, rows[0].id, wallet[0].balance]);
    // Update booking status
    await pool.query("UPDATE bookings SET status = 'in_progress' WHERE id = ?", [rows[0].booking_id]);
    return res.status(200).json({ message: 'Delivered to lab! Earning credited.', data: { status: 'delivered_to_lab', earning: rows[0].collection_earning } });
  } catch (error) { console.error('collector markDeliveredToLab error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── HISTORY & EARNINGS ───
const getHistory = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['scr.collector_id = ?']; let params = [req.collector.id];
    if (status) { where.push('scr.status = ?'); params.push(status); }
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM sample_collection_requests scr WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(`SELECT scr.*, pl.name as lab_name FROM sample_collection_requests scr JOIN pathology_labs pl ON scr.lab_id = pl.id WHERE ${where.join(' AND ')} ORDER BY scr.created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);
    return res.status(200).json({ message: 'History fetched.', data: rows.map(r => ({ id: r.id, request_id: r.request_id, lab_name: r.lab_name, pickup_address: r.pickup_address, distance_km: r.distance_km, collection_earning: r.collection_earning, status: r.status, assigned_at: r.assigned_at, delivered_at: r.delivered_at })), pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const getEarnings = async (req, res) => {
  try {
    const collectorId = req.collector.id;
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = `${today.substring(0, 7)}-01`;
    const [collector] = await pool.query('SELECT total_earned, total_collections FROM sample_collectors WHERE id = ?', [collectorId]);
    const [todayE] = await pool.query("SELECT COALESCE(SUM(collection_earning), 0) as total, COUNT(*) as trips FROM sample_collection_requests WHERE collector_id = ? AND status = 'delivered_to_lab' AND DATE(delivered_at) = ?", [collectorId, today]);
    const [monthE] = await pool.query("SELECT COALESCE(SUM(collection_earning), 0) as total, COUNT(*) as trips FROM sample_collection_requests WHERE collector_id = ? AND status = 'delivered_to_lab' AND delivered_at >= ?", [collectorId, firstOfMonth]);
    return res.status(200).json({ message: 'Earnings fetched.', data: { total_earned: collector[0].total_earned, total_collections: collector[0].total_collections, today: { earned: todayE[0].total, trips: todayE[0].trips }, this_month: { earned: monthE[0].total, trips: monthE[0].trips } } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── WALLET ───
const getWallet = async (req, res) => {
  try {
    const collectorId = req.collector.id;
    let [walletRows] = await pool.query('SELECT * FROM sample_collector_wallets WHERE collector_id = ?', [collectorId]);
    if (!walletRows.length) { await pool.query('INSERT INTO sample_collector_wallets (collector_id) VALUES (?)', [collectorId]); [walletRows] = await pool.query('SELECT * FROM sample_collector_wallets WHERE collector_id = ?', [collectorId]); }
    const [pending] = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM sample_collector_withdrawals WHERE collector_id = ? AND status IN ('pending', 'approved')", [collectorId]);
    return res.status(200).json({ message: 'Wallet fetched.', data: { balance: walletRows[0].balance, total_earned: walletRows[0].total_earned, total_withdrawn: walletRows[0].total_withdrawn, pending_withdrawal: pending[0].total } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['collector_id = ?']; let params = [req.collector.id];
    if (type) { where.push('type = ?'); params.push(type); }
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM sample_collector_wallet_transactions WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(`SELECT * FROM sample_collector_wallet_transactions WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);
    return res.status(200).json({ message: 'Transactions fetched.', data: rows.map(t => ({ id: t.id, type: t.type, amount: t.amount, description: t.description, reference_type: t.reference_type, balance_after: t.balance_after, created_at: t.created_at })), pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const requestWithdrawal = async (req, res) => {
  try {
    const collectorId = req.collector.id;
    const { amount, remarks } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ message: 'Valid amount required.' });
    const [walletRows] = await pool.query('SELECT balance FROM sample_collector_wallets WHERE collector_id = ?', [collectorId]);
    if (!walletRows.length || walletRows[0].balance < amount) return res.status(400).json({ message: `Insufficient balance.` });
    const [bankDetails] = await pool.query('SELECT id FROM sample_collector_bank_details WHERE collector_id = ?', [collectorId]);
    if (!bankDetails.length) return res.status(400).json({ message: 'Add bank details first.' });
    const [pendingReq] = await pool.query("SELECT id FROM sample_collector_withdrawals WHERE collector_id = ? AND status IN ('pending', 'approved')", [collectorId]);
    if (pendingReq.length) return res.status(400).json({ message: 'Already have pending withdrawal.' });
    await pool.query('INSERT INTO sample_collector_withdrawals (collector_id, amount, remarks) VALUES (?, ?, ?)', [collectorId, amount, remarks || null]);
    await pool.query('UPDATE sample_collector_wallets SET balance = balance - ? WHERE collector_id = ?', [amount, collectorId]);
    const [updated] = await pool.query('SELECT balance FROM sample_collector_wallets WHERE collector_id = ?', [collectorId]);
    await pool.query("INSERT INTO sample_collector_wallet_transactions (collector_id, type, amount, description, reference_type, balance_after) VALUES (?, 'debit', ?, 'Withdrawal request', 'withdrawal', ?)", [collectorId, amount, updated[0].balance]);
    return res.status(201).json({ message: 'Withdrawal submitted.', data: { amount, new_balance: updated[0].balance } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const getWithdrawals = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['collector_id = ?']; let params = [req.collector.id];
    if (status) { where.push('status = ?'); params.push(status); }
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM sample_collector_withdrawals WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(`SELECT * FROM sample_collector_withdrawals WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);
    return res.status(200).json({ message: 'Withdrawals fetched.', data: rows.map(w => ({ id: w.id, amount: w.amount, status: w.status, remarks: w.remarks, admin_remarks: w.admin_remarks, processed_at: w.processed_at, created_at: w.created_at })), pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = { sendOtp, verifyOtp, step1Personal, step2Experience, step3Documents, step4Bank, getProfile, toggleOnline, updateLocation, getRequests, getActiveCollection, acceptRequest, rejectRequest, markReachedPatient, markSampleCollected, markDeliveredToLab, getHistory, getEarnings, getWallet, getTransactions, requestWithdrawal, getWithdrawals };
