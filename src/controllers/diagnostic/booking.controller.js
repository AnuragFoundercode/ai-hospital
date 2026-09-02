const { pool } = require('../../config/database');
const notificationService = require('../../services/notification.service');
const { sendToClient } = require('../../events/sse');
const walletController = require('./wallet.controller');

// ─────────────────────────────────────────────
// DIAGNOSTIC BOOKING CONTROLLER
// ─────────────────────────────────────────────

/**
 * GET /api/v1/diagnostic/bookings?status=&page=1&limit=10
 */
const getBookings = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { status, page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ["b.service_type = 'diagnostic_scan'", 'b.provider_id = ?'];
    let params = [centerId];

    if (status) { where.push('b.status = ?'); params.push(status); }

    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM bookings b WHERE ${whereClause}`, params);

    const [rows] = await pool.query(
      `SELECT b.booking_id, b.booking_date, b.slot_start_time, b.slot_end_time, b.status, b.payment_status, b.final_amount, b.metadata, b.user_notes, b.completed_at, b.created_at,
              u.full_name as user_name, u.mobile as user_mobile
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       WHERE ${whereClause}
       ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const bookings = rows.map((b) => {
      const metadata = typeof b.metadata === 'string' ? JSON.parse(b.metadata) : (b.metadata || {});
      return {
        booking_id: b.booking_id,
        patient_name: metadata.patient?.name || b.user_name,
        patient_mobile: metadata.patient?.mobile || b.user_mobile,
        scan_name: metadata.service_name,
        date: b.booking_date,
        slot_time: b.slot_start_time,
        slot_end_time: b.slot_end_time,
        completed_on: b.completed_at,
        status: b.status,
        payment_status: b.payment_status,
        amount: b.final_amount,
      };
    });

    return res.status(200).json({
      message: 'Bookings fetched.',
      data: bookings,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('diagnostic getBookings error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/diagnostic/booking/:booking_id
 * Full booking detail
 */
const getBookingDetail = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { booking_id } = req.params;

    const [rows] = await pool.query(
      `SELECT b.*, u.full_name as user_name, u.mobile as user_mobile, u.email as user_email, u.gender as user_gender, u.date_of_birth as user_dob, u.profile_photo as user_photo
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       WHERE b.booking_id = ? AND b.provider_id = ? AND b.service_type = 'diagnostic_scan'`,
      [booking_id, centerId]
    );

    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });

    const b = rows[0];
    const metadata = typeof b.metadata === 'string' ? JSON.parse(b.metadata) : (b.metadata || {});

    // Get user address if available
    let userAddress = null;
    if (b.delivery_address_id) {
      const [addrRows] = await pool.query('SELECT * FROM user_addresses WHERE id = ?', [b.delivery_address_id]);
      if (addrRows.length) userAddress = { name: addrRows[0].name, mobile: addrRows[0].mobile, address: addrRows[0].address_line1, address_line2: addrRows[0].address_line2, landmark: addrRows[0].landmark, city: addrRows[0].city, state: addrRows[0].state, pincode: addrRows[0].pincode };
    }

    // Timeline
    const [timeline] = await pool.query(
      'SELECT from_status, to_status, changed_by_type, remarks, created_at FROM booking_status_history WHERE booking_id = ? ORDER BY created_at ASC',
      [b.id]
    );

    // Get service details from pricing table
    let serviceDetail = null;
    if (metadata.service_pricing_id) {
      const [svcRows] = await pool.query(
        `SELECT dsp.price, dsp.discount_percent, dsp.duration_minutes, dsp.booking_type, ds.name as service_name, ds.description, ds.is_fasting_required, ds.is_contrast_required, ds.report_delivery_hours, ds.patient_instructions, dc.name as category_name
         FROM diagnostic_service_pricing dsp
         JOIN diagnostic_services ds ON dsp.service_id = ds.id
         LEFT JOIN diagnostic_categories dc ON ds.category_id = dc.id
         WHERE dsp.id = ?`,
        [metadata.service_pricing_id]
      );
      if (svcRows.length) serviceDetail = svcRows[0];
    }

    // Build clean response
    const data = {
      booking_id: b.booking_id,
      status: b.status,
      booking_date: b.booking_date,
      patient: {
        name: metadata.patient?.name || b.user_name,
        mobile: metadata.patient?.mobile || b.user_mobile,
        email: metadata.patient?.email || b.user_email,
        age: metadata.patient?.age || null,
        gender: metadata.patient?.gender || b.user_gender,
        dob: b.user_dob,
        profile_photo: b.user_photo,
      },
      service: {
        service_pricing_id: metadata.service_pricing_id,
        service_name: serviceDetail?.service_name || metadata.service_name,
        category: serviceDetail?.category_name || null,
        booking_type: serviceDetail?.booking_type || metadata.booking_type,
        duration_minutes: serviceDetail?.duration_minutes || null,
        is_fasting_required: serviceDetail?.is_fasting_required || 0,
        is_contrast_required: serviceDetail?.is_contrast_required || 0,
        report_delivery_hours: serviceDetail?.report_delivery_hours || null,
        patient_instructions: serviceDetail?.patient_instructions || null,
      },
      schedule: {
        date: b.booking_date,
        slot_start_time: b.slot_start_time,
        slot_end_time: b.slot_end_time,
      },
      pricing: {
        base_amount: b.base_amount,
        discount_amount: b.discount_amount,
        tax_amount: b.tax_amount,
        final_amount: b.final_amount,
      },
      payment: {
        status: b.payment_status,
        method: b.payment_method,
        transaction_id: b.transaction_id,
        paid_at: b.paid_at,
      },
      timestamps: {
        created_at: b.created_at,
        confirmed_at: b.confirmed_at,
        started_at: b.started_at,
        completed_at: b.completed_at,
        cancelled_at: b.cancelled_at,
      },
    };

    // Add optional fields only if they have data
    if (userAddress) data.address = userAddress;
    if (metadata.prescription) data.prescription = metadata.prescription;
    if (b.user_notes) data.remark = b.user_notes;
    if (b.provider_notes) data.provider_notes = b.provider_notes;
    if (metadata.reports && metadata.reports.length) data.reports = metadata.reports;
    if (b.user_rating) data.rating = { user_rating: b.user_rating, user_review: b.user_review, rated_at: b.rated_at };
    if (b.cancellation_reason) data.cancellation_reason = b.cancellation_reason;
    if (timeline.length) data.timeline = timeline.map((t) => ({ from: t.from_status, to: t.to_status, by: t.changed_by_type, remarks: t.remarks, at: t.created_at }));

    return res.status(200).json({ message: 'Booking detail fetched.', data });
  } catch (error) {
    console.error('diagnostic getBookingDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/diagnostic/booking/:booking_id/accept
 */
const acceptBooking = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { booking_id } = req.params;

    const [rows] = await pool.query("SELECT * FROM bookings WHERE booking_id = ? AND provider_id = ? AND service_type = 'diagnostic_scan'", [booking_id, centerId]);
    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });

    const booking = rows[0];
    if (!['pending', 'confirmed'].includes(booking.status)) return res.status(400).json({ message: `Cannot accept in '${booking.status}' status.` });

    await pool.query("UPDATE bookings SET status = 'confirmed', confirmed_at = NOW() WHERE id = ?", [booking.id]);
    await pool.query("INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_type, changed_by_id, remarks) VALUES (?, ?, 'confirmed', 'provider', ?, 'Accepted')", [booking.id, booking.status, centerId]);

    // Notify user
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [booking.user_id]);
    if (userRows[0]?.fcm_token) {
      await notificationService.sendToDevice(userRows[0].fcm_token, 'Booking Confirmed ✅', 'Your diagnostic appointment has been confirmed.', { type: 'diagnostic_confirmed', booking_id });
    }

    return res.status(200).json({ message: 'Booking accepted.', data: { booking_id, status: 'confirmed' } });
  } catch (error) {
    console.error('diagnostic acceptBooking error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/diagnostic/booking/:booking_id/reject
 * Body: { reason }
 */
const rejectBooking = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { booking_id } = req.params;
    const { reason } = req.body;

    const [rows] = await pool.query("SELECT * FROM bookings WHERE booking_id = ? AND provider_id = ? AND service_type = 'diagnostic_scan'", [booking_id, centerId]);
    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });

    const booking = rows[0];
    await pool.query("UPDATE bookings SET status = 'cancelled', cancelled_by = 'provider', cancellation_reason = ?, cancelled_at = NOW() WHERE id = ?", [reason || 'Rejected', booking.id]);
    await pool.query("INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_type, changed_by_id, remarks) VALUES (?, ?, 'cancelled', 'provider', ?, ?)", [booking.id, booking.status, centerId, reason || 'Rejected']);

    if (booking.payment_status === 'paid') {
      await pool.query("UPDATE bookings SET payment_status = 'refund_initiated' WHERE id = ?", [booking.id]);
    }

    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [booking.user_id]);
    if (userRows[0]?.fcm_token) {
      await notificationService.sendToDevice(userRows[0].fcm_token, 'Booking Rejected ❌', `Your diagnostic booking was rejected. Reason: ${reason || 'Unavailable'}`, { type: 'diagnostic_rejected', booking_id });
    }

    return res.status(200).json({ message: 'Booking rejected.', data: { booking_id, status: 'cancelled' } });
  } catch (error) {
    console.error('diagnostic rejectBooking error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/diagnostic/booking/:booking_id/status
 * Body: { status } → confirmed, patient_arrived, scan_started, scan_completed, report_uploaded, completed
 */
const updateStatus = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { booking_id } = req.params;
    const { status } = req.body;

    const validStatuses = ['confirmed', 'patient_arrived', 'scan_started', 'scan_completed', 'report_uploaded', 'completed'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ message: `Valid statuses: ${validStatuses.join(', ')}` });
    }

    const [rows] = await pool.query("SELECT * FROM bookings WHERE booking_id = ? AND provider_id = ? AND service_type = 'diagnostic_scan'", [booking_id, centerId]);
    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });

    const booking = rows[0];

    // Prevent no-op / duplicate same-status updates
    if (booking.status === status) {
      return res.status(400).json({ message: `Booking is already '${status}'.` });
    }

    // Store the ACTUAL status (no mapping) — single status field manages everything
    const updateFields = ['status = ?'];
    const updateValues = [status];
    if (status === 'patient_arrived') { updateFields.push('started_at = NOW()'); }
    if (status === 'completed') { updateFields.push('completed_at = NOW()'); }

    await pool.query(`UPDATE bookings SET ${updateFields.join(', ')} WHERE id = ?`, [...updateValues, booking.id]);
    await pool.query("INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_type, changed_by_id, remarks) VALUES (?, ?, ?, 'provider', ?, ?)", [booking.id, booking.status, status, centerId, `Status updated to ${status}`]);

    // Credit wallet on complete
    if (status === 'completed') {
      const paymentType = booking.payment_method === 'cod' ? 'offline' : 'online';
      await walletController.creditAfterComplete(centerId, booking.id, parseFloat(booking.final_amount), paymentType);
    }

    // Notify user on key status changes
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [booking.user_id]);
    if (userRows[0]?.fcm_token) {
      const messages = {
        scan_started: 'Your scan has started.',
        scan_completed: 'Your scan is completed. Report will be uploaded soon.',
        report_uploaded: 'Your report has been uploaded.',
        completed: 'Your diagnostic appointment is completed.',
      };
      if (messages[status]) {
        await notificationService.sendToDevice(userRows[0].fcm_token, 'Status Update 📋', messages[status], { type: 'diagnostic_status', booking_id, status });
      }
    }

    return res.status(200).json({ message: `Status updated to ${status}.`, data: { booking_id, status } });
  } catch (error) {
    console.error('diagnostic updateStatus error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/diagnostic/booking/:booking_id/upload-report
 * Body: { reports: ["url1", "url2"], report_notes }
 */
const uploadReport = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { booking_id } = req.params;
    const { reports, report_notes } = req.body;

    if (!reports || !reports.length) return res.status(400).json({ message: 'At least one report URL required.' });

    const [rows] = await pool.query("SELECT * FROM bookings WHERE booking_id = ? AND provider_id = ? AND service_type = 'diagnostic_scan'", [booking_id, centerId]);
    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });

    const booking = rows[0];
    const metadata = typeof booking.metadata === 'string' ? JSON.parse(booking.metadata) : (booking.metadata || {});

    if (!metadata.reports) metadata.reports = [];
    metadata.reports = [...metadata.reports, ...reports];
    if (report_notes) metadata.report_notes = report_notes;

    await pool.query('UPDATE bookings SET metadata = ? WHERE id = ?', [JSON.stringify(metadata), booking.id]);
    await pool.query("INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_type, changed_by_id, remarks) VALUES (?, ?, 'report_uploaded', 'provider', ?, 'Report uploaded')", [booking.id, booking.status, centerId]);

    // Notify user
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [booking.user_id]);
    if (userRows[0]?.fcm_token) {
      await notificationService.sendToDevice(userRows[0].fcm_token, 'Report Uploaded 📄', `Your diagnostic report for ${booking_id} is ready.`, { type: 'diagnostic_report', booking_id });
    }

    return res.status(200).json({ message: 'Report uploaded. User notified.', data: { booking_id, reports: metadata.reports } });
  } catch (error) {
    console.error('diagnostic uploadReport error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getBookings,
  getBookingDetail,
  acceptBooking,
  rejectBooking,
  updateStatus,
  uploadReport,
};
