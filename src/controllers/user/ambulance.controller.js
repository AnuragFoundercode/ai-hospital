const { pool } = require('../../config/database');
const distanceService = require('../../services/distance.service');
const paytmService = require('../../services/paytm.service');
const paytmConfig = require('../../config/paytm');
const notificationService = require('../../services/notification.service');

// ─────────────────────────────────────────────
// USER AMBULANCE CONTROLLER
// ─────────────────────────────────────────────

/**
 * GET /api/v1/user/ambulance/categories
 */
const getCategories = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, description, base_charge, per_km_charge, icon_url FROM ambulance_categories WHERE is_active = 1');
    return res.status(200).json({ message: 'Categories fetched.', data: rows });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * POST /api/v1/user/ambulance/search
 * Body: { pickup_lat, pickup_lng, drop_lat, drop_lng, pickup_address, drop_address }
 * Returns nearby ambulances grouped by category with fare estimate
 */
const searchAmbulance = async (req, res) => {
  try {
    const { pickup_lat, pickup_lng, drop_lat, drop_lng, pickup_address, drop_address } = req.body;

    if (!pickup_lat || !pickup_lng || !drop_lat || !drop_lng) {
      return res.status(400).json({ message: 'pickup_lat, pickup_lng, drop_lat, drop_lng required.' });
    }

    // Calculate distance between pickup and drop
    const distanceInfo = await distanceService.getDistance(pickup_lat, pickup_lng, drop_lat, drop_lng);

    // Find online, verified partners within 10 km of pickup
    const radiusKm = 10;
    const [partners] = await pool.query(
      `SELECT ap.id, ap.uuid, ap.name, ap.profile_photo, ap.vehicle_number, ap.category_id, ap.latitude, ap.longitude, ap.average_rating, ap.total_trips, ac.name as category_name, ac.base_charge, ac.per_km_charge,
       (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude)))) AS distance_from_pickup
       FROM ambulance_partners ap
       JOIN ambulance_categories ac ON ap.category_id = ac.id
       WHERE ap.is_online = 1 AND ap.is_verified = 1 AND ap.is_active = 1 AND ap.latitude IS NOT NULL
       HAVING distance_from_pickup <= ?
       ORDER BY distance_from_pickup ASC`,
      [pickup_lat, pickup_lng, pickup_lat, radiusKm]
    );

    // Group by category with fare
    const categories = {};
    for (const p of partners) {
      if (!categories[p.category_id]) {
        const fare = parseFloat(p.base_charge) + (distanceInfo.distance_km * parseFloat(p.per_km_charge));
        categories[p.category_id] = {
          category_id: p.category_id,
          category_name: p.category_name,
          base_charge: p.base_charge,
          per_km_charge: p.per_km_charge,
          estimated_fare: parseFloat(fare.toFixed(2)),
          partners: [],
        };
      }
      categories[p.category_id].partners.push({
        id: p.uuid,
        name: p.name,
        profile_photo: p.profile_photo,
        vehicle_number: p.vehicle_number,
        rating: p.average_rating,
        total_trips: p.total_trips,
        distance_from_pickup_km: parseFloat(p.distance_from_pickup.toFixed(2)),
        eta_minutes: Math.ceil(p.distance_from_pickup * 3), // ~20km/h in city
      });
    }

    return res.status(200).json({
      message: 'Ambulances found.',
      data: {
        trip: {
          pickup: { lat: pickup_lat, lng: pickup_lng, address: pickup_address || null },
          drop: { lat: drop_lat, lng: drop_lng, address: drop_address || null },
          distance_km: distanceInfo.distance_km,
          estimated_time: distanceInfo.duration_text,
          estimated_minutes: distanceInfo.duration_minutes,
        },
        categories: Object.values(categories),
        total_available: partners.length,
      },
    });
  } catch (error) {
    console.error('searchAmbulance error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/user/ambulance/book
 * Body: { partner_id (uuid), category_id, pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address, payment_method, patient_name, patient_condition, emergency_contact }
 */
const bookAmbulance = async (req, res) => {
  try {
    const userId = req.user.id;
    const { partner_id, category_id, pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address, payment_method, patient_name, patient_condition, emergency_contact } = req.body;

    if (!category_id || !pickup_lat || !pickup_lng || !pickup_address || !drop_lat || !drop_lng || !drop_address || !payment_method) {
      return res.status(400).json({ message: 'Required: category_id, pickup/drop lat/lng/address, payment_method' });
    }

    if (!['online', 'cash'].includes(payment_method)) {
      return res.status(400).json({ message: 'payment_method must be "online" or "cash".' });
    }

    // Get category
    const [catRows] = await pool.query('SELECT * FROM ambulance_categories WHERE id = ? AND is_active = 1', [category_id]);
    if (!catRows.length) return res.status(404).json({ message: 'Category not found.' });
    const category = catRows[0];

    // Calculate distance
    const distanceInfo = await distanceService.getDistance(pickup_lat, pickup_lng, drop_lat, drop_lng);
    const totalFare = parseFloat(category.base_charge) + (distanceInfo.distance_km * parseFloat(category.per_km_charge));

    // Find partner (specific or nearest)
    let assignedPartnerId = null;
    if (partner_id) {
      const [pRows] = await pool.query("SELECT id FROM ambulance_partners WHERE uuid = ? AND is_online = 1 AND is_verified = 1 AND category_id = ?", [partner_id, category_id]);
      if (pRows.length) assignedPartnerId = pRows[0].id;
    }

    if (!assignedPartnerId) {
      // Auto-assign nearest
      const [nearest] = await pool.query(
        `SELECT id FROM ambulance_partners WHERE is_online = 1 AND is_verified = 1 AND is_active = 1 AND category_id = ? AND latitude IS NOT NULL
         ORDER BY (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude)))) ASC LIMIT 1`,
        [category_id, pickup_lat, pickup_lng, pickup_lat]
      );
      if (nearest.length) assignedPartnerId = nearest[0].id;
    }

    const bookingId = `AMB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await pool.query(
      `INSERT INTO ambulance_bookings (booking_id, user_id, partner_id, category_id, pickup_latitude, pickup_longitude, pickup_address, drop_latitude, drop_longitude, drop_address, distance_km, estimated_time_minutes, base_charge, per_km_charge, total_fare, payment_method, status, patient_name, patient_condition, emergency_contact)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bookingId, userId, assignedPartnerId, category_id, pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address, distanceInfo.distance_km, distanceInfo.duration_minutes, category.base_charge, category.per_km_charge, totalFare.toFixed(2), payment_method, assignedPartnerId ? 'pending' : 'searching', patient_name || null, patient_condition || null, emergency_contact || null]
    );

    // Notify partner
    if (assignedPartnerId) {
      const [partnerRow] = await pool.query('SELECT fcm_token FROM ambulance_partners WHERE id = ?', [assignedPartnerId]);
      if (partnerRow[0]?.fcm_token) {
        await notificationService.sendToDevice(partnerRow[0].fcm_token, 'New Ambulance Request 🚑', `Pickup: ${pickup_address}. Fare: ₹${totalFare.toFixed(0)}`, { type: 'new_ambulance_booking', booking_id: bookingId });
      }
    }

    // Online payment
    let paytmData = null;
    if (payment_method === 'online') {
      try {
        const paytmResponse = await paytmService.initiateTransaction(bookingId, parseFloat(totalFare.toFixed(2)), userId);
        if (paytmResponse.body?.txnToken) { paytmData = { txn_token: paytmResponse.body.txnToken, order_id: bookingId, mid: paytmConfig.mid, amount: totalFare.toFixed(2), callback_url: paytmConfig.callbackUrl, website: paytmConfig.website, base_url: paytmConfig.baseUrl }; }
        else { paytmData = { txn_token: null, order_id: bookingId, mid: paytmConfig.mid, amount: totalFare.toFixed(2), error: paytmResponse.body?.resultInfo?.resultMsg || 'Failed' }; }
      } catch (e) { paytmData = { txn_token: null, order_id: bookingId, error: e.message }; }
    }

    return res.status(201).json({
      message: assignedPartnerId ? 'Ambulance booked! Partner notified.' : 'Booking created. Searching for partner...',
      data: {
        booking_id: bookingId,
        status: assignedPartnerId ? 'pending' : 'searching',
        category: category.name,
        trip: { pickup_address, drop_address, distance_km: distanceInfo.distance_km, estimated_minutes: distanceInfo.duration_minutes },
        fare: { base_charge: category.base_charge, per_km_charge: category.per_km_charge, total: parseFloat(totalFare.toFixed(2)) },
        payment_method,
        payment: paytmData,
      },
    });
  } catch (error) {
    console.error('bookAmbulance error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/ambulance-bookings?status=
 */
const getBookings = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['ab.user_id = ?']; let params = [req.user.id];
    if (status) { where.push('ab.status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM ambulance_bookings ab WHERE ${whereClause}`, params);
    const [rows] = await pool.query(`SELECT ab.*, ac.name as category_name, ap.name as partner_name, ap.mobile as partner_mobile, ap.vehicle_number FROM ambulance_bookings ab JOIN ambulance_categories ac ON ab.category_id = ac.id LEFT JOIN ambulance_partners ap ON ab.partner_id = ap.id WHERE ${whereClause} ORDER BY ab.created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);

    return res.status(200).json({ message: 'Bookings fetched.', data: rows.map(b => ({ booking_id: b.booking_id, status: b.status, category: b.category_name, pickup_address: b.pickup_address, drop_address: b.drop_address, distance_km: b.distance_km, total_fare: b.total_fare, payment_method: b.payment_method, payment_status: b.payment_status, partner: b.partner_id ? { name: b.partner_name, mobile: b.partner_mobile, vehicle_number: b.vehicle_number } : null, created_at: b.created_at })), pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/user/ambulance-booking/:booking_id
 */
const getBookingDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT ab.*, ac.name as category_name, ap.uuid as partner_uuid, ap.name as partner_name, ap.mobile as partner_mobile, ap.profile_photo as partner_photo, ap.vehicle_number, ap.latitude as partner_lat, ap.longitude as partner_lng, ap.average_rating as partner_rating FROM ambulance_bookings ab JOIN ambulance_categories ac ON ab.category_id = ac.id LEFT JOIN ambulance_partners ap ON ab.partner_id = ap.id WHERE ab.booking_id = ? AND ab.user_id = ?`, [req.params.booking_id, req.user.id]);
    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });
    const b = rows[0];
    return res.status(200).json({ message: 'Booking detail fetched.', data: { booking_id: b.booking_id, status: b.status, category: b.category_name, pickup: { lat: b.pickup_latitude, lng: b.pickup_longitude, address: b.pickup_address }, drop: { lat: b.drop_latitude, lng: b.drop_longitude, address: b.drop_address }, trip: { distance_km: b.distance_km, estimated_minutes: b.estimated_time_minutes }, fare: { base_charge: b.base_charge, per_km_charge: b.per_km_charge, total: b.total_fare }, payment: { method: b.payment_method, status: b.payment_status, transaction_id: b.transaction_id, paid_at: b.paid_at }, patient: { name: b.patient_name, condition: b.patient_condition, emergency_contact: b.emergency_contact }, partner: b.partner_id ? { id: b.partner_uuid, name: b.partner_name, mobile: b.partner_mobile, photo: b.partner_photo, vehicle_number: b.vehicle_number, live_location: { lat: b.partner_lat, lng: b.partner_lng }, rating: b.partner_rating } : null, timeline: { created_at: b.created_at, accepted_at: b.accepted_at, arrived_at: b.arrived_at, started_at: b.started_at, completed_at: b.completed_at, cancelled_at: b.cancelled_at }, rating: { user_rating: b.user_rating, user_review: b.user_review } } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * POST /api/v1/user/ambulance-booking/:booking_id/cancel
 * Body: { reason }
 */
const cancelBooking = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, status FROM ambulance_bookings WHERE booking_id = ? AND user_id = ?", [req.params.booking_id, req.user.id]);
    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });
    if (!['searching', 'pending', 'accepted'].includes(rows[0].status)) return res.status(400).json({ message: `Cannot cancel. Current status: ${rows[0].status}` });
    await pool.query("UPDATE ambulance_bookings SET status = 'cancelled', cancellation_reason = ?, cancelled_by = 'user', cancelled_at = NOW() WHERE id = ?", [req.body.reason || null, rows[0].id]);
    return res.status(200).json({ message: 'Booking cancelled.' });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = { getCategories, searchAmbulance, bookAmbulance, getBookings, getBookingDetail, cancelBooking };
