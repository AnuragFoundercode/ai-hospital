const { pool } = require('../../config/database');
const { clearRejectedStep } = require('../../utils/rejectedSteps');
const { normalizeQualifications, parseQualifications } = require('../../utils/qualifications');

const clean = (obj) => {
  const out = {};
  for (const k in obj) if (obj[k] !== null && obj[k] !== undefined) out[k] = obj[k];
  return out;
};

// ─── VEHICLE TYPES (for choosing during registration) ───
const getVehicleTypes = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, description, icon_url, base_fare, per_km_charge FROM ambulance_types WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
    return res.status(200).json({ message: 'Vehicle types fetched.', data: rows });
  } catch (error) { console.error('ambulance getVehicleTypes error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── REGISTRATION STEPS ───
// Step 1: Personal — full_name, email, dob, gender
const step1Personal = async (req, res) => {
  try {
    const { full_name, email, dob, gender, zone_id, city, state } = req.body;
    if (!full_name) return res.status(400).json({ message: 'full_name required.' });
    if (!zone_id) return res.status(400).json({ message: 'zone_id required.' });
    if (gender && !['male', 'female', 'other'].includes(gender)) return res.status(400).json({ message: 'Invalid gender.' });
    // Validate zone
    const [zoneRows] = await pool.query('SELECT id FROM zones WHERE id = ? AND is_active = 1', [zone_id]);
    if (!zoneRows.length) return res.status(400).json({ message: 'Invalid zone.' });
    await pool.query(
      'UPDATE ambulance_services SET full_name = ?, owner_name = ?, name = ?, email = ?, dob = ?, gender = ?, zone_id = ?, city = ?, state = ?, registration_step = GREATEST(registration_step, 1) WHERE id = ?',
      [full_name, full_name, full_name, email || null, dob || null, gender || null, zone_id, city || null, state || null, req.ambulance.id]
    );
    await clearRejectedStep('ambulance_services', req.ambulance.id, 1);
    return res.status(200).json({ message: 'Step 1 saved.', data: { registration_step: 1 } });
  } catch (error) { console.error('ambulance step1 error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// Step 2: License — driving_license_number, license_expiry_date
const step2License = async (req, res) => {
  try {
    const { driving_license_number, license_expiry_date } = req.body;
    if (!driving_license_number) return res.status(400).json({ message: 'driving_license_number required.' });
    await pool.query(
      'UPDATE ambulance_services SET driving_license_number = ?, license_expiry_date = ?, registration_step = GREATEST(registration_step, 2) WHERE id = ?',
      [driving_license_number, license_expiry_date || null, req.ambulance.id]
    );
    await clearRejectedStep('ambulance_services', req.ambulance.id, 2);
    return res.status(200).json({ message: 'Step 2 saved.', data: { registration_step: 2 } });
  } catch (error) { console.error('ambulance step2 error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// Step 3: Vehicle — stored in ambulance_vehicles table (single source of truth)
const step3Vehicle = async (req, res) => {
  try {
    const { ambulance_type_id, vehicle_number, vehicle_model, vehicle_registration_date, insurance_valid_till } = req.body;
    if (!ambulance_type_id || !vehicle_number) return res.status(400).json({ message: 'ambulance_type_id and vehicle_number required.' });
    // Validate type
    const [type] = await pool.query('SELECT id, base_fare, per_km_charge FROM ambulance_types WHERE id = ? AND is_active = 1', [ambulance_type_id]);
    if (!type.length) return res.status(400).json({ message: 'Invalid vehicle type.' });

    const ambId = req.ambulance.id;
    // Upsert vehicle row
    const [existing] = await pool.query('SELECT id FROM ambulance_vehicles WHERE ambulance_service_id = ?', [ambId]);
    if (existing.length) {
      await pool.query(
        'UPDATE ambulance_vehicles SET ambulance_type_id = ?, vehicle_number = ?, vehicle_model = ?, vehicle_registration_date = ?, insurance_valid_till = ?, is_active = 1 WHERE ambulance_service_id = ?',
        [ambulance_type_id, vehicle_number, vehicle_model || null, vehicle_registration_date || null, insurance_valid_till || null, ambId]
      );
    } else {
      await pool.query(
        'INSERT INTO ambulance_vehicles (ambulance_service_id, ambulance_type_id, vehicle_number, vehicle_model, vehicle_registration_date, insurance_valid_till, is_available, is_active) VALUES (?, ?, ?, ?, ?, ?, 1, 1)',
        [ambId, ambulance_type_id, vehicle_number, vehicle_model || null, vehicle_registration_date || null, insurance_valid_till || null]
      );
    }

    // Pricing lives on the service (copied from chosen type)
    await pool.query(
      'UPDATE ambulance_services SET base_fare = ?, per_km_charge = ?, registration_step = GREATEST(registration_step, 3) WHERE id = ?',
      [type[0].base_fare, type[0].per_km_charge, ambId]
    );
    await clearRejectedStep('ambulance_services', ambId, 3);
    return res.status(200).json({ message: 'Step 3 saved.', data: { registration_step: 3 } });
  } catch (error) { console.error('ambulance step3 error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// Step 4: Bank details — account_holder_name, account_number, bank_name, ifsc_code
const step4Bank = async (req, res) => {
  try {
    const { account_holder_name, bank_name, account_number, ifsc_code } = req.body;
    if (!account_holder_name || !bank_name || !account_number || !ifsc_code) return res.status(400).json({ message: 'All bank fields required.' });
    const ambId = req.ambulance.id;
    const [existing] = await pool.query('SELECT id FROM ambulance_bank_details WHERE ambulance_service_id = ?', [ambId]);
    if (existing.length) await pool.query('UPDATE ambulance_bank_details SET account_holder_name = ?, bank_name = ?, account_number = ?, ifsc_code = ? WHERE ambulance_service_id = ?', [account_holder_name, bank_name, account_number, ifsc_code, ambId]);
    else await pool.query('INSERT INTO ambulance_bank_details (ambulance_service_id, account_holder_name, bank_name, account_number, ifsc_code) VALUES (?, ?, ?, ?, ?)', [ambId, account_holder_name, bank_name, account_number, ifsc_code]);
    await pool.query('UPDATE ambulance_services SET registration_step = GREATEST(registration_step, 4) WHERE id = ?', [ambId]);
    await clearRejectedStep('ambulance_services', ambId, 4);
    return res.status(200).json({ message: 'Step 4 saved.', data: { registration_step: 4 } });
  } catch (error) { console.error('ambulance step4 error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// Step 5: Documents — aadhaar, dl, rc book, emergency training cert, pan card (final → pending)
const step5Documents = async (req, res) => {
  try {
    const { profile_photo, aadhaar_url, driving_licence_url, rc_book_url, emergency_training_certificate_url, pan_card_url, qualifications } = req.body;
    if (!profile_photo) return res.status(400).json({ message: 'profile_photo required.' });
    if (!aadhaar_url || !driving_licence_url || !rc_book_url) return res.status(400).json({ message: 'aadhaar_url, driving_licence_url and rc_book_url required.' });
    const quals = normalizeQualifications(qualifications);
    if (quals === undefined) {
      await pool.query(
        "UPDATE ambulance_services SET profile_photo = ?, aadhaar_url = ?, driving_licence_url = ?, rc_book_url = ?, emergency_training_certificate_url = ?, pan_card_url = ?, registration_step = 5, verification_status = 'pending' WHERE id = ?",
        [profile_photo, aadhaar_url, driving_licence_url, rc_book_url, emergency_training_certificate_url || null, pan_card_url || null, req.ambulance.id]
      );
    } else {
      await pool.query(
        "UPDATE ambulance_services SET profile_photo = ?, aadhaar_url = ?, driving_licence_url = ?, rc_book_url = ?, emergency_training_certificate_url = ?, pan_card_url = ?, qualifications = ?, registration_step = 5, verification_status = 'pending' WHERE id = ?",
        [profile_photo, aadhaar_url, driving_licence_url, rc_book_url, emergency_training_certificate_url || null, pan_card_url || null, quals, req.ambulance.id]
      );
    }
    await clearRejectedStep('ambulance_services', req.ambulance.id, 5);
    return res.status(200).json({ message: 'Documents saved. Profile submitted for approval.', data: { registration_step: 5, verification_status: 'pending' } });
  } catch (error) { console.error('ambulance step5 error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── PROFILE ───
const getProfile = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, z.name as zone_name,
              v.ambulance_type_id, v.vehicle_number, v.vehicle_model, v.vehicle_registration_date, v.insurance_valid_till,
              t.name as vehicle_type_name, t.icon_url as vehicle_type_icon
       FROM ambulance_services a
       LEFT JOIN zones z ON a.zone_id = z.id
       LEFT JOIN ambulance_vehicles v ON v.ambulance_service_id = a.id AND v.is_active = 1
       LEFT JOIN ambulance_types t ON v.ambulance_type_id = t.id
       WHERE a.id = ?`, [req.ambulance.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Not found.' });
    const p = rows[0];
    const [bankRows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM ambulance_bank_details WHERE ambulance_service_id = ?', [req.ambulance.id]);
    return res.status(200).json({
      message: 'Profile fetched.',
      data: {
        id: p.uuid,
        mobile: p.mobile,
        registration_step: p.registration_step,
        verification_status: p.verification_status,
        rejection_reason: p.rejection_reason,
        rejected_steps: p.rejected_steps ? p.rejected_steps.split(',').map(Number) : [],
        personal: clean({ name: p.name, owner_name: p.owner_name, full_name: p.full_name, email: p.email, dob: p.dob, gender: p.gender, profile_photo: p.profile_photo, zone_id: p.zone_id, zone_name: p.zone_name, city: p.city, state: p.state }),
        license: clean({ driving_license_number: p.driving_license_number, license_expiry_date: p.license_expiry_date }),
        vehicle: clean({ ambulance_type_id: p.ambulance_type_id, vehicle_type_name: p.vehicle_type_name, vehicle_type_icon: p.vehicle_type_icon, vehicle_number: p.vehicle_number, vehicle_model: p.vehicle_model, vehicle_registration_date: p.vehicle_registration_date, insurance_valid_till: p.insurance_valid_till, base_fare: p.base_fare, per_km_charge: p.per_km_charge }),
        bank: bankRows[0] || null,
        documents: clean({ aadhaar_url: p.aadhaar_url, driving_licence_url: p.driving_licence_url, rc_book_url: p.rc_book_url, emergency_training_certificate_url: p.emergency_training_certificate_url, pan_card_url: p.pan_card_url }),
        qualifications: parseQualifications(p.qualifications),
        status: { is_online: p.is_online, is_active: p.is_active },
      },
    });
  } catch (error) { console.error('ambulance getProfile error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── ONLINE / LOCATION ───
const toggleOnline = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const [rows] = await pool.query('SELECT is_online, verification_status FROM ambulance_services WHERE id = ?', [req.ambulance.id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found.' });
    if (rows[0].verification_status !== 'approved') return res.status(400).json({ message: 'Account not verified yet.' });
    const newStatus = rows[0].is_online ? 0 : 1;
    if (newStatus === 1 && (!latitude || !longitude)) return res.status(400).json({ message: 'latitude, longitude required to go online.' });
    if (newStatus === 1) await pool.query('UPDATE ambulance_services SET is_online = 1, latitude = ?, longitude = ?, last_location_update = NOW() WHERE id = ?', [latitude, longitude, req.ambulance.id]);
    else await pool.query('UPDATE ambulance_services SET is_online = 0 WHERE id = ?', [req.ambulance.id]);
    return res.status(200).json({ message: newStatus ? 'You are now online.' : 'You are now offline.', data: { is_online: newStatus } });
  } catch (error) { console.error('ambulance toggleOnline error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ message: 'latitude, longitude required.' });
    await pool.query('UPDATE ambulance_services SET latitude = ?, longitude = ?, last_location_update = NOW() WHERE id = ?', [latitude, longitude, req.ambulance.id]);
    return res.status(200).json({ message: 'Location updated.' });
  } catch (error) { console.error('ambulance updateLocation error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── DASHBOARD ───
const getDashboard = async (req, res) => {
  try {
    const ambId = req.ambulance.id;
    const istNow = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const today = new Date(istNow).toISOString().split('T')[0];

    const [totalTrips] = await pool.query('SELECT COUNT(*) as c FROM ambulance_bookings WHERE partner_id = ?', [ambId]);
    const [completedTrips] = await pool.query("SELECT COUNT(*) as c FROM ambulance_bookings WHERE partner_id = ? AND status = 'completed'", [ambId]);
    const [cancelledTrips] = await pool.query("SELECT COUNT(*) as c FROM ambulance_bookings WHERE partner_id = ? AND status = 'cancelled'", [ambId]);

    // Ensure wallet exists
    await pool.query('INSERT IGNORE INTO ambulance_wallets (ambulance_service_id) VALUES (?)', [ambId]);
    const [walletRows] = await pool.query('SELECT balance, total_earned, total_withdrawn FROM ambulance_wallets WHERE ambulance_service_id = ?', [ambId]);
    const wallet = walletRows[0] || { balance: 0, total_earned: 0, total_withdrawn: 0 };

    const [todayEarn] = await pool.query("SELECT COALESCE(SUM(amount),0) as t FROM ambulance_wallet_transactions WHERE ambulance_service_id = ? AND type = 'credit' AND reference_type = 'trip_earning' AND DATE(created_at) = ?", [ambId, today]);
    const [todayTrips] = await pool.query("SELECT COUNT(*) as c FROM ambulance_bookings WHERE partner_id = ? AND status = 'completed' AND DATE(completed_at) = ?", [ambId, today]);

    const [status] = await pool.query('SELECT is_online, verification_status FROM ambulance_services WHERE id = ?', [ambId]);

    return res.status(200).json({
      message: 'Dashboard fetched.',
      data: {
        is_online: status[0].is_online,
        verification_status: status[0].verification_status,
        total_trips: totalTrips[0].c,
        completed_trips: completedTrips[0].c,
        cancelled_trips: cancelledTrips[0].c,
        today_trips: todayTrips[0].c,
        total_earning: parseFloat(wallet.total_earned),
        today_earning: parseFloat(todayEarn[0].t),
        wallet_balance: parseFloat(wallet.balance),
      },
    });
  } catch (error) { console.error('ambulance getDashboard error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── BOOKING REQUESTS (incoming, pending) ───
const getRequests = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ab.*, u.full_name as user_name, u.mobile as user_mobile, t.name as type_name
       FROM ambulance_bookings ab
       LEFT JOIN users u ON ab.user_id = u.id
       LEFT JOIN ambulance_types t ON ab.category_id = t.id
       WHERE ab.partner_id = ? AND ab.status = 'pending' ORDER BY ab.created_at DESC`,
      [req.ambulance.id]
    );
    return res.status(200).json({
      message: 'Requests fetched.',
      data: rows.map(b => ({
        booking_id: b.booking_id,
        status: b.status,
        type: b.type_name,
        user: { name: b.user_name, mobile: b.user_mobile },
        pickup: { address: b.pickup_address, lat: b.pickup_latitude, lng: b.pickup_longitude },
        drop: { address: b.drop_address, lat: b.drop_latitude, lng: b.drop_longitude },
        distance_km: b.distance_km,
        estimated_minutes: b.estimated_time_minutes,
        fare: { base_charge: b.base_charge, per_km_charge: b.per_km_charge, total: b.total_fare },
        patient: { name: b.patient_name, condition: b.patient_condition, emergency_contact: b.emergency_contact },
        payment_method: b.payment_method,
        payment_status: b.payment_status,
        created_at: b.created_at,
      })),
    });
  } catch (error) { console.error('ambulance getRequests error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── ACTIVE RIDE (accepted / arrived / in_transit) ───
const getActiveRide = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ab.*, u.full_name as user_name, u.mobile as user_mobile, t.name as type_name
       FROM ambulance_bookings ab
       LEFT JOIN users u ON ab.user_id = u.id
       LEFT JOIN ambulance_types t ON ab.category_id = t.id
       WHERE ab.partner_id = ? AND ab.status IN ('accepted','arrived','in_transit') ORDER BY ab.accepted_at DESC LIMIT 1`,
      [req.ambulance.id]
    );
    if (!rows.length) return res.status(200).json({ message: 'No active ride.', data: null });
    const b = rows[0];
    return res.status(200).json({
      message: 'Active ride fetched.',
      data: {
        booking_id: b.booking_id,
        status: b.status,
        type: b.type_name,
        user: { name: b.user_name, mobile: b.user_mobile },
        pickup: { address: b.pickup_address, lat: b.pickup_latitude, lng: b.pickup_longitude },
        drop: { address: b.drop_address, lat: b.drop_latitude, lng: b.drop_longitude },
        distance_km: b.distance_km,
        estimated_minutes: b.estimated_time_minutes,
        fare: { base_charge: b.base_charge, per_km_charge: b.per_km_charge, total: b.total_fare },
        patient: { name: b.patient_name, condition: b.patient_condition, emergency_contact: b.emergency_contact },
        payment_method: b.payment_method,
        payment_status: b.payment_status,
        timeline: { created_at: b.created_at, accepted_at: b.accepted_at, arrived_at: b.arrived_at, started_at: b.started_at },
      },
    });
  } catch (error) { console.error('ambulance getActiveRide error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── ACCEPT BOOKING ───
const acceptBooking = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM ambulance_bookings WHERE booking_id = ? AND partner_id = ?", [req.params.booking_id, req.ambulance.id]);
    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });
    if (rows[0].status !== 'pending') return res.status(400).json({ message: `Cannot accept. Current status: ${rows[0].status}` });
    await pool.query("UPDATE ambulance_bookings SET status = 'accepted', accepted_at = NOW() WHERE id = ?", [rows[0].id]);
    // Notify user
    await notifyUser(rows[0].user_id, 'Ambulance Accepted 🚑', 'Your ambulance booking has been accepted.', { type: 'ambulance_accepted', booking_id: rows[0].booking_id });
    return res.status(200).json({ message: 'Booking accepted.', data: { booking_id: rows[0].booking_id, status: 'accepted' } });
  } catch (error) { console.error('ambulance acceptBooking error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── REJECT BOOKING ───
const rejectBooking = async (req, res) => {
  try {
    const { reason } = req.body;
    const [rows] = await pool.query("SELECT * FROM ambulance_bookings WHERE booking_id = ? AND partner_id = ?", [req.params.booking_id, req.ambulance.id]);
    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });
    if (rows[0].status !== 'pending') return res.status(400).json({ message: `Cannot reject. Current status: ${rows[0].status}` });
    await pool.query("UPDATE ambulance_bookings SET status = 'cancelled', cancelled_by = 'partner', cancellation_reason = ?, cancelled_at = NOW() WHERE id = ?", [reason || 'Rejected by partner', rows[0].id]);
    await notifyUser(rows[0].user_id, 'Ambulance Booking Rejected', 'Your ambulance booking was rejected. Please try another.', { type: 'ambulance_rejected', booking_id: rows[0].booking_id });
    return res.status(200).json({ message: 'Booking rejected.', data: { booking_id: rows[0].booking_id, status: 'cancelled' } });
  } catch (error) { console.error('ambulance rejectBooking error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── UPDATE STATUS (arrived → in_transit → completed) ───
const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const flow = { accepted: 'arrived', arrived: 'in_transit', in_transit: 'completed' };
    if (!['arrived', 'in_transit', 'completed'].includes(status)) return res.status(400).json({ message: 'status must be arrived, in_transit or completed.' });

    const [rows] = await pool.query("SELECT * FROM ambulance_bookings WHERE booking_id = ? AND partner_id = ?", [req.params.booking_id, req.ambulance.id]);
    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });
    const b = rows[0];
    if (flow[b.status] !== status) return res.status(400).json({ message: `Invalid transition. From '${b.status}' next allowed is '${flow[b.status] || 'none'}'.` });

    const timeCol = { arrived: 'arrived_at', in_transit: 'started_at', completed: 'completed_at' }[status];
    await pool.query(`UPDATE ambulance_bookings SET status = ?, ${timeCol} = NOW() WHERE id = ?`, [status, b.id]);

    // On completed → credit wallet
    if (status === 'completed') {
      const earning = parseFloat(b.total_fare);
      await pool.query('INSERT IGNORE INTO ambulance_wallets (ambulance_service_id) VALUES (?)', [req.ambulance.id]);
      await pool.query('UPDATE ambulance_wallets SET balance = balance + ?, total_earned = total_earned + ? WHERE ambulance_service_id = ?', [earning, earning, req.ambulance.id]);
      const [w] = await pool.query('SELECT balance FROM ambulance_wallets WHERE ambulance_service_id = ?', [req.ambulance.id]);
      await pool.query("INSERT INTO ambulance_wallet_transactions (ambulance_service_id, type, amount, description, reference_type, reference_id, balance_after) VALUES (?, 'credit', ?, ?, 'trip_earning', ?, ?)", [req.ambulance.id, earning, `Trip ${b.booking_id} completed. Distance: ${b.distance_km} km`, b.id, w[0].balance]);
    }

    await notifyUser(b.user_id, 'Ambulance Update 🚑', `Your ambulance is now: ${status.replace('_', ' ')}`, { type: 'ambulance_status', booking_id: b.booking_id, status });
    return res.status(200).json({ message: `Status updated to ${status}.`, data: { booking_id: b.booking_id, status } });
  } catch (error) { console.error('ambulance updateStatus error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── TRIP HISTORY ───
const getTripHistory = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['ab.partner_id = ?']; let params = [req.ambulance.id];
    if (status) { where.push('ab.status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const [count] = await pool.query(`SELECT COUNT(*) as total FROM ambulance_bookings ab WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT ab.*, u.full_name as user_name, u.mobile as user_mobile, t.name as type_name
       FROM ambulance_bookings ab
       LEFT JOIN users u ON ab.user_id = u.id
       LEFT JOIN ambulance_types t ON ab.category_id = t.id
       WHERE ${whereClause} ORDER BY ab.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    return res.status(200).json({
      message: 'Trip history fetched.',
      data: rows.map(b => ({
        booking_id: b.booking_id,
        status: b.status,
        type: b.type_name,
        user: { name: b.user_name, mobile: b.user_mobile },
        pickup_address: b.pickup_address,
        drop_address: b.drop_address,
        distance_km: b.distance_km,
        total_fare: b.total_fare,
        payment_method: b.payment_method,
        payment_status: b.payment_status,
        patient_name: b.patient_name,
        created_at: b.created_at,
        completed_at: b.completed_at,
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count[0].total, total_pages: Math.ceil(count[0].total / parseInt(limit)) },
    });
  } catch (error) { console.error('ambulance getTripHistory error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── TRIP DETAIL ───
const getTripDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ab.*, u.full_name as user_name, u.mobile as user_mobile, t.name as type_name
       FROM ambulance_bookings ab
       LEFT JOIN users u ON ab.user_id = u.id
       LEFT JOIN ambulance_types t ON ab.category_id = t.id
       WHERE ab.booking_id = ? AND ab.partner_id = ?`,
      [req.params.booking_id, req.ambulance.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Trip not found.' });
    const b = rows[0];
    return res.status(200).json({
      message: 'Trip detail fetched.',
      data: {
        booking_id: b.booking_id,
        status: b.status,
        type: b.type_name,
        user: { name: b.user_name, mobile: b.user_mobile },
        pickup: { address: b.pickup_address, lat: b.pickup_latitude, lng: b.pickup_longitude },
        drop: { address: b.drop_address, lat: b.drop_latitude, lng: b.drop_longitude },
        trip: { distance_km: b.distance_km, estimated_minutes: b.estimated_time_minutes },
        fare: { base_charge: b.base_charge, per_km_charge: b.per_km_charge, total: b.total_fare },
        patient: { name: b.patient_name, condition: b.patient_condition, emergency_contact: b.emergency_contact },
        payment: { method: b.payment_method, status: b.payment_status, transaction_id: b.transaction_id, paid_at: b.paid_at },
        rating: clean({ user_rating: b.user_rating, user_review: b.user_review }),
        cancellation: clean({ cancelled_by: b.cancelled_by, reason: b.cancellation_reason }),
        timeline: { created_at: b.created_at, accepted_at: b.accepted_at, arrived_at: b.arrived_at, started_at: b.started_at, completed_at: b.completed_at, cancelled_at: b.cancelled_at },
      },
    });
  } catch (error) { console.error('ambulance getTripDetail error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── WALLET ───
const getWallet = async (req, res) => {
  try {
    const ambId = req.ambulance.id;
    await pool.query('INSERT IGNORE INTO ambulance_wallets (ambulance_service_id) VALUES (?)', [ambId]);
    const [walletRows] = await pool.query('SELECT balance, total_earned, total_withdrawn FROM ambulance_wallets WHERE ambulance_service_id = ?', [ambId]);
    const wallet = walletRows[0];
    const [pending] = await pool.query("SELECT COALESCE(SUM(amount),0) as t FROM ambulance_withdrawals WHERE ambulance_service_id = ? AND status IN ('pending','approved')", [ambId]);
    return res.status(200).json({
      message: 'Wallet fetched.',
      data: {
        balance: parseFloat(wallet.balance),
        total_earned: parseFloat(wallet.total_earned),
        total_withdrawn: parseFloat(wallet.total_withdrawn),
        pending_withdrawals: parseFloat(pending[0].t),
      },
    });
  } catch (error) { console.error('ambulance getWallet error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

const getTransactions = async (req, res) => {
  try {
    const { type, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['ambulance_service_id = ?']; let params = [req.ambulance.id];
    if (type) { where.push('type = ?'); params.push(type); }
    const whereClause = where.join(' AND ');
    const [count] = await pool.query(`SELECT COUNT(*) as total FROM ambulance_wallet_transactions WHERE ${whereClause}`, params);
    const [rows] = await pool.query(`SELECT * FROM ambulance_wallet_transactions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);
    return res.status(200).json({
      message: 'Transactions fetched.',
      data: rows.map(t => ({ id: t.id, type: t.type, amount: parseFloat(t.amount), description: t.description, reference_type: t.reference_type, reference_id: t.reference_id, balance_after: parseFloat(t.balance_after), created_at: t.created_at })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count[0].total, total_pages: Math.ceil(count[0].total / parseInt(limit)) },
    });
  } catch (error) { console.error('ambulance getTransactions error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

const requestWithdrawal = async (req, res) => {
  try {
    const { amount, remarks } = req.body;
    const ambId = req.ambulance.id;
    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ message: 'Valid amount required.' });
    await pool.query('INSERT IGNORE INTO ambulance_wallets (ambulance_service_id) VALUES (?)', [ambId]);
    const [walletRows] = await pool.query('SELECT balance FROM ambulance_wallets WHERE ambulance_service_id = ?', [ambId]);
    if (parseFloat(walletRows[0].balance) < parseFloat(amount)) return res.status(400).json({ message: 'Insufficient balance.' });

    await pool.query('INSERT INTO ambulance_withdrawals (ambulance_service_id, amount, remarks) VALUES (?, ?, ?)', [ambId, amount, remarks || null]);
    await pool.query('UPDATE ambulance_wallets SET balance = balance - ? WHERE ambulance_service_id = ?', [amount, ambId]);
    const [updated] = await pool.query('SELECT balance FROM ambulance_wallets WHERE ambulance_service_id = ?', [ambId]);
    await pool.query("INSERT INTO ambulance_wallet_transactions (ambulance_service_id, type, amount, description, reference_type, balance_after) VALUES (?, 'debit', ?, 'Withdrawal request', 'withdrawal', ?)", [ambId, amount, updated[0].balance]);

    return res.status(201).json({ message: 'Withdrawal request submitted.', data: { amount: parseFloat(amount), new_balance: parseFloat(updated[0].balance) } });
  } catch (error) { console.error('ambulance requestWithdrawal error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

const getWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [count] = await pool.query('SELECT COUNT(*) as total FROM ambulance_withdrawals WHERE ambulance_service_id = ?', [req.ambulance.id]);
    const [rows] = await pool.query('SELECT * FROM ambulance_withdrawals WHERE ambulance_service_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [req.ambulance.id, parseInt(limit), offset]);
    return res.status(200).json({
      message: 'Withdrawals fetched.',
      data: rows.map(w => ({ id: w.id, amount: parseFloat(w.amount), status: w.status, remarks: w.remarks, admin_remarks: w.admin_remarks, processed_at: w.processed_at, created_at: w.created_at })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count[0].total, total_pages: Math.ceil(count[0].total / parseInt(limit)) },
    });
  } catch (error) { console.error('ambulance getWithdrawals error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── helper: notify user via FCM + SSE ───
async function notifyUser(userId, title, body, data) {
  try {
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [userId]);
    if (userRows[0]?.fcm_token) {
      const notificationService = require('../../services/notification.service');
      await notificationService.sendToDevice(userRows[0].fcm_token, title, body, data);
    }
    const { sendToClient } = require('../../events/sse');
    sendToClient(`user_${userId}`, data.type || 'ambulance_update', data);
  } catch (e) { /* notification failure is non-fatal */ }
}

module.exports = {
  getVehicleTypes,
  step1Personal,
  step2License,
  step3Vehicle,
  step4Bank,
  step5Documents,
  getProfile,
  toggleOnline,
  updateLocation,
  getDashboard,
  getRequests,
  getActiveRide,
  acceptBooking,
  rejectBooking,
  updateStatus,
  getTripHistory,
  getTripDetail,
  getWallet,
  getTransactions,
  requestWithdrawal,
  getWithdrawals,
};
