const { pool } = require('../../config/database');
const distanceService = require('../../services/distance.service');

// ─────────────────────────────────────────────
// USER AMBULANCE CONTROLLER
// Uses: ambulance_services (provider/driver), ambulance_types (categories), ambulance_vehicles
// ─────────────────────────────────────────────

/**
 * GET /api/v1/user/ambulance/categories
 */
const getCategories = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, description, icon_url, base_fare, per_km_charge FROM ambulance_types WHERE is_active = 1 ORDER BY sort_order');
    return res.status(200).json({ message: 'Ambulance categories fetched.', data: rows });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/user/ambulances?pincode=&type_id=&user_lat=&user_lng=
 * List available ambulances (from ambulance_services + vehicles)
 */
const getAmbulanceList = async (req, res) => {
  try {
    const { pincode, type_id, user_lat, user_lng } = req.query;

    // Base filter: partner-driver from ambulance_services (verified, active, online)
    let where = ['asr.is_active = 1', 'asr.is_verified = 1', 'asr.is_online = 1', "asr.verification_status = 'approved'"];
    let params = [];

    // Zone filter by pincode
    if (pincode) {
      const [zoneRows] = await pool.query("SELECT id FROM zones WHERE is_active = 1 AND JSON_CONTAINS(pincodes, ?)", [JSON.stringify(pincode)]);
      if (zoneRows.length) { where.push('asr.zone_id = ?'); params.push(zoneRows[0].id); }
      else { return res.status(200).json({ message: 'No ambulance available in this pincode.', data: [] }); }
    }

    // Vehicle type filter
    if (type_id) { where.push('asv.ambulance_type_id = ?'); params.push(parseInt(type_id)); }

    const whereClause = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT asr.id as service_id, asr.uuid, asr.name, asr.owner_name, asr.full_name, asr.mobile, asr.profile_photo,
              asr.base_latitude, asr.base_longitude, asr.latitude, asr.longitude, asr.is_online,
              asr.base_fare as service_base_fare, asr.per_km_charge as service_per_km, asr.average_rating,
              asv.vehicle_number, asv.vehicle_model, asv.ambulance_type_id as type_id,
              at.name as type_name, at.base_fare as type_base_fare, at.per_km_charge as type_per_km, at.description as type_description, at.icon_url as type_icon
       FROM ambulance_services asr
       JOIN ambulance_vehicles asv ON asv.ambulance_service_id = asr.id AND asv.is_active = 1 AND asv.is_available = 1
       LEFT JOIN ambulance_types at ON asv.ambulance_type_id = at.id
       WHERE ${whereClause}
       GROUP BY asr.id`,
      params
    );

    // Calculate distance from user
    const ambulances = rows.map(r => {
      let distanceInfo = null;
      if (user_lat && user_lng && (r.latitude || r.base_latitude) && (r.longitude || r.base_longitude)) {
        const lat = parseFloat(r.latitude || r.base_latitude);
        const lng = parseFloat(r.longitude || r.base_longitude);
        const km = distanceService.haversine(parseFloat(user_lat), parseFloat(user_lng), lat, lng);
        distanceInfo = { distance_km: parseFloat(km.toFixed(2)), eta_minutes: Math.ceil(km * 3) };
      }

      return {
        id: r.uuid,
        name: r.name || r.full_name,
        owner_name: r.owner_name || r.full_name,
        profile_photo: r.profile_photo,
        mobile: r.mobile,
        vehicle: { number: r.vehicle_number, model: r.vehicle_model },
        type: { id: r.type_id, name: r.type_name, base_fare: r.type_base_fare, per_km_charge: r.type_per_km, icon: r.type_icon },
        base_fare: r.service_base_fare || r.type_base_fare,
        per_km_charge: r.service_per_km || r.type_per_km,
        rating: r.average_rating,
        is_online: r.is_online,
        distance: distanceInfo,
      };
    });

    // Sort by nearest
    if (user_lat && user_lng) ambulances.sort((a, b) => (a.distance?.distance_km || 999) - (b.distance?.distance_km || 999));

    return res.status(200).json({ message: 'Ambulances fetched.', data: ambulances, total: ambulances.length });
  } catch (error) {
    console.error('getAmbulanceList error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/ambulance/:uuid?user_lat=&user_lng=
 */
const getAmbulanceDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const { user_lat, user_lng } = req.query;

    const [rows] = await pool.query(
      `SELECT asr.*, asv.vehicle_number, asv.vehicle_model, asv.ambulance_type_id, asv.vehicle_registration_date, asv.insurance_valid_till,
              at.name as type_name, at.base_fare as type_base_fare, at.per_km_charge as type_per_km, at.description as type_description
       FROM ambulance_services asr
       LEFT JOIN ambulance_vehicles asv ON asv.ambulance_service_id = asr.id AND asv.is_active = 1
       LEFT JOIN ambulance_types at ON asv.ambulance_type_id = at.id
       WHERE asr.uuid = ? AND asr.is_active = 1
       GROUP BY asr.id`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ message: 'Ambulance not found.' });
    const r = rows[0];

    let distanceInfo = null;
    if (user_lat && user_lng && r.base_latitude && r.base_longitude) {
      distanceInfo = await distanceService.getDistance(parseFloat(user_lat), parseFloat(user_lng), parseFloat(r.base_latitude), parseFloat(r.base_longitude));
    }

    return res.status(200).json({
      message: 'Ambulance detail fetched.',
      data: {
        id: r.uuid,
        name: r.name || r.full_name,
        owner_name: r.owner_name || r.full_name,
        mobile: r.mobile,
        profile_photo: r.profile_photo,
        registration_number: r.registration_number,
        vehicle: { number: r.vehicle_number, model: r.vehicle_model, registration_date: r.vehicle_registration_date, insurance_valid_till: r.insurance_valid_till },
        type: { id: r.ambulance_type_id, name: r.type_name, base_fare: r.type_base_fare, per_km_charge: r.type_per_km, description: r.type_description },
        location: { city: r.city, state: r.state, latitude: r.base_latitude, longitude: r.base_longitude, coverage_radius_km: r.coverage_radius_km },
        fare: { base_fare: r.base_fare || r.type_base_fare, per_km_charge: r.per_km_charge || r.type_per_km },
        rating: r.average_rating,
        is_verified: r.is_verified,
        distance_from_user: distanceInfo,
      },
    });
  } catch (error) {
    console.error('getAmbulanceDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/user/ambulance/book
 * Body: { ambulance_id (uuid), address_id, drop_address, drop_latitude, drop_longitude, patient_name, patient_age, patient_gender, contact_number, remark, payment_method }
 */
const bookAmbulance = async (req, res) => {
  try {
    const userId = req.user.id;
    const { ambulance_id, address_id, drop_address, drop_latitude, drop_longitude, patient_name, patient_age, patient_gender, contact_number, remark, payment_method } = req.body;

    if (!ambulance_id || !address_id || !drop_address || !drop_latitude || !drop_longitude || !patient_name || !contact_number || !payment_method) {
      return res.status(400).json({ message: 'Required: ambulance_id, address_id, drop_address, drop_latitude, drop_longitude, patient_name, contact_number, payment_method' });
    }

    if (!['online', 'cash'].includes(payment_method)) return res.status(400).json({ message: 'payment_method must be "online" or "cash".' });

    // Get ambulance service
    const [ambRows] = await pool.query(
      `SELECT asr.id, asr.uuid, asr.name, asr.full_name, asr.is_online, asr.base_fare, asr.per_km_charge, asr.fcm_token,
              asv.ambulance_type_id as type_id,
              at.name as type_name, at.base_fare as type_base_fare, at.per_km_charge as type_per_km
       FROM ambulance_services asr
       LEFT JOIN ambulance_vehicles asv ON asv.ambulance_service_id = asr.id AND asv.is_active = 1
       LEFT JOIN ambulance_types at ON asv.ambulance_type_id = at.id
       WHERE asr.uuid = ? AND asr.is_active = 1 AND asr.is_verified = 1
       GROUP BY asr.id
       LIMIT 1`,
      [ambulance_id]
    );

    if (!ambRows.length) return res.status(404).json({ message: 'Ambulance not found.' });
    const amb = ambRows[0];

    if (!amb.is_online) return res.status(400).json({ message: 'Ambulance is currently offline.' });

    // Get pickup address
    const [addrRows] = await pool.query('SELECT * FROM user_addresses WHERE id = ? AND user_id = ?', [address_id, userId]);
    if (!addrRows.length) return res.status(404).json({ message: 'Address not found.' });
    const pickup = addrRows[0];

    if (!pickup.latitude || !pickup.longitude) return res.status(400).json({ message: 'Pickup address must have latitude and longitude.' });

    // Calculate distance & fare
    const distanceInfo = await distanceService.getDistance(parseFloat(pickup.latitude), parseFloat(pickup.longitude), parseFloat(drop_latitude), parseFloat(drop_longitude));
    const baseFare = parseFloat(amb.base_fare || amb.type_base_fare || 200);
    const perKm = parseFloat(amb.per_km_charge || amb.type_per_km || 50);
    const totalFare = baseFare + (distanceInfo.distance_km * perKm);

    // Create booking
    const bookingId = `AMB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const categoryId = amb.type_id || 1;

    await pool.query(
      `INSERT INTO ambulance_bookings (booking_id, user_id, partner_id, category_id, pickup_latitude, pickup_longitude, pickup_address, drop_latitude, drop_longitude, drop_address, distance_km, estimated_time_minutes, base_charge, per_km_charge, total_fare, payment_method, status, patient_name, patient_condition, emergency_contact)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [bookingId, userId, amb.id, categoryId, pickup.latitude, pickup.longitude, `${pickup.address_line1}, ${pickup.city}`, drop_latitude, drop_longitude, drop_address, distanceInfo.distance_km, distanceInfo.duration_minutes, baseFare, perKm, totalFare.toFixed(2), payment_method, patient_name, `Age: ${patient_age || ''}, Gender: ${patient_gender || ''}`, contact_number]
    );

    // Online payment → Paytm
    let paytmData = null;
    if (payment_method === 'online') {
      try {
        const paytmService = require('../../services/paytm.service');
        const paytmConfig = require('../../config/paytm');
        const paytmResponse = await paytmService.initiateTransaction(bookingId, parseFloat(totalFare.toFixed(2)), userId);
        if (paytmResponse.body?.txnToken) {
          paytmData = { txn_token: paytmResponse.body.txnToken, order_id: bookingId, mid: paytmConfig.mid, amount: totalFare.toFixed(2), callback_url: paytmConfig.callbackUrl, website: paytmConfig.website, base_url: paytmConfig.baseUrl };
        } else {
          paytmData = { txn_token: null, order_id: bookingId, mid: paytmConfig.mid, amount: totalFare.toFixed(2), error: paytmResponse.body?.resultInfo?.resultMsg || 'Failed' };
        }
      } catch (e) { paytmData = { txn_token: null, order_id: bookingId, error: e.message }; }
    }

    // Notify ambulance provider (FCM + SSE)
    {
      const { notify } = require('../../services/notify');
      await notify('ambulance_service', amb.id, {
        title: 'New Ambulance Booking 🚑',
        body: `Pickup: ${pickup.address_line1}. Fare: ₹${totalFare.toFixed(0)}`,
        type: 'booking', reference_type: 'ambulance_booking', reference_id: null, reference_code: bookingId,
        data: { event: 'new_ambulance_booking', booking_id: bookingId },
        fcmToken: amb.fcm_token,
      });
    }
    const { sendToClient } = require('../../events/sse');
    sendToClient(`ambulance_${amb.id}`, 'new_booking', { booking_id: bookingId, pickup_address: pickup.address_line1, drop_address, fare: totalFare.toFixed(2), patient_name });

    return res.status(201).json({
      message: payment_method === 'cash' ? 'Ambulance booked! Pay in cash.' : 'Ambulance booked! Complete payment.',
      data: {
        booking_id: bookingId,
        ambulance: { id: amb.uuid, name: amb.name || amb.full_name },
        trip: { pickup_address: `${pickup.address_line1}, ${pickup.city}`, drop_address, distance_km: distanceInfo.distance_km, estimated_minutes: distanceInfo.duration_minutes },
        fare: { base_charge: baseFare, per_km_charge: perKm, total: parseFloat(totalFare.toFixed(2)) },
        patient: { name: patient_name, age: patient_age, gender: patient_gender, contact: contact_number },
        payment_method,
        status: 'pending',
        payment: paytmData,
      },
    });
  } catch (error) {
    console.error('bookAmbulance error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/ambulance-bookings?status=&page=&limit=
 */
const getAmbulanceBookings = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['ab.user_id = ?']; let params = [req.user.id];
    if (status) { where.push('ab.status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM ambulance_bookings ab WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT ab.*, asr.uuid as amb_uuid, asr.name as amb_name, asr.mobile as amb_mobile, at.name as type_name
       FROM ambulance_bookings ab
       LEFT JOIN ambulance_services asr ON ab.partner_id = asr.id
       LEFT JOIN ambulance_types at ON ab.category_id = at.id
       WHERE ${whereClause} ORDER BY ab.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    return res.status(200).json({ message: 'Bookings fetched.', data: rows.map(b => ({ booking_id: b.booking_id, status: b.status, ambulance: { id: b.amb_uuid, name: b.amb_name, mobile: b.amb_mobile }, type: b.type_name, pickup_address: b.pickup_address, drop_address: b.drop_address, distance_km: b.distance_km, total_fare: b.total_fare, payment_method: b.payment_method, payment_status: b.payment_status, patient_name: b.patient_name, created_at: b.created_at })), pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/user/ambulance-booking/:booking_id
 */
const getAmbulanceBookingDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ab.*, asr.uuid as amb_uuid, asr.name as amb_name, asr.mobile as amb_mobile, asr.profile_photo as amb_photo, asr.latitude as amb_lat, asr.longitude as amb_lng
       FROM ambulance_bookings ab
       LEFT JOIN ambulance_services asr ON ab.partner_id = asr.id
       WHERE ab.booking_id = ? AND ab.user_id = ?`,
      [req.params.booking_id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });
    const b = rows[0];
    return res.status(200).json({ message: 'Booking detail fetched.', data: { booking_id: b.booking_id, status: b.status, ambulance: { id: b.amb_uuid, name: b.amb_name, mobile: b.amb_mobile, photo: b.amb_photo, live_location: { lat: b.amb_lat, lng: b.amb_lng } }, pickup: { address: b.pickup_address, lat: b.pickup_latitude, lng: b.pickup_longitude }, drop: { address: b.drop_address, lat: b.drop_latitude, lng: b.drop_longitude }, trip: { distance_km: b.distance_km, estimated_minutes: b.estimated_time_minutes }, fare: { base_charge: b.base_charge, per_km_charge: b.per_km_charge, total: b.total_fare }, patient: { name: b.patient_name, condition: b.patient_condition, emergency_contact: b.emergency_contact }, payment: { method: b.payment_method, status: b.payment_status, transaction_id: b.transaction_id, paid_at: b.paid_at }, rating: { user_rating: b.user_rating, user_review: b.user_review }, timeline: { created_at: b.created_at, accepted_at: b.accepted_at, arrived_at: b.arrived_at, started_at: b.started_at, completed_at: b.completed_at, cancelled_at: b.cancelled_at } } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = { getCategories, getAmbulanceList, getAmbulanceDetail, bookAmbulance, getAmbulanceBookings, getAmbulanceBookingDetail };
