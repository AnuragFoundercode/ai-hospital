const { pool } = require('../../config/database');
const notificationService = require('../../services/notification.service');
const { notify } = require('../../services/notify');

// ─────────────────────────────────────────────
// LAB BOOKING CONTROLLER - Accept/Reject bookings
// ─────────────────────────────────────────────

/**
 * GET /api/v1/lab/bookings?status=confirmed|completed|cancelled&page=1&limit=10
 * Get all bookings for this lab
 */
const getBookings = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { status, page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ["b.service_type = 'pathology_test'", 'b.provider_id = ?'];
    let params = [labId];

    if (status) {
      where.push('b.status = ?');
      params.push(status);
    }

    const whereClause = where.join(' AND ');

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM bookings b WHERE ${whereClause}`, params);

    const [rows] = await pool.query(
      `SELECT b.booking_id, b.booking_date, b.status, b.payment_status, b.final_amount, b.metadata, b.user_notes, b.created_at,
              u.full_name as user_name, u.mobile as user_mobile, u.gender as user_gender, u.profile_photo as user_photo, u.date_of_birth as user_dob
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       WHERE ${whereClause}
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const bookings = rows.map((b) => {
      const metadata = typeof b.metadata === 'string' ? JSON.parse(b.metadata) : (b.metadata || {});
      // Calculate age
      let age = null;
      if (b.user_dob) {
        const today = new Date();
        const dob = new Date(b.user_dob);
        age = today.getFullYear() - dob.getFullYear();
      }
      return {
        booking_id: b.booking_id,
        date: b.booking_date,
        status: b.status,
        payment_status: b.payment_status,
        amount: b.final_amount,
        collection_type: metadata.collection_type,
        tests: metadata.tests || [],
        user: { name: b.user_name, mobile: b.user_mobile, gender: b.user_gender, photo: b.user_photo, age },
        user_notes: b.user_notes,
        created_at: b.created_at,
      };
    });

    return res.status(200).json({      message: 'Bookings fetched.',
      data: bookings,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('lab getBookings error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/lab/booking/:booking_id/accept
 * Accept a booking - notify user
 */
const acceptBooking = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { booking_id } = req.params;

    // Find booking
    const [rows] = await pool.query(
      "SELECT * FROM bookings WHERE booking_id = ? AND provider_id = ? AND service_type = 'pathology_test'",
      [booking_id, labId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const booking = rows[0];

    if (booking.status !== 'confirmed' && booking.status !== 'pending') {
      return res.status(400).json({ message: `Cannot accept booking in '${booking.status}' status.` });
    }

    // Update status
    await pool.query(
      "UPDATE bookings SET status = 'assigned', started_at = NOW() WHERE id = ?",
      [booking.id]
    );

    // Status history
    await pool.query(
      "INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_type, changed_by_id, remarks) VALUES (?, ?, 'assigned', 'provider', ?, 'Accepted by lab')",
      [booking.id, booking.status, labId]
    );

    const metadata = typeof booking.metadata === 'string' ? JSON.parse(booking.metadata) : (booking.metadata || {});

    await notify('user', booking.user_id, {
      title: 'Lab Test Accepted ✅',
      body: `Your lab test booking with ${metadata.lab_name || 'Lab'} has been accepted. Sample collection will be scheduled soon.`,
      type: 'booking', reference_type: 'booking', reference_id: booking.id, reference_code: booking_id,
      data: { event: 'lab_booking_accepted', booking_id },
    });

    // If home collection → create sample_collection_request for nearby collectors
    if (metadata.collection_type === 'home') {
      try {
        const [labRows] = await pool.query('SELECT latitude, longitude, address_line1, city FROM pathology_labs WHERE id = ?', [labId]);
        const userAddress = metadata.address_id ? (await pool.query('SELECT * FROM user_addresses WHERE id = ?', [metadata.address_id]))[0][0] : null;

        const pickupLat = userAddress ? parseFloat(userAddress.latitude) : (booking.pickup_latitude ? parseFloat(booking.pickup_latitude) : null);
        const pickupLng = userAddress ? parseFloat(userAddress.longitude) : (booking.pickup_longitude ? parseFloat(booking.pickup_longitude) : null);
        const labLat = labRows[0] ? parseFloat(labRows[0].latitude) : null;
        const labLng = labRows[0] ? parseFloat(labRows[0].longitude) : null;

        if (pickupLat && pickupLng && labLat && labLng) {
          // Haversine distance
          const R = 6371;
          const dLat = (labLat - pickupLat) * Math.PI / 180;
          const dLon = (labLng - pickupLng) * Math.PI / 180;
          const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(pickupLat*Math.PI/180)*Math.cos(labLat*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
          const distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

          const [configRows] = await pool.query("SELECT config_value FROM admin_config WHERE config_key = 'sample_collection_per_km_charge'");
          const perKmCharge = configRows.length ? parseFloat(configRows[0].config_value) : 15;
          const collectionEarning = parseFloat((distanceKm * perKmCharge).toFixed(2));
          const requestId = `SCR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

          const pickupAddress = userAddress ? `${userAddress.address_line1}, ${userAddress.city}` : 'User address';
          const labAddress = `${labRows[0].address_line1}, ${labRows[0].city}`;

          await pool.query(
            "INSERT INTO sample_collection_requests (request_id, booking_id, lab_id, pickup_address, pickup_latitude, pickup_longitude, lab_address, lab_latitude, lab_longitude, distance_km, per_km_charge, collection_earning, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'searching')",
            [requestId, booking.id, labId, pickupAddress, pickupLat, pickupLng, labAddress, labLat, labLng, distanceKm.toFixed(2), perKmCharge, collectionEarning]
          );

          // Notify nearby collectors via SSE
          const { sendToClient } = require('../../events/sse');
          const [radiusConfig] = await pool.query("SELECT config_value FROM admin_config WHERE config_key = 'sample_collection_search_radius_km'");
          const searchRadius = radiusConfig.length ? parseFloat(radiusConfig[0].config_value) : 10;
          const [nearbyCollectors] = await pool.query(
            "SELECT id, fcm_token FROM sample_collectors WHERE is_online = 1 AND is_active = 1 AND verification_status = 'approved' AND latitude IS NOT NULL AND (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude)))) <= ?",
            [pickupLat, pickupLng, pickupLat, searchRadius]
          );

          for (const sc of nearbyCollectors) {
            sendToClient(`collector_${sc.id}`, 'new_collection_request', { request_id: requestId, pickup_address: pickupAddress, distance_km: distanceKm.toFixed(2), earning: collectionEarning });
            await notify('sample_collector', sc.id, {
              title: 'New Sample Collection 🧪',
              body: `₹${collectionEarning} | ${distanceKm.toFixed(1)} km`,
              type: 'order', reference_type: 'collection_request', reference_id: null, reference_code: requestId,
              data: { event: 'new_collection', request_id: requestId },
              fcmToken: sc.fcm_token,
            });
          }
        }
      } catch (collErr) { console.error('Sample collection request error:', collErr.message); }
    }

    return res.status(200).json({      message: 'Booking accepted. User notified.',
      data: { booking_id, status: 'assigned' },
    });
  } catch (error) {
    console.error('lab acceptBooking error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/lab/booking/:booking_id/reject
 * Reject a booking - notify user, initiate refund
 * Body: { reason }
 */
const rejectBooking = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { booking_id } = req.params;
    const { reason } = req.body;

    const [rows] = await pool.query(
      "SELECT * FROM bookings WHERE booking_id = ? AND provider_id = ? AND service_type = 'pathology_test'",
      [booking_id, labId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const booking = rows[0];

    if (booking.status === 'completed' || booking.status === 'cancelled') {
      return res.status(400).json({ message: `Cannot reject booking in '${booking.status}' status.` });
    }

    // Update status
    await pool.query(
      "UPDATE bookings SET status = 'cancelled', cancelled_by = 'provider', cancellation_reason = ?, cancelled_at = NOW() WHERE id = ?",
      [reason || 'Rejected by lab', booking.id]
    );

    // Status history
    await pool.query(
      "INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_type, changed_by_id, remarks) VALUES (?, ?, 'cancelled', 'provider', ?, ?)",
      [booking.id, booking.status, labId, reason || 'Rejected by lab']
    );

    // Update payment status to refund_initiated if paid
    if (booking.payment_status === 'paid') {
      await pool.query("UPDATE bookings SET payment_status = 'refund_initiated' WHERE id = ?", [booking.id]);
    }

    const metadata = typeof booking.metadata === 'string' ? JSON.parse(booking.metadata) : (booking.metadata || {});

    await notify('user', booking.user_id, {
      title: 'Lab Test Rejected ❌',
      body: `Your lab test booking has been rejected. Reason: ${reason || 'Not available'}. Refund will be processed.`,
      type: 'booking', reference_type: 'booking', reference_id: booking.id, reference_code: booking_id,
      data: { event: 'lab_booking_rejected', booking_id },
    });

    return res.status(200).json({      message: 'Booking rejected. User notified.',
      data: { booking_id, status: 'cancelled', reason: reason || 'Rejected by lab' },
    });
  } catch (error) {
    console.error('lab rejectBooking error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/lab/booking/:booking_id/processing
 * Sample collected, test is now being processed
 */
const startProcessing = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { booking_id } = req.params;

    const [rows] = await pool.query(
      "SELECT * FROM bookings WHERE booking_id = ? AND provider_id = ? AND service_type = 'pathology_test'",
      [booking_id, labId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const booking = rows[0];

    if (booking.status !== 'assigned') {
      return res.status(400).json({ message: `Cannot start processing in '${booking.status}' status. Accept booking first.` });
    }

    await pool.query("UPDATE bookings SET status = 'in_progress' WHERE id = ?", [booking.id]);

    await pool.query(
      "INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_type, changed_by_id, remarks) VALUES (?, 'assigned', 'in_progress', 'provider', ?, 'Sample collected, test processing')",
      [booking.id, labId]
    );

    await notify('user', booking.user_id, {
      title: 'Test In Progress 🔬',
      body: 'Your sample has been collected. Test is being processed.',
      type: 'booking', reference_type: 'booking', reference_id: booking.id, reference_code: booking_id,
      data: { event: 'lab_test_processing', booking_id },
    });

    return res.status(200).json({      message: 'Test processing started. User notified.',
      data: { booking_id, status: 'in_progress' },
    });
  } catch (error) {
    console.error('lab startProcessing error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/lab/booking/:booking_id/complete
 * Mark test as completed - credits lab wallet
 */
const completeBooking = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { booking_id } = req.params;

    const [rows] = await pool.query(
      "SELECT * FROM bookings WHERE booking_id = ? AND provider_id = ? AND service_type = 'pathology_test'",
      [booking_id, labId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const booking = rows[0];

    if (booking.status === 'completed') {
      return res.status(400).json({ message: 'Already completed.' });
    }

    // Update status
    await pool.query("UPDATE bookings SET status = 'completed', completed_at = NOW() WHERE id = ?", [booking.id]);

    // Credit lab wallet
    if (booking.payment_status === 'paid') {
      const walletModel = require('../../models/lab/wallet.model');
      await walletModel.credit(labId, parseFloat(booking.final_amount), `Test fee - ${booking.booking_id}`, 'test_fee', booking.id);
    }

    await notify('user', booking.user_id, {
      title: 'Lab Report Ready 📋',
      body: 'Your lab test is completed. Report will be available soon.',
      type: 'report', reference_type: 'booking', reference_id: booking.id, reference_code: booking_id,
      data: { event: 'lab_test_completed', booking_id },
    });

    return res.status(200).json({      message: 'Test completed. Amount credited to wallet.',
      data: { booking_id, status: 'completed' },
    });
  } catch (error) {
    console.error('lab completeBooking error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/lab/booking/:booking_id/upload-report
 * Upload test report (Cloudinary URLs)
 * Body: { reports: ["url1", "url2"] }
 */
const uploadReport = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { booking_id } = req.params;
    const { reports } = req.body;

    if (!reports || !reports.length) {
      return res.status(400).json({ message: 'At least one report URL required.' });
    }

    const [rows] = await pool.query(
      "SELECT * FROM bookings WHERE booking_id = ? AND provider_id = ? AND service_type = 'pathology_test'",
      [booking_id, labId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const booking = rows[0];
    const metadata = typeof booking.metadata === 'string' ? JSON.parse(booking.metadata) : (booking.metadata || {});

    // Add reports to metadata (append to existing if any)
    if (!metadata.reports) metadata.reports = [];
    metadata.reports = [...metadata.reports, ...reports];

    await pool.query('UPDATE bookings SET metadata = ? WHERE id = ?', [JSON.stringify(metadata), booking.id]);

    await notify('user', booking.user_id, {
      title: 'Test Report Uploaded 📄',
      body: `Your lab test report for booking ${booking_id} is now available. Please check.`,
      type: 'report', reference_type: 'booking', reference_id: booking.id, reference_code: booking_id,
      data: { event: 'lab_report_uploaded', booking_id },
    });

    return res.status(200).json({      message: 'Report uploaded. User notified.',
      data: { booking_id, reports: metadata.reports },
    });
  } catch (error) {
    console.error('lab uploadReport error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/lab/booking/:booking_id
 * Full booking detail for lab
 */
const getBookingDetail = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { booking_id } = req.params;

    const [rows] = await pool.query(
      `SELECT b.*, u.full_name as user_name, u.mobile as user_mobile, u.email as user_email, u.gender as user_gender, u.date_of_birth as user_dob, u.blood_group as user_blood_group, u.profile_photo as user_photo
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       WHERE b.booking_id = ? AND b.provider_id = ? AND b.service_type = 'pathology_test'`,
      [booking_id, labId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const b = rows[0];
    const metadata = typeof b.metadata === 'string' ? JSON.parse(b.metadata) : (b.metadata || {});

    // Calculate age
    let age = null;
    if (b.user_dob) {
      const today = new Date();
      const dob = new Date(b.user_dob);
      age = today.getFullYear() - dob.getFullYear();
    }

    // Get status timeline
    const [timeline] = await pool.query(
      'SELECT from_status, to_status, changed_by_type, remarks, created_at FROM booking_status_history WHERE booking_id = ? ORDER BY created_at ASC',
      [b.id]
    );

    return res.status(200).json({
      message: 'Booking detail fetched.',
      data: {
        booking_id: b.booking_id,
        status: b.status,
        patient: {
          name: b.user_name,
          mobile: b.user_mobile,
          email: b.user_email,
          gender: b.user_gender,
          age,
          blood_group: b.user_blood_group,
          profile_photo: b.user_photo,
        },
        booking_info: {
          date: b.booking_date,
          collection_type: metadata.collection_type || 'home',
          user_notes: b.user_notes,
          created_at: b.created_at,
          confirmed_at: b.confirmed_at,
          started_at: b.started_at,
          completed_at: b.completed_at,
          cancelled_at: b.cancelled_at,
          cancellation_reason: b.cancellation_reason,
        },
        prescription: {
          attachments: metadata.attachments || [],
        },
        tests: metadata.tests || [],
        reports: metadata.reports || [],
        internal_notes: b.provider_notes,
        payment: {
          status: b.payment_status,
          method: b.payment_method,
          base_amount: b.base_amount,
          discount: b.discount_amount,
          tax: b.tax_amount,
          total: b.final_amount,
          transaction_id: b.transaction_id,
          paid_at: b.paid_at,
        },
        rating: {
          user_rating: b.user_rating,
          user_review: b.user_review,
        },
        timeline: timeline.map((t) => ({
          from: t.from_status,
          to: t.to_status,
          by: t.changed_by_type,
          remarks: t.remarks,
          at: t.created_at,
        })),
      },
    });
  } catch (error) {
    console.error('lab getBookingDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/lab/booking/:booking_id/notes
 * Add internal notes
 * Body: { notes }
 */
const updateNotes = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { booking_id } = req.params;
    const { notes } = req.body;

    const [rows] = await pool.query(
      "SELECT id FROM bookings WHERE booking_id = ? AND provider_id = ? AND service_type = 'pathology_test'",
      [booking_id, labId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    await pool.query('UPDATE bookings SET provider_notes = ? WHERE id = ?', [notes, rows[0].id]);

    return res.status(200).json({ message: 'Notes updated.', data: { booking_id, notes } });
  } catch (error) {
    console.error('lab updateNotes error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getBookings,
  getBookingDetail,
  updateNotes,
  acceptBooking,
  rejectBooking,
  startProcessing,
  completeBooking,
  uploadReport,
};
