const bookingModel = require('../../models/user/booking.model');
const doctorModel = require('../../models/user/doctor.model');
const labModel = require('../../models/user/lab.model');
const paytmService = require('../../services/paytm.service');
const paytmConfig = require('../../config/paytm');
const bookingNotification = require('../../services/booking.notification');
const { pool } = require('../../config/database');
const { sendToLab, sendToDoctor, sendToClient } = require('../../events/sse');
const distanceService = require('../../services/distance.service');
const { notify } = require('../../services/notify');

/**
 * Notify provider (lab / diagnostic) in real-time of a newly-paid booking.
 * Used by both manual /pay (confirmPayment) and the Paytm callback so both behave the same.
 */
const notifyProviderNewBooking = async (updatedBooking) => {
  try {
    const metadata = typeof updatedBooking.metadata === 'string' ? JSON.parse(updatedBooking.metadata) : (updatedBooking.metadata || {});
    if (updatedBooking.service_type === 'pathology_test') {
      // SSE (real-time in-app)
      sendToLab(updatedBooking.provider_id, 'new_booking', {
        booking_id: updatedBooking.booking_id,
        date: updatedBooking.booking_date,
        amount: updatedBooking.final_amount,
        collection_type: metadata.collection_type,
        tests: metadata.tests || [],
        user_notes: updatedBooking.user_notes,
      });
      // FCM + DB (background/data)
      const testLine = metadata.tests && metadata.tests.length ? metadata.tests.map((t) => t.name || t).join(', ') : 'lab test';
      await notify('pathology_lab', updatedBooking.provider_id, {
        title: 'New Booking 📋', body: `New lab test booking (${testLine}).`,
        type: 'booking', reference_type: 'booking', reference_id: updatedBooking.id,
        data: { event: 'new_booking', booking_id: updatedBooking.booking_id },
      });
    } else if (updatedBooking.service_type === 'diagnostic_scan') {
      sendToClient(`diagnostic_${updatedBooking.provider_id}`, 'new_booking', {
        booking_id: updatedBooking.booking_id,
        date: updatedBooking.booking_date,
        slot_time: updatedBooking.slot_start_time,
        amount: updatedBooking.final_amount,
        service_name: metadata.service_name,
        patient_name: metadata.patient?.name,
        booking_type: metadata.booking_type,
        payment_method: updatedBooking.payment_method || 'online',
      });
      await notify('diagnostic_center', updatedBooking.provider_id, {
        title: 'New Booking 📋', body: `New ${metadata.service_name || 'diagnostic'} booking.`,
        type: 'booking', reference_type: 'booking', reference_id: updatedBooking.id,
        data: { event: 'new_booking', booking_id: updatedBooking.booking_id },
      });
    }
  } catch (e) {
    console.error('notifyProviderNewBooking error:', e.message);
  }
};

// ─────────────────────────────────────────────
// BOOKING CONTROLLER - For patient app
// ─────────────────────────────────────────────

// NOTE: Doctor bookings are now handled as per-minute video calls
// (see src/controllers/doctor/call.controller.js). The old slot+Paytm
// createDoctorBooking flow has been removed.

/**
 * POST /api/v1/user/booking/:booking_id/pay
 * Body: { payment_method, transaction_id }
 * 
 * FLOW:
 * 1. Validate booking exists & belongs to user
 * 2. Check booking is pending & unpaid
 * 3. Update payment status → "paid"
 * 4. Update booking status → "confirmed"
 * 5. Send notification to doctor (future)
 */
const confirmPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { booking_id } = req.params;
    const { payment_method, transaction_id } = req.body;

    if (!payment_method || !transaction_id) {
      return res.status(400).json({        message: 'payment_method and transaction_id required.',
      });
    }

    // Find booking
    const booking = await bookingModel.findByBookingId(booking_id);
    if (!booking) {
      return res.status(404).json({        message: 'Booking not found.',
      });
    }

    // Check ownership
    if (booking.user_id !== userId) {
      return res.status(403).json({        message: 'Not your booking.',
      });
    }

    // Check if already paid
    if (booking.payment_status === 'paid') {
      return res.status(400).json({        message: 'Already paid.',
      });
    }

    // Check status
    if (booking.status !== 'pending') {
      return res.status(400).json({        message: 'Booking cannot be paid in current status.',
      });
    }

    // Update payment
    await bookingModel.updatePayment(booking_id, {
      payment_status: 'paid',
      transaction_id,
      user_id: userId,
    });

    // Add status history
    await bookingModel.addStatusHistory(booking.id, 'pending', 'confirmed', 'user', userId, `Payment done via ${payment_method}`);

    // Send push notifications to user & doctor
    const updatedBooking = await bookingModel.findByBookingId(booking_id);
    await bookingNotification.sendBookingConfirmedNotification(updatedBooking);

    // Real-time SSE + FCM to provider (lab / diagnostic)
    await notifyProviderNewBooking(updatedBooking);

    return res.status(200).json({      message: 'Payment successful. Booking confirmed!',
      data: {
        booking_id,
        status: 'confirmed',
        payment_status: 'paid',
        payment_method,
        transaction_id,
      },
    });
  } catch (error) {
    console.error('confirmPayment error:', error.message);
    return res.status(500).json({      message: 'Something went wrong.',
    });
  }
};

/**
 * GET /api/v1/user/bookings
 * Query: page, limit, status
 * Get user's booking history
 */
const getMyBookings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, status, type } = req.query;

    let allBookings = [];

    // 1. Doctor + Lab + Diagnostic (from bookings table)
    if (!type || ['doctor', 'lab', 'diagnostic'].includes(type)) {
      let bWhere = ['b.user_id = ?'];
      let bParams = [userId];
      if (status) { bWhere.push('b.status = ?'); bParams.push(status); }
      if (type === 'doctor') bWhere.push("b.service_type = 'doctor_consultation'");
      else if (type === 'lab') bWhere.push("b.service_type = 'pathology_test'");
      else if (type === 'diagnostic') bWhere.push("b.service_type = 'diagnostic_scan'");

      const [bRows] = await pool.query(
        `SELECT b.booking_id, b.service_type, b.status, b.final_amount, b.payment_status, b.booking_date, b.slot_start_time, b.created_at FROM bookings b WHERE ${bWhere.join(' AND ')} ORDER BY b.created_at DESC`,
        bParams
      );
      for (const b of bRows) {
        allBookings.push({ booking_id: b.booking_id, service_type: b.service_type, status: b.status, amount: b.final_amount, payment_status: b.payment_status, date: b.booking_date, slot_time: b.slot_start_time, created_at: b.created_at });
      }
    }

    // 2. Pharmacy orders
    if (!type || type === 'pharmacy') {
      let pWhere = ['po.user_id = ?'];
      let pParams = [userId];
      if (status) { pWhere.push('po.status = ?'); pParams.push(status); }

      const [pRows] = await pool.query(
        `SELECT po.order_id, po.status, po.final_amount, po.payment_status, po.created_at, p.name as pharmacy_name FROM pharmacy_orders po JOIN pharmacies p ON po.pharmacy_id = p.id WHERE ${pWhere.join(' AND ')} ORDER BY po.created_at DESC`,
        pParams
      );
      for (const p of pRows) {
        allBookings.push({ booking_id: p.order_id, service_type: 'medicine_order', status: p.status, amount: p.final_amount, payment_status: p.payment_status, date: null, slot_time: null, pharmacy_name: p.pharmacy_name, created_at: p.created_at });
      }
    }

    // 3. Blood requests
    if (!type || type === 'blood') {
      let brWhere = ['br.user_id = ?'];
      let brParams = [userId];
      if (status) { brWhere.push('br.status = ?'); brParams.push(status); }

      const [brRows] = await pool.query(
        `SELECT br.request_id, br.status, br.total_amount, br.payment_status, br.required_date, br.created_at, bb.name as bank_name FROM blood_requests br JOIN blood_banks bb ON br.blood_bank_id = bb.id WHERE ${brWhere.join(' AND ')} ORDER BY br.created_at DESC`,
        brParams
      );
      for (const br of brRows) {
        allBookings.push({ booking_id: br.request_id, service_type: 'blood_request', status: br.status, amount: br.total_amount, payment_status: br.payment_status, date: br.required_date, slot_time: null, bank_name: br.bank_name, created_at: br.created_at });
      }
    }

    // 4. Ambulance bookings
    if (!type || type === 'ambulance') {
      let abWhere = ['ab.user_id = ?'];
      let abParams = [userId];
      if (status) { abWhere.push('ab.status = ?'); abParams.push(status); }

      const [abRows] = await pool.query(
        `SELECT ab.booking_id, ab.status, ab.total_fare, ab.payment_status, ab.patient_name, ab.created_at, asr.name as ambulance_name FROM ambulance_bookings ab LEFT JOIN ambulance_services asr ON ab.partner_id = asr.id WHERE ${abWhere.join(' AND ')} ORDER BY ab.created_at DESC`,
        abParams
      );
      for (const ab of abRows) {
        allBookings.push({ booking_id: ab.booking_id, service_type: 'ambulance', status: ab.status, amount: ab.total_fare, payment_status: ab.payment_status, date: null, slot_time: null, ambulance_name: ab.ambulance_name, created_at: ab.created_at });
      }
    }

    // Sort by latest
    allBookings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Paginate
    const total = allBookings.length;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const paginated = allBookings.slice(offset, offset + parseInt(limit));

    return res.status(200).json({
      message: 'Bookings fetched.',
      data: paginated,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, total_pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('getMyBookings error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/booking/:booking_id
 * Get single booking details
 */
const getBookingDetail = async (req, res) => {
  try {
    const userId = req.user.id;
    const { booking_id } = req.params;

    const booking = await bookingModel.findByBookingId(booking_id);
    if (!booking) {
      return res.status(404).json({        message: 'Booking not found.',
      });
    }

    if (booking.user_id !== userId) {
      return res.status(403).json({        message: 'Not your booking.',
      });
    }

    const metadata = typeof booking.metadata === 'string' ? JSON.parse(booking.metadata) : (booking.metadata || {});

    return res.status(200).json({      message: 'Booking detail fetched.',
      data: {
        booking_id: booking.booking_id,
        service_type: booking.service_type,
        status: booking.status,
        date: booking.booking_date,
        slot_time: booking.slot_start_time,
        slot_end_time: booking.slot_end_time,
        consultation_type: metadata.consultation_type,
        doctor_name: metadata.doctor_name,
        doctor_category: metadata.doctor_category,
        amount: {
          base: booking.base_amount,
          tax: booking.tax_amount,
          discount: booking.discount_amount,
          total: booking.final_amount,
        },
        payment_status: booking.payment_status,
        payment_method: booking.payment_method,
        transaction_id: booking.transaction_id,
        user_notes: booking.user_notes,
        created_at: booking.created_at,
        confirmed_at: booking.confirmed_at,
      },
    });
  } catch (error) {
    console.error('getBookingDetail error:', error.message);
    return res.status(500).json({      message: 'Something went wrong.',
    });
  }
};

/**
 * POST /api/v1/user/booking/paytm/callback
 * Paytm calls this after payment completion
 * Verifies checksum and updates booking status
 */
const paytmCallback = async (req, res) => {
  try {
    const paytmParams = req.body;

    // Verify checksum
    const isValid = paytmService.verifyChecksum(paytmParams);
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid checksum. Payment verification failed.' });
    }

    const orderId = paytmParams.ORDERID;
    const txnStatus = paytmParams.STATUS;
    const txnId = paytmParams.TXNID;
    const paymentMode = paytmParams.PAYMENTMODE;
    const success = txnStatus === 'TXN_SUCCESS';

    if (!orderId) return res.status(400).json({ message: 'ORDERID missing.' });

    // Route by order-id prefix — ONE callback handles wallet / pharmacy order / ambulance / booking.
    // WRC- = wallet recharge, ORD- = pharmacy order, AMB- = ambulance booking, else = generic booking (BK-)
    const prefix = orderId.split('-')[0];

    // ── WALLET RECHARGE ──
    if (prefix === 'WRC') {
      const walletModel = require('../../models/user/wallet.model');
      if (!success) {
        return res.status(200).json({ message: 'Wallet recharge failed.', data: { recharge_id: orderId, status: 'failed' } });
      }
      // Idempotency: don't double-credit
      const [existing] = await pool.query(
        "SELECT id FROM wallet_transactions WHERE reference_type = 'recharge' AND description = ?",
        [`Wallet recharge - ${orderId}`]
      );
      if (existing.length) {
        return res.status(200).json({ message: 'Already credited.', data: { recharge_id: orderId, status: 'paid' } });
      }
      // Get amount + user from Paytm verify (authoritative)
      const verify = await paytmService.verifyTransaction(orderId);
      const vb = verify.body || {};
      if (vb.resultInfo?.resultStatus !== 'TXN_SUCCESS') {
        return res.status(200).json({ message: 'Payment not confirmed.', data: { recharge_id: orderId } });
      }
      const amount = parseFloat(vb.txnAmount || paytmParams.TXNAMOUNT);
      const custId = parseInt(vb.custId || paytmParams.custId);
      if (custId && amount) {
        await walletModel.credit(custId, amount, `Wallet recharge - ${orderId}`, 'recharge', null, 'user');
        // Notify user (wallet credited)
        await notify('user', custId, {
          title: 'Wallet Recharged 💰',
          body: `₹${amount.toFixed(2)} added to your wallet successfully.`,
          type: 'payment', reference_type: 'wallet', reference_id: null,
          data: { event: 'wallet_credited', amount: amount.toFixed(2), recharge_id: orderId },
        });
      }
      return res.status(200).json({ message: 'Wallet credited.', data: { recharge_id: orderId, amount, status: 'paid' } });
    }

    // ── PHARMACY ORDER ──
    if (prefix === 'ORD') {
      const [rows] = await pool.query('SELECT id, user_id, payment_status FROM pharmacy_orders WHERE order_id = ?', [orderId]);
      if (!rows.length) return res.status(404).json({ message: 'Order not found.' });
      if (rows[0].payment_status === 'paid') {
        return res.status(200).json({ message: 'Already paid.', data: { order_id: orderId, status: 'paid' } });
      }
      if (!success) {
        return res.status(200).json({ message: 'Payment failed.', data: { order_id: orderId, payment_status: 'unpaid' } });
      }
      await pool.query("UPDATE pharmacy_orders SET payment_status = 'paid', transaction_id = ?, paid_at = NOW() WHERE order_id = ?", [txnId, orderId]);
      // Real-time SSE to pharmacy (payment confirmed)
      const [ord] = await pool.query('SELECT id, user_id, pharmacy_id, total_items, final_amount FROM pharmacy_orders WHERE order_id = ?', [orderId]);
      if (ord.length) {
        sendToClient(`pharmacy_${ord[0].pharmacy_id}`, 'new_order', {
          order_id: orderId, total_items: ord[0].total_items, amount: ord[0].final_amount, payment_method: 'online',
        });
        // Notify user (order confirmed)
        await notify('user', ord[0].user_id, {
          title: 'Order Confirmed 🎉',
          body: 'Your medicine order is confirmed and being processed.',
          type: 'order', reference_type: 'order', reference_id: ord[0].id,
          data: { event: 'order_confirmed', order_id: orderId },
        });
      }
      return res.status(200).json({ message: 'Order payment successful.', data: { order_id: orderId, payment_status: 'paid', transaction_id: txnId } });
    }

    // ── AMBULANCE BOOKING ──
    if (prefix === 'AMB') {
      const [rows] = await pool.query('SELECT id, payment_status FROM ambulance_bookings WHERE booking_id = ?', [orderId]);
      if (!rows.length) return res.status(404).json({ message: 'Ambulance booking not found.' });
      if (rows[0].payment_status === 'paid') {
        return res.status(200).json({ message: 'Already paid.', data: { booking_id: orderId, status: 'paid' } });
      }
      if (!success) {
        return res.status(200).json({ message: 'Payment failed.', data: { booking_id: orderId, payment_status: 'unpaid' } });
      }
      await pool.query("UPDATE ambulance_bookings SET payment_status = 'paid', transaction_id = ?, paid_at = NOW() WHERE booking_id = ?", [txnId, orderId]);
      const [amb] = await pool.query('SELECT id, user_id, partner_id, patient_name, pickup_address, drop_address, total_fare FROM ambulance_bookings WHERE booking_id = ?', [orderId]);
      if (amb.length) {
        // Real-time SSE + FCM to ambulance provider (payment confirmed)
        if (amb[0].partner_id) {
          sendToClient(`ambulance_${amb[0].partner_id}`, 'new_booking', {
            booking_id: orderId, pickup_address: amb[0].pickup_address, drop_address: amb[0].drop_address,
            fare: amb[0].total_fare, patient_name: amb[0].patient_name,
          });
          await notify('ambulance_service', amb[0].partner_id, {
            title: 'New Ambulance Booking 🚑',
            body: `Pickup: ${amb[0].pickup_address}. Fare: ₹${parseFloat(amb[0].total_fare).toFixed(0)}`,
            type: 'booking', reference_type: 'ambulance_booking', reference_id: amb[0].id, reference_code: orderId,
            data: { event: 'new_ambulance_booking', booking_id: orderId },
          });
        }
        // Notify user (ambulance booking confirmed)
        await notify('user', amb[0].user_id, {
          title: 'Ambulance Booking Confirmed 🚑',
          body: 'Your ambulance booking is confirmed.',
          type: 'ambulance', reference_type: 'ambulance', reference_id: amb[0].id,
          data: { event: 'ambulance_confirmed', booking_id: orderId },
        });
      }
      return res.status(200).json({ message: 'Ambulance payment successful.', data: { booking_id: orderId, payment_status: 'paid' } });
    }

    // ── BLOOD REQUEST ──
    if (prefix === 'BR') {
      const [rows] = await pool.query('SELECT id, user_id, blood_bank_id, blood_group, units_required, payment_status FROM blood_requests WHERE request_id = ?', [orderId]);
      if (!rows.length) return res.status(404).json({ message: 'Blood request not found.' });
      if (rows[0].payment_status === 'paid') {
        return res.status(200).json({ message: 'Already paid.', data: { request_id: orderId, status: 'paid' } });
      }
      if (!success) {
        return res.status(200).json({ message: 'Payment failed.', data: { request_id: orderId, payment_status: 'unpaid' } });
      }
      // Mark paid + confirm the request (so the blood bank can process/ready it)
      await pool.query("UPDATE blood_requests SET payment_status = 'paid', status = 'confirmed', transaction_id = ?, paid_at = NOW() WHERE id = ?", [txnId, rows[0].id]);

      const br = rows[0];
      // Real-time SSE + notify to blood bank
      sendToClient(`bloodbank_${br.blood_bank_id}`, 'new_request', {
        request_id: orderId, blood_group: br.blood_group, units_required: br.units_required, payment_method: 'online',
      });
      await notify('blood_bank', br.blood_bank_id, {
        title: 'New Blood Request 🩸', body: `New ${br.blood_group} request (${br.units_required} unit(s)).`,
        type: 'booking', reference_type: 'blood_request', reference_id: br.id,
        data: { event: 'new_blood_request', request_id: orderId },
      });
      // Notify user (payment confirmed)
      await notify('user', br.user_id, {
        title: 'Blood Request Confirmed 🩸', body: 'Payment successful. Your blood request is confirmed.',
        type: 'payment', reference_type: 'blood_request', reference_id: br.id,
        data: { event: 'blood_request_confirmed', request_id: orderId },
      });

      return res.status(200).json({ message: 'Blood request payment successful.', data: { request_id: orderId, payment_status: 'paid', status: 'confirmed' } });
    }

    // ── BOOKING (doctor / lab / diagnostic — BK- or anything else) ──
    const booking = await bookingModel.findByBookingId(orderId);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found.' });
    }
    if (booking.payment_status === 'paid') {
      return res.status(200).json({ message: 'Already paid.', data: { booking_id: orderId, status: 'confirmed' } });
    }

    if (success) {
      await bookingModel.updatePayment(orderId, { payment_status: 'paid', transaction_id: txnId, user_id: booking.user_id });
      await bookingModel.addStatusHistory(booking.id, 'pending', 'confirmed', 'system', null, `Paytm payment success. Mode: ${paymentMode}`);

      const updatedBooking = await bookingModel.findByBookingId(orderId);
      await bookingNotification.sendBookingConfirmedNotification(updatedBooking);
      // Real-time SSE + FCM to provider (lab / diagnostic) — same as manual /pay
      await notifyProviderNewBooking(updatedBooking);

      return res.status(200).json({ message: 'Payment successful. Booking confirmed.', data: { booking_id: orderId, status: 'confirmed', payment_status: 'paid', transaction_id: txnId } });
    }

    await bookingModel.addStatusHistory(booking.id, 'pending', 'pending', 'system', null, `Paytm payment failed: ${txnStatus}`);
    return res.status(200).json({ message: 'Payment failed. Please try again.', data: { booking_id: orderId, status: 'pending', payment_status: 'unpaid', reason: paytmParams.RESPMSG } });
  } catch (error) {
    console.error('paytmCallback error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/user/booking/:booking_id/verify-payment
 * Frontend calls this to verify payment status from Paytm
 */
const verifyPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { booking_id } = req.params;

    const booking = await bookingModel.findByBookingId(booking_id);
    if (!booking || booking.user_id !== userId) {
      return res.status(404).json({        message: 'Booking not found.',
      });
    }

    // Already paid? Return success
    if (booking.payment_status === 'paid') {
      return res.status(200).json({        message: 'Payment already confirmed.',
        data: { booking_id, status: booking.status, payment_status: 'paid' },
      });
    }

    // Verify from Paytm
    const paytmResponse = await paytmService.verifyTransaction(booking_id);

    if (paytmResponse.body && paytmResponse.body.resultInfo) {
      const resultStatus = paytmResponse.body.resultInfo.resultStatus;
      const txnId = paytmResponse.body.txnId;

      if (resultStatus === 'TXN_SUCCESS') {
        await bookingModel.updatePayment(booking_id, {
          payment_status: 'paid',
          transaction_id: txnId,
          user_id: userId,
        });

        await bookingModel.addStatusHistory(booking.id, 'pending', 'confirmed', 'system', null, 'Payment verified via status check');

        return res.status(200).json({          message: 'Payment verified. Booking confirmed.',
          data: { booking_id, status: 'confirmed', payment_status: 'paid', transaction_id: txnId },
        });
      }
    }

    return res.status(200).json({      message: 'Payment not completed yet.',
      data: { booking_id, status: 'pending', payment_status: 'unpaid' },
    });
  } catch (error) {
    console.error('verifyPayment error:', error.message);
    return res.status(500).json({      message: 'Something went wrong.',
    });
  }
};

/**
 * GET /api/v1/user/appointments?type=upcoming|past&page=1&limit=10
 * Appointment history with upcoming/past filter
 */
const getAppointments = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type = 'upcoming', page = 1, limit = 10 } = req.query;

    let result;
    if (type === 'past') {
      result = await bookingModel.getPastAppointments(userId, { page: parseInt(page), limit: parseInt(limit) });
    } else {
      result = await bookingModel.getUpcomingAppointments(userId, { page: parseInt(page), limit: parseInt(limit) });
    }

    const now = new Date();

    const appointments = result.bookings.map((b) => {
      const metadata = typeof b.metadata === 'string' ? JSON.parse(b.metadata) : (b.metadata || {});
      const bookingDateTime = new Date(`${new Date(b.booking_date).toISOString().split('T')[0]}T${b.slot_start_time}`);

      // Calculate remaining time for upcoming
      let remaining_time = null;
      if (type === 'upcoming' && bookingDateTime > now) {
        const diffMs = bookingDateTime - now;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        if (diffDays > 0) {
          remaining_time = `${diffDays}d ${diffHours}h`;
        } else if (diffHours > 0) {
          remaining_time = `${diffHours}h ${diffMins}m`;
        } else {
          remaining_time = `${diffMins}m`;
        }
      }

      // Base response for both upcoming & past
      const appointment = {
        id: b.booking_id,
        doctor: {
          id: b.doctor_uuid,
          name: b.doctor_name,
          profile_photo: b.doctor_photo,
          specialty: b.category_name,
        },
        consultation_type: metadata.consultation_type || 'online',
        date: b.booking_date,
        time: b.slot_start_time,
        end_time: b.slot_end_time,
        status: b.status,
        fee: b.final_amount,
      };

      // Upcoming specific
      if (type === 'upcoming') {
        appointment.remaining_time = remaining_time;
      }

      // Past specific
      if (type === 'past') {
        appointment.doctor.rating = b.doctor_rating;
        appointment.summary = {
          duration: b.slot_start_time && b.slot_end_time
            ? `${timeToMinutes(b.slot_end_time) - timeToMinutes(b.slot_start_time)} min`
            : null,
          diagnosis: metadata.diagnosis || null,
          prescriptions: metadata.prescriptions || null,
          doctor_notes: b.provider_notes || metadata.doctor_notes || null,
        };
        appointment.payment = {
          method: b.payment_method,
          status: b.payment_status,
          amount: b.final_amount,
          transaction_id: b.transaction_id,
          paid_at: b.paid_at,
        };
        appointment.user_rating = b.user_rating;
        appointment.user_review = b.user_review;
      }

      return appointment;
    });

    return res.status(200).json({      message: `${type === 'upcoming' ? 'Upcoming' : 'Past'} appointments fetched.`,
      data: appointments,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        total_pages: Math.ceil(result.total / result.limit),
      },
    });
  } catch (error) {
    console.error('getAppointments error:', error.message);
    return res.status(500).json({      message: 'Something went wrong.',
    });
  }
};

// Helper
const timeToMinutes = (time) => {
  if (!time) return 0;
  const parts = time.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
};

/**
 * GET /api/v1/user/appointment/:booking_id
 * Full appointment detail (past - with diagnosis, prescriptions, notes)
 */
const getAppointmentDetail = async (req, res) => {
  try {
    const userId = req.user.id;
    const { booking_id } = req.params;

    const booking = await bookingModel.findByBookingId(booking_id);
    if (!booking) {
      return res.status(404).json({ message: 'Appointment not found.' });
    }
    if (booking.user_id !== userId) {
      return res.status(403).json({ message: 'Not your appointment.' });
    }

    const metadata = typeof booking.metadata === 'string' ? JSON.parse(booking.metadata) : (booking.metadata || {});

    // Get doctor info
    const { pool } = require('../../config/database');
    const [doctorRows] = await pool.query(
      `SELECT d.uuid, d.full_name, d.profile_photo, d.qualification, d.experience_years, d.average_rating, d.consultation_fee, dc.name as category_name
       FROM doctors d
       LEFT JOIN doctor_categories dc ON d.category_id = dc.id
       WHERE d.id = ?`,
      [booking.provider_id]
    );
    const doctor = doctorRows[0] || {};

    return res.status(200).json({      message: 'Appointment detail fetched.',
      data: {
        id: booking.booking_id,
        status: booking.status,
        doctor: {
          id: doctor.uuid,
          name: doctor.full_name,
          profile_photo: doctor.profile_photo,
          qualification: doctor.qualification,
          experience_years: doctor.experience_years,
          rating: doctor.average_rating,
          specialty: doctor.category_name,
          fee: doctor.consultation_fee,
        },
        appointment: {
          date: booking.booking_date,
          time: booking.slot_start_time,
          end_time: booking.slot_end_time,
          duration: booking.slot_start_time && booking.slot_end_time
            ? `${timeToMinutes(booking.slot_end_time) - timeToMinutes(booking.slot_start_time)} min`
            : null,
          consultation_type: metadata.consultation_type || 'online',
        },
        clinical: {
          diagnosis: metadata.diagnosis || null,
          prescriptions: metadata.prescriptions || null,
          doctor_notes: booking.provider_notes || metadata.doctor_notes || null,
          attachments: metadata.attachments || [],
        },
        payment: {
          base_amount: booking.base_amount,
          tax: booking.tax_amount,
          discount: booking.discount_amount,
          total: booking.final_amount,
          status: booking.payment_status,
          method: booking.payment_method,
          transaction_id: booking.transaction_id,
          paid_at: booking.paid_at,
        },
        rating: {
          user_rating: booking.user_rating,
          user_review: booking.user_review,
          rated_at: booking.rated_at,
        },
        notes: booking.user_notes,
        created_at: booking.created_at,
        confirmed_at: booking.confirmed_at,
        completed_at: booking.completed_at,
      },
    });
  } catch (error) {
    console.error('getAppointmentDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/user/booking/lab
 * Body: { lab_id, test_ids, booking_date, collection_type, address_id, user_notes, attachments }
 * collection_type: "home" | "walk_in"
 */
const createLabBooking = async (req, res) => {
  try {
    const userId = req.user.id;
    const { lab_id, test_ids, booking_date, collection_type, address_id, user_notes, attachments } = req.body;

    // Validate
    if (!lab_id || !test_ids || !test_ids.length) {
      return res.status(400).json({ message: 'lab_id and test_ids are required.' });
    }

    if (!booking_date) {
      return res.status(400).json({ message: 'booking_date is required.' });
    }

    // Find lab
    const lab = await labModel.findByUuid(lab_id);
    if (!lab) {
      return res.status(404).json({ message: 'Lab not found.' });
    }

    // Get test pricing for this lab
    const [testPricing] = await pool.query(
      `SELECT ltp.id as pricing_id, ltp.test_id, ltp.price, ltp.discount_percent, lt.name as test_name
       FROM lab_test_pricing ltp
       JOIN lab_tests lt ON ltp.test_id = lt.id
       WHERE ltp.pathology_lab_id = ? AND (ltp.test_id IN (?) OR ltp.id IN (?)) AND ltp.is_available = 1`,
      [lab.id, test_ids, test_ids]
    );

    if (!testPricing.length) {
      return res.status(400).json({ message: 'Selected tests not available at this lab.' });
    }

    // Calculate total amount
    let baseAmount = 0;
    let totalDiscount = 0;
    const testsBooked = [];

    for (const tp of testPricing) {
      const price = parseFloat(tp.price);
      const discount = price * (parseFloat(tp.discount_percent) / 100);
      baseAmount += price;
      totalDiscount += discount;
      testsBooked.push({ id: tp.test_id, name: tp.test_name, price, discount });
    }

    const isHomeCollection = (collection_type || 'home') === 'home';

    // ── Home collection: validate address + compute distance-based collection fee ──
    let collectionCharge = 0;
    let collectionDistanceKm = 0;
    let deliveryAddress = null;

    if (isHomeCollection) {
      if (!address_id) {
        return res.status(400).json({ message: 'address_id is required for home collection.' });
      }
      const [addrRows] = await pool.query('SELECT * FROM user_addresses WHERE id = ? AND user_id = ?', [address_id, userId]);
      if (!addrRows.length) {
        return res.status(404).json({ message: 'Address not found.' });
      }
      const addr = addrRows[0];
      deliveryAddress = {
        name: addr.name, mobile: addr.mobile, address_line1: addr.address_line1, address_line2: addr.address_line2,
        landmark: addr.landmark, city: addr.city, state: addr.state, pincode: addr.pincode,
        latitude: addr.latitude, longitude: addr.longitude,
      };

      // Zone check: the chosen address must fall within the lab's serviceable zone.
      if (lab.zone_id) {
        const [zoneRows] = await pool.query('SELECT pincodes FROM zones WHERE id = ? AND is_active = 1', [lab.zone_id]);
        if (!zoneRows.length) {
          return res.status(400).json({ message: 'This lab is not serviceable right now.' });
        }
        const pincodes = typeof zoneRows[0].pincodes === 'string' ? JSON.parse(zoneRows[0].pincodes) : zoneRows[0].pincodes;
        const addressPincode = String(addr.pincode || '');
        if (!Array.isArray(pincodes) || !pincodes.map(String).includes(addressPincode)) {
          return res.status(400).json({ message: 'This lab does not offer home collection at the selected address. Please choose an address within the serviceable area.' });
        }
      }

      // Distance-based collection fee = sample_collection_per_km_charge * distance (lab -> address)
      const [cfgRows] = await pool.query("SELECT config_value FROM admin_config WHERE config_key = 'sample_collection_per_km_charge'");
      const perKm = cfgRows.length ? parseFloat(cfgRows[0].config_value) : 15;
      const labLat = parseFloat(lab.latitude);
      const labLng = parseFloat(lab.longitude);
      const aLat = parseFloat(addr.latitude);
      const aLng = parseFloat(addr.longitude);
      if (labLat && labLng && aLat && aLng) {
        const { distance_km } = await distanceService.getDistance(labLat, labLng, aLat, aLng);
        collectionDistanceKm = distance_km;
        collectionCharge = parseFloat((distance_km * perKm).toFixed(2));
      }
    }

    const finalAmount = baseAmount - totalDiscount + collectionCharge;

    // Create booking
    const booking = await bookingModel.create({
      user_id: userId,
      service_type: 'pathology_test',
      provider_id: lab.id,
      status: 'pending',
      booking_date,
      slot_start_time: null,
      slot_end_time: null,
      base_amount: baseAmount,
      discount_amount: totalDiscount,
      tax_amount: 0,
      final_amount: finalAmount,
      payment_status: 'unpaid',
      payment_method: null,
      metadata: {
        lab_name: lab.name,
        collection_type: collection_type || 'home',
        address_id: address_id || null,
        delivery_address: deliveryAddress,
        collection_charge: collectionCharge,
        collection_distance_km: collectionDistanceKm,
        tests: testsBooked,
        attachments: attachments || [],
      },
      user_notes: user_notes || null,
    });

    await bookingModel.addStatusHistory(booking.id, null, 'pending', 'user', userId, 'Lab test booking created');

    // Clear user's lab cart after successful booking creation
    await pool.query('DELETE FROM lab_cart WHERE user_id = ?', [userId]);

    // Initiate Paytm
    let paytmData = null;
    try {
      const paytmResponse = await paytmService.initiateTransaction(booking.booking_id, finalAmount, userId);

      if (paytmResponse.body && paytmResponse.body.txnToken) {
        paytmData = {
          txn_token: paytmResponse.body.txnToken,
          order_id: booking.booking_id,
          mid: paytmConfig.mid,
          amount: finalAmount.toFixed(2),
          callback_url: paytmConfig.callbackUrl,
          website: paytmConfig.website,
          base_url: paytmConfig.baseUrl,
        };
      } else {
        paytmData = {
          txn_token: null,
          order_id: booking.booking_id,
          mid: paytmConfig.mid,
          amount: finalAmount.toFixed(2),
          callback_url: paytmConfig.callbackUrl,
          website: paytmConfig.website,
          base_url: paytmConfig.baseUrl,
          error: paytmResponse.body?.resultInfo?.resultMsg || 'Token generation failed',
        };
      }
    } catch (paytmError) {
      paytmData = {
        txn_token: null,
        order_id: booking.booking_id,
        mid: paytmConfig.mid,
        amount: finalAmount.toFixed(2),
        callback_url: paytmConfig.callbackUrl,
        website: paytmConfig.website,
        base_url: paytmConfig.baseUrl,
        error: paytmError.message,
      };
    }

    return res.status(201).json({      message: 'Lab booking created. Please complete payment.',
      data: {
        booking_id: booking.booking_id,
        lab_name: lab.name,
        collection_type: collection_type || 'home',
        date: booking_date,
        tests: testsBooked,
        amount: {
          base: baseAmount,
          discount: totalDiscount,
          collection_charge: collectionCharge,
          collection_distance_km: collectionDistanceKm,
          tax: 0,
          total: finalAmount,
        },
        status: 'pending',
        payment_status: 'unpaid',
        payment: paytmData,
      },
    });
  } catch (error) {
    console.error('createLabBooking error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/user/booking/diagnostic
 * Book a diagnostic service
 * Body: { service_pricing_id, booking_date, slot_id (if appointment), payment_method, patient_name, patient_mobile, patient_age, patient_gender, patient_email, prescription, remark }
 */
const createDiagnosticBooking = async (req, res) => {
  try {
    const userId = req.user.id;
    const { service_pricing_id, booking_date, slot_id, payment_method, patient_name, patient_mobile, patient_age, patient_gender, patient_email, prescription, remark } = req.body;

    // Validate required
    if (!service_pricing_id || !booking_date || !payment_method || !patient_name || !patient_mobile || !patient_age || !patient_gender) {
      return res.status(400).json({ message: 'Required: service_pricing_id, booking_date, payment_method, patient_name, patient_mobile, patient_age, patient_gender' });
    }

    if (!['online', 'offline'].includes(payment_method)) {
      return res.status(400).json({ message: 'payment_method must be "online" or "offline".' });
    }

    // Get service pricing details
    const [serviceRows] = await pool.query(
      `SELECT dsp.*, ds.name as service_name, dc.name as center_name, dc.uuid as center_uuid, dc.id as center_id
       FROM diagnostic_service_pricing dsp
       JOIN diagnostic_services ds ON dsp.service_id = ds.id
       JOIN diagnostic_centers dc ON dsp.diagnostic_center_id = dc.id
       WHERE dsp.id = ? AND dsp.is_available = 1`,
      [service_pricing_id]
    );

    if (!serviceRows.length) {
      return res.status(404).json({ message: 'Service not found or unavailable.' });
    }

    const service = serviceRows[0];

    // If appointment type, validate slot_id
    let slotTime = null;
    let slotEndTime = null;
    if (service.booking_type === 'appointment') {
      if (!slot_id) {
        return res.status(400).json({ message: 'slot_id required for appointment type services.' });
      }
      const parts = slot_id.split('_');
      if (parts.length !== 2) {
        return res.status(400).json({ message: 'Invalid slot_id format.' });
      }
      slotTime = `${parts[1].slice(0, 2)}:${parts[1].slice(2)}`;
      const duration = service.slot_duration_minutes_config || 30;
      const totalMins = parseInt(parts[1].slice(0, 2)) * 60 + parseInt(parts[1].slice(2)) + duration;
      slotEndTime = `${Math.floor(totalMins / 60).toString().padStart(2, '0')}:${(totalMins % 60).toString().padStart(2, '0')}`;

      // 1) Slot must not be in the past (compare slot END datetime with now).
      //    e.g. 09:00-10:00 slot -> after 10:00 it's expired.
      const slotEndAt = new Date(`${booking_date}T${slotEndTime}:00`);
      if (isNaN(slotEndAt.getTime())) {
        return res.status(400).json({ message: 'Invalid slot or date.' });
      }
      if (slotEndAt.getTime() <= Date.now()) {
        return res.status(400).json({ message: 'This slot has expired. You are delayed — please pick a later slot.', data: { reason: 'slot_expired' } });
      }

      // 2) One booking per slot: block if this slot is already taken (active booking).
      const [taken] = await pool.query(
        `SELECT id FROM bookings
         WHERE service_type = 'diagnostic_scan' AND provider_id = ? AND booking_date = ? AND slot_start_time = ?
               AND status NOT IN ('cancelled', 'failed')
         LIMIT 1`,
        [service.center_id, booking_date, slotTime]
      );
      if (taken.length) {
        return res.status(409).json({ message: 'This slot is already booked. Please choose another slot.', data: { reason: 'slot_taken' } });
      }
    }

    // Calculate pricing
    const baseAmount = parseFloat(service.price);
    const discount = baseAmount * (parseFloat(service.discount_percent) / 100);
    const finalAmount = baseAmount - discount;

    // Create booking
    const bookingModel = require('../../models/user/booking.model');
    const booking = await bookingModel.create({
      user_id: userId,
      service_type: 'diagnostic_scan',
      provider_id: service.center_id,
      status: payment_method === 'offline' ? 'confirmed' : 'pending',
      booking_date,
      slot_start_time: slotTime,
      slot_end_time: slotEndTime,
      base_amount: baseAmount,
      discount_amount: discount,
      tax_amount: 0,
      final_amount: finalAmount,
      payment_status: payment_method === 'offline' ? 'unpaid' : 'unpaid',
      payment_method: payment_method === 'offline' ? 'cod' : null,
      metadata: {
        service_pricing_id,
        service_name: service.service_name,
        center_name: service.center_name,
        booking_type: service.booking_type,
        patient: { name: patient_name, mobile: patient_mobile, age: patient_age, gender: patient_gender, email: patient_email || null },
        prescription: prescription || null,
      },
      user_notes: remark || null,
    });

    await bookingModel.addStatusHistory(booking.id, null, payment_method === 'offline' ? 'confirmed' : 'pending', 'user', userId, 'Diagnostic booking created');

    // OFFLINE → Direct confirm, send notification + SSE
    if (payment_method === 'offline') {
      // Notify diagnostic center
      const notificationService = require('../../services/notification.service');
      const [centerRows] = await pool.query('SELECT fcm_token FROM diagnostic_centers WHERE id = ?', [service.center_id]);
      const center = centerRows[0];
      if (center && center.fcm_token) {
        await notificationService.sendToDevice(center.fcm_token, 'New Booking 📋', `New ${service.service_name} booking for ${booking_date}.`, { type: 'new_booking', booking_id: booking.booking_id });
      }
      await pool.query("INSERT INTO notifications (recipient_type, recipient_id, title, body, type, reference_type, reference_id, sent_via) VALUES ('diagnostic_center', ?, 'New Booking 📋', ?, 'booking', 'booking', ?, ?)",
        [service.center_id, `New ${service.service_name} booking.`, booking.id, center?.fcm_token ? 'push' : 'sms']);

      // SSE
      const { sendToClient } = require('../../events/sse');
      sendToClient(`diagnostic_${service.center_id}`, 'new_booking', {
        booking_id: booking.booking_id, date: booking_date, service_name: service.service_name,
        amount: finalAmount, patient_name, slot_time: slotTime, booking_type: service.booking_type,
        payment_method: 'offline',
      });

      return res.status(201).json({
        message: 'Booking confirmed! Pay at center.',
        data: {
          booking_id: booking.booking_id,
          service_name: service.service_name,
          center_name: service.center_name,
          date: booking_date,
          slot_time: slotTime,
          amount: { base: baseAmount, discount, total: finalAmount },
          payment_method: 'offline',
          status: 'confirmed',
          payment_status: 'unpaid',
          payment: null,
        },
      });
    }

    // ONLINE → Initiate Paytm
    let paytmData = null;
    try {
      const paytmResponse = await paytmService.initiateTransaction(booking.booking_id, finalAmount, userId);
      if (paytmResponse.body && paytmResponse.body.txnToken) {
        paytmData = { txn_token: paytmResponse.body.txnToken, order_id: booking.booking_id, mid: paytmConfig.mid, amount: finalAmount.toFixed(2), callback_url: paytmConfig.callbackUrl, website: paytmConfig.website, base_url: paytmConfig.baseUrl };
      } else {
        paytmData = { txn_token: null, order_id: booking.booking_id, mid: paytmConfig.mid, amount: finalAmount.toFixed(2), callback_url: paytmConfig.callbackUrl, website: paytmConfig.website, base_url: paytmConfig.baseUrl, error: paytmResponse.body?.resultInfo?.resultMsg || 'Failed' };
      }
    } catch (paytmError) {
      paytmData = { txn_token: null, order_id: booking.booking_id, mid: paytmConfig.mid, amount: finalAmount.toFixed(2), callback_url: paytmConfig.callbackUrl, website: paytmConfig.website, base_url: paytmConfig.baseUrl, error: paytmError.message };
    }

    // NOTE: For ONLINE bookings, the diagnostic center is notified only AFTER
    // payment succeeds — handled by notifyProviderNewBooking() in the Paytm callback.
    // No provider notification/SSE here (payment not done yet).

    return res.status(201).json({
      message: 'Booking created. Complete payment.',
      data: {
        booking_id: booking.booking_id,
        service_name: service.service_name,
        center_name: service.center_name,
        date: booking_date,
        slot_time: slotTime,
        amount: { base: baseAmount, discount, total: finalAmount },
        payment_method: 'online',
        status: 'pending',
        payment_status: 'unpaid',
        payment: paytmData,
      },
    });
  } catch (error) {
    console.error('createDiagnosticBooking error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/all-bookings?status=&type=&page=&limit=
 * Unified booking history - all types (doctor, lab, diagnostic, pharmacy, blood)
 */
const getAllBookings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, type, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let allBookings = [];

    // 1. Doctor + Lab + Diagnostic bookings (from bookings table)
    if (!type || ['doctor', 'lab', 'diagnostic'].includes(type)) {
      let bWhere = ['b.user_id = ?'];
      let bParams = [userId];
      if (status) { bWhere.push('b.status = ?'); bParams.push(status); }
      if (type === 'doctor') bWhere.push("b.service_type = 'doctor_consultation'");
      else if (type === 'lab') bWhere.push("b.service_type = 'pathology_test'");
      else if (type === 'diagnostic') bWhere.push("b.service_type = 'diagnostic_scan'");

      const [bRows] = await pool.query(
        `SELECT b.booking_id as id, b.service_type as type, b.status, b.final_amount as amount, b.payment_status, b.booking_date, b.created_at FROM bookings b WHERE ${bWhere.join(' AND ')} ORDER BY b.created_at DESC`,
        bParams
      );
      for (const b of bRows) {
        allBookings.push({ id: b.id, type: b.type === 'doctor_consultation' ? 'doctor' : b.type === 'pathology_test' ? 'lab' : 'diagnostic', status: b.status, amount: b.amount, payment_status: b.payment_status, date: b.booking_date, created_at: b.created_at });
      }
    }

    // 2. Pharmacy orders
    if (!type || type === 'pharmacy') {
      let pWhere = ['po.user_id = ?'];
      let pParams = [userId];
      if (status) { pWhere.push('po.status = ?'); pParams.push(status); }

      const [pRows] = await pool.query(
        `SELECT po.order_id as id, po.status, po.final_amount as amount, po.payment_status, po.created_at, p.name as provider_name FROM pharmacy_orders po JOIN pharmacies p ON po.pharmacy_id = p.id WHERE ${pWhere.join(' AND ')} ORDER BY po.created_at DESC`,
        pParams
      );
      for (const p of pRows) {
        allBookings.push({ id: p.id, type: 'pharmacy', status: p.status, amount: p.amount, payment_status: p.payment_status, provider_name: p.provider_name, date: null, created_at: p.created_at });
      }
    }

    // 3. Blood requests
    if (!type || type === 'blood') {
      let brWhere = ['br.user_id = ?'];
      let brParams = [userId];
      if (status) { brWhere.push('br.status = ?'); brParams.push(status); }

      const [brRows] = await pool.query(
        `SELECT br.request_id as id, br.status, br.total_amount as amount, br.payment_status, br.required_date, br.created_at, bb.name as provider_name FROM blood_requests br JOIN blood_banks bb ON br.blood_bank_id = bb.id WHERE ${brWhere.join(' AND ')} ORDER BY br.created_at DESC`,
        brParams
      );
      for (const br of brRows) {
        allBookings.push({ id: br.id, type: 'blood', status: br.status, amount: br.amount, payment_status: br.payment_status, provider_name: br.provider_name, date: br.required_date, created_at: br.created_at });
      }
    }

    // Sort all by created_at desc
    allBookings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Paginate
    const total = allBookings.length;
    const paginated = allBookings.slice(offset, offset + parseInt(limit));

    return res.status(200).json({
      message: 'All bookings fetched.',
      data: paginated,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, total_pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('getAllBookings error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  createLabBooking,
  createDiagnosticBooking,
  confirmPayment,
  paytmCallback,
  verifyPayment,
  getMyBookings,
  getBookingDetail,
  getAppointments,
  getAppointmentDetail,
  getAllBookings,
};
