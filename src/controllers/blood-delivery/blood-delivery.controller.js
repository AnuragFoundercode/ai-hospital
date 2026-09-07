const jwt = require('jsonwebtoken');
const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────
// BLOOD DELIVERY PARTNER CONTROLLER
// (clone of delivery partner: OTP + 4-step registration + profile + status)
// ─────────────────────────────────────────────

const STATIC_OTP = '111111';

/**
 * POST /api/v1/blood-delivery/send-otp
 */
const sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ message: 'Valid 10-digit mobile required.' });

    const [existing] = await pool.query('SELECT id FROM blood_delivery_partners WHERE mobile = ?', [mobile]);
    if (!existing.length) {
      const uuid = uuidv4();
      await pool.query('INSERT INTO blood_delivery_partners (uuid, mobile) VALUES (?, ?)', [uuid, mobile]);
    }

    console.log(`📱 Blood Delivery OTP for ${mobile}: ${STATIC_OTP}`);
    return res.status(200).json({ message: 'OTP sent.', data: { mobile } });
  } catch (error) {
    console.error('blood-delivery sendOtp error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/blood-delivery/verify-otp
 */
const verifyOtp = async (req, res) => {
  try {
    const { mobile, otp, fcm_token } = req.body;
    if (!mobile || !otp) return res.status(400).json({ message: 'Mobile and OTP required.' });
    if (otp !== STATIC_OTP) return res.status(400).json({ message: 'Invalid OTP.' });

    const [rows] = await pool.query('SELECT * FROM blood_delivery_partners WHERE mobile = ?', [mobile]);
    if (!rows.length) return res.status(404).json({ message: 'Partner not found. Send OTP first.' });

    const partner = rows[0];
    if (fcm_token) await pool.query('UPDATE blood_delivery_partners SET fcm_token = ?, is_verified_mobile = 1 WHERE id = ?', [fcm_token, partner.id]);
    else await pool.query('UPDATE blood_delivery_partners SET is_verified_mobile = 1 WHERE id = ?', [partner.id]);

    const is_new_user = !partner.full_name || partner.full_name.trim() === '';
    const token = jwt.sign({ id: partner.id, uuid: partner.uuid, role: 'blood_delivery' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

    return res.status(200).json({
      message: is_new_user ? 'OTP verified. Complete your profile.' : 'Login successful.',
      data: {
        token,
        role: 'blood_delivery',
        is_new_user,
        registration_step: partner.registration_step || 0,
        verification_status: partner.verification_status,
        partner: { id: partner.uuid, full_name: partner.full_name, mobile: partner.mobile, profile_photo: partner.profile_photo },
      },
    });
  } catch (error) {
    console.error('blood-delivery verifyOtp error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/blood-delivery/registration/step1
 * Body: { full_name, email, date_of_birth, gender, profile_photo }
 */
const step1Personal = async (req, res) => {
  try {
    const { full_name, email, date_of_birth, gender, profile_photo } = req.body;
    if (!full_name) return res.status(400).json({ message: 'full_name required.' });

    await pool.query(
      'UPDATE blood_delivery_partners SET full_name = ?, email = ?, date_of_birth = ?, gender = ?, profile_photo = ?, registration_step = GREATEST(registration_step, 1) WHERE id = ?',
      [full_name, email || null, date_of_birth || null, gender || null, profile_photo || null, req.bloodDelivery.id]
    );

    return res.status(200).json({ message: 'Step 1 saved.', data: { registration_step: 1 } });
  } catch (error) {
    console.error('blood-delivery step1 error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/blood-delivery/vehicle-types
 */
const getVehicleTypes = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, icon_url FROM vehicle_types WHERE is_active = 1 ORDER BY id');
    return res.status(200).json({ message: 'Vehicle types fetched.', data: rows });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * PUT /api/v1/blood-delivery/registration/step2
 * Body: { vehicle_type_id, vehicle_type, rc_number, dl_number, zone_id }
 */
const step2Vehicle = async (req, res) => {
  try {
    const { vehicle_type_id, vehicle_type, rc_number, dl_number, zone_id } = req.body;
    if (!rc_number || !dl_number) return res.status(400).json({ message: 'rc_number, dl_number required.' });
    if (!vehicle_type_id && !vehicle_type) return res.status(400).json({ message: 'vehicle_type_id required.' });

    await pool.query(
      'UPDATE blood_delivery_partners SET vehicle_type = ?, vehicle_type_id = ?, rc_number = ?, dl_number = ?, zone_id = ?, registration_step = GREATEST(registration_step, 2) WHERE id = ?',
      [vehicle_type || null, vehicle_type_id || null, rc_number, dl_number, zone_id || null, req.bloodDelivery.id]
    );

    return res.status(200).json({ message: 'Step 2 saved.', data: { registration_step: 2 } });
  } catch (error) {
    console.error('blood-delivery step2 error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/blood-delivery/registration/step3
 * Body: { aadhaar_front_url, aadhaar_back_url, pan_card_url, driving_licence_url, rider_selfie_url }
 */
const step3Documents = async (req, res) => {
  try {
    const { aadhaar_front_url, aadhaar_back_url, pan_card_url, driving_licence_url, rider_selfie_url } = req.body;
    if (!aadhaar_front_url || !aadhaar_back_url || !driving_licence_url || !rider_selfie_url) {
      return res.status(400).json({ message: 'Required: aadhaar_front_url, aadhaar_back_url, driving_licence_url, rider_selfie_url' });
    }

    await pool.query(
      "UPDATE blood_delivery_partners SET aadhaar_front_url = ?, aadhaar_back_url = ?, pan_card_url = ?, driving_licence_url = ?, rider_selfie_url = ?, registration_step = GREATEST(registration_step, 3) WHERE id = ?",
      [aadhaar_front_url, aadhaar_back_url, pan_card_url || null, driving_licence_url, rider_selfie_url, req.bloodDelivery.id]
    );

    return res.status(200).json({ message: 'Documents uploaded.', data: { registration_step: 3 } });
  } catch (error) {
    console.error('blood-delivery step3 error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/blood-delivery/registration/step4
 * Body: { account_holder_name, bank_name, account_number, ifsc_code }
 */
const step4Bank = async (req, res) => {
  try {
    const { account_holder_name, bank_name, account_number, ifsc_code } = req.body;
    if (!account_holder_name || !bank_name || !account_number || !ifsc_code) {
      return res.status(400).json({ message: 'All bank fields required: account_holder_name, bank_name, account_number, ifsc_code' });
    }

    const partnerId = req.bloodDelivery.id;

    const [existing] = await pool.query('SELECT id FROM blood_delivery_bank_details WHERE delivery_partner_id = ?', [partnerId]);
    if (existing.length) {
      await pool.query('UPDATE blood_delivery_bank_details SET account_holder_name = ?, bank_name = ?, account_number = ?, ifsc_code = ? WHERE delivery_partner_id = ?', [account_holder_name, bank_name, account_number, ifsc_code, partnerId]);
    } else {
      await pool.query('INSERT INTO blood_delivery_bank_details (delivery_partner_id, account_holder_name, bank_name, account_number, ifsc_code) VALUES (?, ?, ?, ?, ?)', [partnerId, account_holder_name, bank_name, account_number, ifsc_code]);
    }

    await pool.query("UPDATE blood_delivery_partners SET registration_step = 4, verification_status = 'pending' WHERE id = ?", [partnerId]);

    return res.status(200).json({ message: 'Bank details saved. Profile under review.', data: { registration_step: 4, verification_status: 'pending' } });
  } catch (error) {
    console.error('blood-delivery step4 error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/blood-delivery/profile
 */
const getProfile = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT dp.*, z.name as zone_name FROM blood_delivery_partners dp LEFT JOIN zones z ON dp.zone_id = z.id WHERE dp.id = ?', [req.bloodDelivery.id]);
    if (!rows.length) return res.status(404).json({ message: 'Partner not found.' });
    const p = rows[0];

    const [bankRows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM blood_delivery_bank_details WHERE delivery_partner_id = ?', [req.bloodDelivery.id]);
    const bank = bankRows[0] || null;

    return res.status(200).json({
      message: 'Profile fetched.',
      data: {
        id: p.uuid, mobile: p.mobile, registration_step: p.registration_step, verification_status: p.verification_status, rejection_reason: p.rejection_reason,
        personal: { full_name: p.full_name, email: p.email, date_of_birth: p.date_of_birth, gender: p.gender, profile_photo: p.profile_photo },
        vehicle: { vehicle_type: p.vehicle_type, vehicle_type_id: p.vehicle_type_id, rc_number: p.rc_number, dl_number: p.dl_number, zone_id: p.zone_id, zone_name: p.zone_name },
        documents: { aadhaar_front_url: p.aadhaar_front_url, aadhaar_back_url: p.aadhaar_back_url, pan_card_url: p.pan_card_url, driving_licence_url: p.driving_licence_url, rider_selfie_url: p.rider_selfie_url },
        bank: bank,
        status: { is_online: p.is_online, is_active: p.is_active },
        stats: { average_rating: p.average_rating, total_deliveries: p.total_deliveries, total_earned: p.total_earned },
      },
    });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * PUT /api/v1/blood-delivery/toggle-online
 * Body: { latitude, longitude }
 */
const toggleOnline = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const [rows] = await pool.query('SELECT is_online, verification_status FROM blood_delivery_partners WHERE id = ?', [req.bloodDelivery.id]);
    if (rows[0].verification_status !== 'approved') return res.status(400).json({ message: 'Account not verified yet.' });

    const newStatus = rows[0].is_online ? 0 : 1;
    if (newStatus === 1 && (!latitude || !longitude)) return res.status(400).json({ message: 'latitude, longitude required to go online.' });

    if (newStatus === 1) {
      await pool.query('UPDATE blood_delivery_partners SET is_online = 1, latitude = ?, longitude = ?, last_location_update = NOW() WHERE id = ?', [latitude, longitude, req.bloodDelivery.id]);
    } else {
      await pool.query('UPDATE blood_delivery_partners SET is_online = 0 WHERE id = ?', [req.bloodDelivery.id]);
    }

    return res.status(200).json({ message: newStatus ? 'You are now online.' : 'You are now offline.', data: { is_online: newStatus } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * PUT /api/v1/blood-delivery/location
 * Body: { latitude, longitude }
 */
const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ message: 'latitude, longitude required.' });
    await pool.query('UPDATE blood_delivery_partners SET latitude = ?, longitude = ?, last_location_update = NOW() WHERE id = ?', [latitude, longitude, req.bloodDelivery.id]);
    return res.status(200).json({ message: 'Location updated.' });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/blood-delivery/earnings
 * (based on partner stats + wallet; work-assignment deferred)
 */
const getEarnings = async (req, res) => {
  try {
    const partnerId = req.bloodDelivery.id;

    const [partner] = await pool.query('SELECT total_earned, total_deliveries FROM blood_delivery_partners WHERE id = ?', [partnerId]);
    const [walletRows] = await pool.query('SELECT balance, total_earned, total_withdrawn FROM blood_delivery_wallets WHERE delivery_partner_id = ?', [partnerId]);
    const wallet = walletRows[0] || { balance: 0, total_earned: 0, total_withdrawn: 0 };

    return res.status(200).json({
      message: 'Earnings fetched.',
      data: {
        total_earned: partner[0].total_earned,
        total_deliveries: partner[0].total_deliveries,
        wallet_balance: wallet.balance,
        wallet_total_earned: wallet.total_earned,
        wallet_total_withdrawn: wallet.total_withdrawn,
      },
    });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/blood-delivery/history?page=&limit=
 * (delivery-request history deferred until blood_delivery_requests is defined)
 */
const getDeliveryHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    return res.status(200).json({
      message: 'Delivery history fetched.',
      data: [],
      pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, total_pages: 0 },
    });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = {
  sendOtp, verifyOtp,
  step1Personal, step2Vehicle, step3Documents, step4Bank,
  getProfile, getVehicleTypes,
  toggleOnline, updateLocation,
  getEarnings, getDeliveryHistory,
};
