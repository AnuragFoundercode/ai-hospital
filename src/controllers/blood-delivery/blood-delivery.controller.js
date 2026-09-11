const jwt = require('jsonwebtoken');
const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');
const { notify } = require('../../services/notify');
const { clearRejectedStep } = require('../../utils/rejectedSteps');
const { normalizeQualifications, parseQualifications } = require('../../utils/qualifications');
const { recordCommission } = require('../../services/commission');

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
    await clearRejectedStep('blood_delivery_partners', req.bloodDelivery.id, 1);

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
    const { vehicle_type_id, vehicle_type, vehicle_number, rc_number, dl_number, zone_id } = req.body;
    if (!vehicle_number || !rc_number || !dl_number) return res.status(400).json({ message: 'vehicle_number, rc_number, dl_number required.' });
    if (!vehicle_type_id && !vehicle_type) return res.status(400).json({ message: 'vehicle_type_id required.' });

    await pool.query(
      'UPDATE blood_delivery_partners SET vehicle_type = ?, vehicle_type_id = ?, vehicle_number = ?, rc_number = ?, dl_number = ?, zone_id = ?, registration_step = GREATEST(registration_step, 2) WHERE id = ?',
      [vehicle_type || null, vehicle_type_id || null, vehicle_number, rc_number, dl_number, zone_id || null, req.bloodDelivery.id]
    );
    await clearRejectedStep('blood_delivery_partners', req.bloodDelivery.id, 2);

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
    const { aadhaar_front_url, aadhaar_back_url, pan_card_url, driving_licence_url, qualifications } = req.body;
    if (!aadhaar_front_url || !aadhaar_back_url || !driving_licence_url) {
      return res.status(400).json({ message: 'Required: aadhaar_front_url, aadhaar_back_url, driving_licence_url' });
    }
    const quals = normalizeQualifications(qualifications);

    if (quals === undefined) {
      await pool.query(
        "UPDATE blood_delivery_partners SET aadhaar_front_url = ?, aadhaar_back_url = ?, pan_card_url = ?, driving_licence_url = ?, registration_step = GREATEST(registration_step, 3) WHERE id = ?",
        [aadhaar_front_url, aadhaar_back_url, pan_card_url || null, driving_licence_url, req.bloodDelivery.id]
      );
    } else {
      await pool.query(
        "UPDATE blood_delivery_partners SET aadhaar_front_url = ?, aadhaar_back_url = ?, pan_card_url = ?, driving_licence_url = ?, qualifications = ?, registration_step = GREATEST(registration_step, 3) WHERE id = ?",
        [aadhaar_front_url, aadhaar_back_url, pan_card_url || null, driving_licence_url, quals, req.bloodDelivery.id]
      );
    }
    await clearRejectedStep('blood_delivery_partners', req.bloodDelivery.id, 3);

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
    await clearRejectedStep('blood_delivery_partners', partnerId, 4);

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
        id: p.uuid, mobile: p.mobile, registration_step: p.registration_step, verification_status: p.verification_status, rejection_reason: p.rejection_reason, rejected_steps: p.rejected_steps ? p.rejected_steps.split(',').map(Number) : [],
        personal: { full_name: p.full_name, email: p.email, date_of_birth: p.date_of_birth, gender: p.gender, profile_photo: p.profile_photo },
        vehicle: { vehicle_type: p.vehicle_type, vehicle_type_id: p.vehicle_type_id, vehicle_number: p.vehicle_number, rc_number: p.rc_number, dl_number: p.dl_number, zone_id: p.zone_id, zone_name: p.zone_name },
        documents: { aadhaar_front_url: p.aadhaar_front_url, aadhaar_back_url: p.aadhaar_back_url, pan_card_url: p.pan_card_url, driving_licence_url: p.driving_licence_url },
        qualifications: parseQualifications(p.qualifications),
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
 * GET /api/v1/blood-delivery/requests
 * Pending blood delivery requests (searching) near this online partner.
 */
const getDeliveryRequests = async (req, res) => {
  try {
    const partnerId = req.bloodDelivery.id;

    const [partnerRows] = await pool.query('SELECT latitude, longitude FROM blood_delivery_partners WHERE id = ?', [partnerId]);
    const partner = partnerRows[0];
    if (!partner || partner.latitude == null || partner.longitude == null) {
      return res.status(200).json({ message: 'Go online with your location to see requests.', data: [] });
    }

    const [configRows] = await pool.query("SELECT config_value FROM admin_config WHERE config_key = 'blood_delivery_search_radius_km'");
    const radiusKm = configRows.length ? parseFloat(configRows[0].config_value) : 5;

    const [rows] = await pool.query(
      `SELECT bdr.*, bb.name as blood_bank_name,
       (6371 * acos(cos(radians(?)) * cos(radians(pickup_latitude)) * cos(radians(pickup_longitude) - radians(?)) + sin(radians(?)) * sin(radians(pickup_latitude)))) AS distance_from_partner
       FROM blood_delivery_requests bdr
       JOIN blood_banks bb ON bdr.blood_bank_id = bb.id
       WHERE bdr.status = 'searching'
       HAVING distance_from_partner <= ?
       ORDER BY distance_from_partner ASC`,
      [partner.latitude, partner.longitude, partner.latitude, radiusKm]
    );

    return res.status(200).json({
      message: 'Blood delivery requests fetched.',
      data: rows.map(r => ({
        id: r.id, request_id: r.request_id, blood_bank_name: r.blood_bank_name,
        pickup: { address: r.pickup_address, lat: r.pickup_latitude, lng: r.pickup_longitude },
        drop: { address: r.drop_address, lat: r.drop_latitude, lng: r.drop_longitude },
        distance_km: r.distance_km, delivery_earning: r.delivery_earning,
        distance_from_you_km: parseFloat(r.distance_from_partner.toFixed(2)),
        created_at: r.created_at,
      })),
    });
  } catch (error) {
    console.error('blood-delivery getRequests error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/blood-delivery/active
 * Current active delivery (assigned / picked_up / reached).
 */
const getActiveDelivery = async (req, res) => {
  try {
    const partnerId = req.bloodDelivery.id;
    const [rows] = await pool.query(
      `SELECT bdr.*, bb.name as blood_bank_name, bb.mobile as blood_bank_mobile,
              br.request_id as blood_request_code, br.patient_name, br.hospital_name, br.blood_group, br.units_required, br.attendant_name, br.attendant_mobile
       FROM blood_delivery_requests bdr
       JOIN blood_banks bb ON bdr.blood_bank_id = bb.id
       JOIN blood_requests br ON bdr.blood_request_id = br.id
       WHERE bdr.partner_id = ? AND bdr.status IN ('assigned', 'picked_up', 'reached')
       ORDER BY bdr.assigned_at DESC LIMIT 1`,
      [partnerId]
    );
    if (!rows.length) return res.status(200).json({ message: 'No active delivery.', data: null });
    const d = rows[0];
    return res.status(200).json({
      message: 'Active delivery fetched.',
      data: {
        id: d.id, request_id: d.request_id, status: d.status,
        pickup: { address: d.pickup_address, latitude: d.pickup_latitude, longitude: d.pickup_longitude, blood_bank_name: d.blood_bank_name, blood_bank_mobile: d.blood_bank_mobile },
        drop: { address: d.drop_address, latitude: d.drop_latitude, longitude: d.drop_longitude, patient_name: d.patient_name, hospital_name: d.hospital_name, contact_name: d.attendant_name, contact_mobile: d.attendant_mobile },
        blood: { request_code: d.blood_request_code, blood_group: d.blood_group, units: d.units_required },
        distance_km: d.distance_km, delivery_earning: d.delivery_earning, delivery_otp: d.delivery_otp,
        assigned_at: d.assigned_at, picked_up_at: d.picked_up_at, reached_at: d.reached_at,
      },
    });
  } catch (error) {
    console.error('blood-delivery getActiveDelivery error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/blood-delivery/request/:id/accept
 */
const acceptDelivery = async (req, res) => {
  try {
    const partnerId = req.bloodDelivery.id;
    const { id } = req.params;

    const [rows] = await pool.query("SELECT * FROM blood_delivery_requests WHERE id = ? AND status = 'searching'", [id]);
    if (!rows.length) return res.status(404).json({ message: 'Request not found or already assigned.' });
    const request = rows[0];

    const deliveryFee = parseFloat(request.delivery_fee) || 0;
    const [partnerRows] = await pool.query('SELECT admin_commission_percent FROM blood_delivery_partners WHERE id = ?', [partnerId]);
    const commissionPercent = partnerRows[0]?.admin_commission_percent != null ? parseFloat(partnerRows[0].admin_commission_percent) : 2;
    const adminCommission = parseFloat((deliveryFee * (commissionPercent / 100)).toFixed(2));
    const netEarning = parseFloat((deliveryFee - adminCommission).toFixed(2));

    await pool.query(
      "UPDATE blood_delivery_requests SET partner_id = ?, status = 'assigned', assigned_at = NOW(), admin_commission_percent = ?, admin_commission = ?, delivery_earning = ? WHERE id = ?",
      [partnerId, commissionPercent, adminCommission, netEarning, id]
    );
    await pool.query('UPDATE blood_requests SET delivery_partner_id = ? WHERE id = ?', [partnerId, request.blood_request_id]);

    // Notify user (rider assigned)
    const [brRows] = await pool.query('SELECT user_id, request_id FROM blood_requests WHERE id = ?', [request.blood_request_id]);
    const [pInfo] = await pool.query('SELECT full_name FROM blood_delivery_partners WHERE id = ?', [partnerId]);
    const riderName = pInfo[0]?.full_name || 'A delivery partner';
    if (brRows.length) {
      await notify('user', brRows[0].user_id, {
        title: 'Delivery Partner Assigned 🩸', body: `${riderName} will deliver your blood units.`,
        type: 'order', reference_type: 'blood_request', reference_id: request.blood_request_id,
        data: { event: 'blood_rider_assigned', request_id: brRows[0].request_id },
      });
    }

    return res.status(200).json({
      message: 'Delivery accepted!',
      data: { status: 'assigned', delivery_fee: deliveryFee, admin_commission_percent: commissionPercent, admin_commission: adminCommission, your_earning: netEarning },
    });
  } catch (error) {
    console.error('blood-delivery accept error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/blood-delivery/request/:id/reject  (skip — others can still accept)
 */
const rejectDelivery = async (req, res) => {
  try {
    return res.status(200).json({ message: 'Request skipped.' });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * PUT /api/v1/blood-delivery/request/:id/picked-up
 */
const markPickedUp = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, blood_request_id, status FROM blood_delivery_requests WHERE id = ? AND partner_id = ?", [req.params.id, req.bloodDelivery.id]);
    if (!rows.length) return res.status(404).json({ message: 'Delivery not found.' });
    if (rows[0].status !== 'assigned') return res.status(400).json({ message: `Cannot mark picked up. Current: ${rows[0].status}` });

    await pool.query("UPDATE blood_delivery_requests SET status = 'picked_up', picked_up_at = NOW() WHERE id = ?", [rows[0].id]);

    const [brRows] = await pool.query('SELECT user_id, request_id FROM blood_requests WHERE id = ?', [rows[0].blood_request_id]);
    if (brRows.length) {
      await notify('user', brRows[0].user_id, {
        title: 'Blood Picked Up 🩸', body: 'Your blood units are on the way!',
        type: 'order', reference_type: 'blood_request', reference_id: rows[0].blood_request_id,
        data: { event: 'blood_picked_up', request_id: brRows[0].request_id },
      });
    }
    return res.status(200).json({ message: 'Marked as picked up.', data: { status: 'picked_up' } });
  } catch (error) {
    console.error('blood-delivery pickedUp error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/blood-delivery/request/:id/reached  (generates handover OTP for user)
 */
const markReached = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, blood_request_id, status FROM blood_delivery_requests WHERE id = ? AND partner_id = ?", [req.params.id, req.bloodDelivery.id]);
    if (!rows.length) return res.status(404).json({ message: 'Delivery not found.' });
    if (rows[0].status !== 'picked_up') return res.status(400).json({ message: `Cannot mark reached. Current: ${rows[0].status}` });

    const deliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();
    await pool.query("UPDATE blood_delivery_requests SET status = 'reached', reached_at = NOW(), delivery_otp = ? WHERE id = ?", [deliveryOtp, rows[0].id]);

    const [brRows] = await pool.query('SELECT user_id, request_id FROM blood_requests WHERE id = ?', [rows[0].blood_request_id]);
    if (brRows.length) {
      await notify('user', brRows[0].user_id, {
        title: 'Delivery Partner Arrived 🏠', body: `Your blood units have arrived! Handover OTP: ${deliveryOtp}`,
        type: 'order', reference_type: 'blood_request', reference_id: rows[0].blood_request_id,
        data: { event: 'blood_reached', request_id: brRows[0].request_id, delivery_otp: deliveryOtp },
      });
    }
    return res.status(200).json({ message: 'Marked as reached. OTP sent to user.', data: { status: 'reached' } });
  } catch (error) {
    console.error('blood-delivery markReached error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/blood-delivery/request/:id/delivered
 * Body: { otp }
 * Verifies OTP, completes the blood request (dispatch inventory + bloodbank wallet),
 * and credits the delivery partner's wallet (fee minus admin commission).
 */
const markDelivered = async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ message: 'Delivery OTP required.' });
    const partnerId = req.bloodDelivery.id;

    const [rows] = await pool.query(
      `SELECT bdr.*, br.blood_bank_id, br.user_id, br.blood_group, br.units_required, br.total_amount, br.delivery_fee, br.payment_method, br.request_id as blood_request_code
       FROM blood_delivery_requests bdr JOIN blood_requests br ON bdr.blood_request_id = br.id
       WHERE bdr.id = ? AND bdr.partner_id = ?`,
      [req.params.id, partnerId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Delivery not found.' });
    const d = rows[0];
    if (d.status !== 'reached') return res.status(400).json({ message: `Cannot mark delivered. Current: ${d.status}` });
    if (d.delivery_otp !== otp) return res.status(400).json({ message: 'Invalid OTP.' });

    // 1) Mark delivery + blood request completed
    await pool.query("UPDATE blood_delivery_requests SET status = 'delivered', delivered_at = NOW() WHERE id = ?", [d.id]);
    if (d.payment_method === 'offline') {
      await pool.query("UPDATE blood_requests SET status = 'completed', payment_status = 'paid', paid_at = NOW() WHERE id = ?", [d.blood_request_id]);
    } else {
      await pool.query("UPDATE blood_requests SET status = 'completed' WHERE id = ?", [d.blood_request_id]);
    }

    // 2) Dispatch reserved inventory (reserved -> dispatched), FEFO
    await pool.query(
      `UPDATE bloodbank_inventory_items SET status = 'dispatched'
       WHERE blood_bank_id = ? AND blood_group = ? AND status = 'reserved'
       ORDER BY expiry_date ASC LIMIT ?`,
      [d.blood_bank_id, d.blood_group, d.units_required]
    );

    // 3) Credit blood bank wallet (blood amount portion, minus bank admin commission).
    //    Blood amount = total_amount - delivery_fee (delivery fee belongs to the rider).
    const bloodAmount = parseFloat(d.total_amount) - parseFloat(d.delivery_fee || 0);
    const [bankRow] = await pool.query('SELECT admin_commission_percent FROM blood_banks WHERE id = ?', [d.blood_bank_id]);
    const bankCommissionPct = bankRow[0]?.admin_commission_percent || 15;
    const bankAdminCommission = parseFloat((bloodAmount * (bankCommissionPct / 100)).toFixed(2));
    const bankEarning = parseFloat((bloodAmount - bankAdminCommission).toFixed(2));

    const [bankWalletExists] = await pool.query('SELECT id FROM bloodbank_wallets WHERE blood_bank_id = ?', [d.blood_bank_id]);
    if (!bankWalletExists.length) await pool.query('INSERT INTO bloodbank_wallets (blood_bank_id) VALUES (?)', [d.blood_bank_id]);
    await pool.query('UPDATE bloodbank_wallets SET balance = balance + ?, total_earned = total_earned + ? WHERE blood_bank_id = ?', [bankEarning, bankEarning, d.blood_bank_id]);
    const [bankWallet] = await pool.query('SELECT balance FROM bloodbank_wallets WHERE blood_bank_id = ?', [d.blood_bank_id]);
    await pool.query(
      "INSERT INTO bloodbank_wallet_transactions (blood_bank_id, type, amount, description, reference_type, reference_id, admin_commission, balance_after) VALUES (?, 'credit', ?, ?, 'blood_request_fee', ?, ?, ?)",
      [d.blood_bank_id, bankEarning, `Blood request ${d.blood_request_code} delivered. Commission: ₹${bankAdminCommission.toFixed(2)}`, d.blood_request_id, bankAdminCommission, bankWallet[0].balance]
    );

    // 4) Credit delivery partner wallet (delivery fee minus partner admin commission)
    const partnerEarning = parseFloat(d.delivery_earning) || 0;
    const partnerAdminCommission = parseFloat(d.admin_commission) || 0;
    await pool.query('UPDATE blood_delivery_partners SET total_deliveries = total_deliveries + 1, total_earned = total_earned + ? WHERE id = ?', [partnerEarning, partnerId]);
    const [dpWalletExists] = await pool.query('SELECT id FROM blood_delivery_wallets WHERE delivery_partner_id = ?', [partnerId]);
    if (!dpWalletExists.length) await pool.query('INSERT INTO blood_delivery_wallets (delivery_partner_id) VALUES (?)', [partnerId]);
    await pool.query('UPDATE blood_delivery_wallets SET balance = balance + ?, total_earned = total_earned + ? WHERE delivery_partner_id = ?', [partnerEarning, partnerEarning, partnerId]);
    const [dpWallet] = await pool.query('SELECT balance FROM blood_delivery_wallets WHERE delivery_partner_id = ?', [partnerId]);
    await pool.query(
      "INSERT INTO blood_delivery_wallet_transactions (delivery_partner_id, type, amount, description, reference_type, reference_id, admin_commission, balance_after) VALUES (?, 'credit', ?, ?, 'delivery_earning', ?, ?, ?)",
      [partnerId, partnerEarning, `Blood delivery ${d.request_id} completed. Fee: ₹${d.delivery_fee}, commission: ₹${partnerAdminCommission.toFixed(2)}, distance: ${d.distance_km} km`, d.id, partnerAdminCommission, dpWallet[0].balance]
    );

    // Admin commission ledger: blood bank + blood delivery fee
    await recordCommission({ module: 'blood_bank', reference_type: 'blood_request', reference_id: d.blood_request_id, reference_code: d.blood_request_code, user_id: d.user_id, vendor_type: 'blood_bank', vendor_id: d.blood_bank_id, gross_amount: bloodAmount, commission_percent: bankCommissionPct, commission_amount: bankAdminCommission });
    await recordCommission({ module: 'blood_delivery', reference_type: 'blood_delivery_request', reference_id: d.id, reference_code: d.request_id, user_id: d.user_id, vendor_type: 'blood_delivery_partner', vendor_id: partnerId, gross_amount: parseFloat(d.delivery_fee) || 0, commission_percent: parseFloat(d.admin_commission_percent) || 0, commission_amount: partnerAdminCommission });

    // 5) Notify user + blood bank
    await notify('user', d.user_id, {
      title: 'Blood Delivered! 🎉', body: 'Your blood units have been delivered.',
      type: 'order', reference_type: 'blood_request', reference_id: d.blood_request_id,
      data: { event: 'blood_delivered', request_id: d.blood_request_code },
    });
    await notify('blood_bank', d.blood_bank_id, {
      title: 'Blood Delivered ✅', body: `Request ${d.blood_request_code} delivered. ₹${bankEarning.toFixed(2)} credited (less commission).`,
      type: 'order', reference_type: 'blood_request', reference_id: d.blood_request_id,
      data: { event: 'blood_delivered', request_id: d.blood_request_code },
    });

    return res.status(200).json({
      message: 'Blood delivered!',
      data: { status: 'delivered', delivery_fee: d.delivery_fee, admin_commission: partnerAdminCommission, earning: partnerEarning },
    });
  } catch (error) {
    console.error('blood-delivery markDelivered error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/blood-delivery/earnings
 */
const getEarnings = async (req, res) => {
  try {
    const partnerId = req.bloodDelivery.id;
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = `${today.substring(0, 7)}-01`;

    const [partner] = await pool.query('SELECT total_earned, total_deliveries FROM blood_delivery_partners WHERE id = ?', [partnerId]);
    const [todayE] = await pool.query("SELECT COALESCE(SUM(delivery_earning), 0) as total, COUNT(*) as trips FROM blood_delivery_requests WHERE partner_id = ? AND status = 'delivered' AND DATE(delivered_at) = ?", [partnerId, today]);
    const [monthE] = await pool.query("SELECT COALESCE(SUM(delivery_earning), 0) as total, COUNT(*) as trips FROM blood_delivery_requests WHERE partner_id = ? AND status = 'delivered' AND delivered_at >= ?", [partnerId, firstOfMonth]);
    const [walletRows] = await pool.query('SELECT balance, total_earned, total_withdrawn FROM blood_delivery_wallets WHERE delivery_partner_id = ?', [partnerId]);
    const wallet = walletRows[0] || { balance: 0, total_earned: 0, total_withdrawn: 0 };

    return res.status(200).json({
      message: 'Earnings fetched.',
      data: {
        total_earned: partner[0].total_earned,
        total_deliveries: partner[0].total_deliveries,
        today: { earned: todayE[0].total, trips: todayE[0].trips },
        this_month: { earned: monthE[0].total, trips: monthE[0].trips },
        wallet_balance: wallet.balance,
        wallet_total_earned: wallet.total_earned,
        wallet_total_withdrawn: wallet.total_withdrawn,
      },
    });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/blood-delivery/history?status=&page=&limit=
 */
const getDeliveryHistory = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['bdr.partner_id = ?']; let params = [req.bloodDelivery.id];
    if (status) { where.push('bdr.status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM blood_delivery_requests bdr WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT bdr.*, bb.name as blood_bank_name FROM blood_delivery_requests bdr JOIN blood_banks bb ON bdr.blood_bank_id = bb.id WHERE ${whereClause} ORDER BY bdr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Delivery history fetched.',
      data: rows.map(r => ({ id: r.id, request_id: r.request_id, blood_bank_name: r.blood_bank_name, pickup_address: r.pickup_address, drop_address: r.drop_address, distance_km: r.distance_km, delivery_earning: r.delivery_earning, status: r.status, assigned_at: r.assigned_at, delivered_at: r.delivered_at })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = {
  sendOtp, verifyOtp,
  step1Personal, step2Vehicle, step3Documents, step4Bank,
  getProfile, getVehicleTypes,
  toggleOnline, updateLocation,
  getDeliveryRequests, getActiveDelivery,
  acceptDelivery, rejectDelivery, markPickedUp, markReached, markDelivered,
  getEarnings, getDeliveryHistory,
};
