const { pool } = require('../../config/database');
const notificationService = require('../../services/notification.service');

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
      const metadata = b.metadata ? JSON.parse(b.metadata) : {};
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

    // Send notification to user
    const [userRows] = await pool.query('SELECT fcm_token, full_name FROM users WHERE id = ?', [booking.user_id]);
    const user = userRows[0];
    const metadata = booking.metadata ? JSON.parse(booking.metadata) : {};

    if (user && user.fcm_token) {
      await notificationService.sendToDevice(
        user.fcm_token,
        'Lab Test Accepted ✅',
        `Your lab test booking with ${metadata.lab_name || 'Lab'} has been accepted. Sample collection will be scheduled soon.`,
        { type: 'lab_booking_accepted', booking_id }
      );
    }

    // Save notification in DB
    await pool.query(
      "INSERT INTO notifications (recipient_type, recipient_id, title, body, type, reference_type, reference_id, sent_via) VALUES ('user', ?, 'Lab Test Accepted ✅', ?, 'booking', 'booking', ?, ?)",
      [booking.user_id, `Your lab test booking has been accepted by ${metadata.lab_name || 'Lab'}.`, booking.id, user?.fcm_token ? 'push' : 'sms']
    );

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

    // Notify user
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [booking.user_id]);
    const user = userRows[0];
    const metadata = booking.metadata ? JSON.parse(booking.metadata) : {};

    if (user && user.fcm_token) {
      await notificationService.sendToDevice(
        user.fcm_token,
        'Lab Test Rejected ❌',
        `Your lab test booking has been rejected. Reason: ${reason || 'Not available'}. Refund will be processed.`,
        { type: 'lab_booking_rejected', booking_id }
      );
    }

    await pool.query(
      "INSERT INTO notifications (recipient_type, recipient_id, title, body, type, reference_type, reference_id, sent_via) VALUES ('user', ?, 'Lab Test Rejected ❌', ?, 'booking', 'booking', ?, ?)",
      [booking.user_id, `Your lab test was rejected. Reason: ${reason || 'Not available'}. Refund will be processed.`, booking.id, user?.fcm_token ? 'push' : 'sms']
    );

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

    // Notify user
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [booking.user_id]);
    const user = userRows[0];

    if (user && user.fcm_token) {
      await notificationService.sendToDevice(
        user.fcm_token,
        'Test In Progress 🔬',
        'Your sample has been collected. Test is being processed.',
        { type: 'lab_test_processing', booking_id }
      );
    }

    await pool.query(
      "INSERT INTO notifications (recipient_type, recipient_id, title, body, type, reference_type, reference_id, sent_via) VALUES ('user', ?, 'Test In Progress 🔬', 'Your sample has been collected. Test is being processed.', 'booking', 'booking', ?, ?)",
      [booking.user_id, booking.id, user?.fcm_token ? 'push' : 'sms']
    );

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

    // Notify user
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [booking.user_id]);
    const user = userRows[0];

    if (user && user.fcm_token) {
      await notificationService.sendToDevice(
        user.fcm_token,
        'Lab Report Ready 📋',
        'Your lab test is completed. Report will be available soon.',
        { type: 'lab_test_completed', booking_id }
      );
    }

    await pool.query(
      "INSERT INTO notifications (recipient_type, recipient_id, title, body, type, reference_type, reference_id, sent_via) VALUES ('user', ?, 'Lab Report Ready 📋', 'Your lab test is completed. Report will be available soon.', 'report', 'booking', ?, ?)",
      [booking.user_id, booking.id, user?.fcm_token ? 'push' : 'sms']
    );

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
    const metadata = booking.metadata ? JSON.parse(booking.metadata) : {};

    // Add reports to metadata (append to existing if any)
    if (!metadata.reports) metadata.reports = [];
    metadata.reports = [...metadata.reports, ...reports];

    await pool.query('UPDATE bookings SET metadata = ? WHERE id = ?', [JSON.stringify(metadata), booking.id]);

    // Notify user
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [booking.user_id]);
    const user = userRows[0];

    if (user && user.fcm_token) {
      await notificationService.sendToDevice(
        user.fcm_token,
        'Test Report Uploaded 📄',
        `Your lab test report for booking ${booking_id} is now available. Please check.`,
        { type: 'lab_report_uploaded', booking_id }
      );
    }

    await pool.query(
      "INSERT INTO notifications (recipient_type, recipient_id, title, body, type, reference_type, reference_id, sent_via) VALUES ('user', ?, 'Test Report Uploaded 📄', ?, 'report', 'booking', ?, ?)",
      [booking.user_id, `Your lab test report for booking ${booking_id} is ready.`, booking.id, user?.fcm_token ? 'push' : 'sms']
    );

    return res.status(200).json({      message: 'Report uploaded. User notified.',
      data: { booking_id, reports: metadata.reports },
    });
  } catch (error) {
    console.error('lab uploadReport error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getBookings,
  acceptBooking,
  rejectBooking,
  startProcessing,
  completeBooking,
  uploadReport,
};
