const bookingModel = require('../../models/user/booking.model');
const doctorModel = require('../../models/user/doctor.model');
const labModel = require('../../models/user/lab.model');
const paytmService = require('../../services/paytm.service');
const paytmConfig = require('../../config/paytm');
const bookingNotification = require('../../services/booking.notification');
const { pool } = require('../../config/database');
const { sendToLab, sendToDoctor } = require('../../events/sse');

// ─────────────────────────────────────────────
// BOOKING CONTROLLER - For patient app
// ─────────────────────────────────────────────

/**
 * POST /api/v1/user/booking/doctor
 * Body: { doctor_id, slot_id, consultation_type, user_notes }
 * 
 * FLOW:
 * 1. Validate doctor exists & is active
 * 2. Parse slot_id → date + time
 * 3. Check slot is available (not already booked)
 * 4. Create booking with status "pending" & payment_status "unpaid"
 * 5. Return booking details (user will pay next)
 */
const createDoctorBooking = async (req, res) => {
  try {
    const userId = req.user.id;
    const { doctor_id, slot_id, consultation_type, user_notes, attachments } = req.body;

    // Validate input
    if (!doctor_id || !slot_id) {
      return res.status(400).json({        message: 'doctor_id and slot_id are required.',
      });
    }

    // Find doctor
    const doctor = await doctorModel.findByUuid(doctor_id);
    if (!doctor) {
      return res.status(404).json({        message: 'Doctor not found.',
      });
    }

    // Parse slot_id → "2026-07-29_0900" → date: "2026-07-29", time: "09:00"
    const parts = slot_id.split('_');
    if (parts.length !== 2) {
      return res.status(400).json({        message: 'Invalid slot_id format.',
      });
    }

    const bookingDate = parts[0];
    const timeRaw = parts[1]; // "0900"
    const slotTime = `${timeRaw.slice(0, 2)}:${timeRaw.slice(2)}`;

    // Validate date is not in past
    const today = new Date().toISOString().split('T')[0];
    if (bookingDate < today) {
      return res.status(400).json({        message: 'Cannot book for past dates.',
      });
    }

    // Check if slot is already booked
    const isBooked = await bookingModel.isSlotBooked('doctor_consultation', doctor.id, bookingDate, slotTime);
    if (isBooked) {
      return res.status(409).json({        message: 'This slot is already booked. Please choose another slot.',
      });
    }

    // Calculate end time (from doctor's availability slot_duration)
    const slots = await doctorModel.getSlotsByDate(doctor.id, bookingDate);
    const matchedSlot = slots.find((s) => s.time === slotTime);

    if (!matchedSlot) {
      return res.status(400).json({        message: 'Doctor is not available at this time on selected date.',
      });
    }

    // Pricing
    const baseAmount = parseFloat(doctor.consultation_fee);
    const taxAmount = 0; // Add tax logic if needed
    const finalAmount = baseAmount + taxAmount;

    // Create booking
    const booking = await bookingModel.create({
      user_id: userId,
      service_type: 'doctor_consultation',
      provider_id: doctor.id,
      status: 'pending',
      booking_date: bookingDate,
      slot_start_time: slotTime,
      slot_end_time: matchedSlot.end_time,
      base_amount: baseAmount,
      discount_amount: 0,
      tax_amount: taxAmount,
      final_amount: finalAmount,
      payment_status: 'unpaid',
      payment_method: null,
      metadata: {
        consultation_type: consultation_type || 'online',
        doctor_name: doctor.full_name,
        doctor_category: doctor.category_name,
        attachments: attachments || [],
      },
      user_notes: user_notes || null,
    });

    // Add status history
    await bookingModel.addStatusHistory(booking.id, null, 'pending', 'user', userId, 'Booking created');

    // Initiate Paytm transaction
    let paytmData = null;
    try {
      const paytmResponse = await paytmService.initiateTransaction(
        booking.booking_id,
        finalAmount,
        userId
      );

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
        // Paytm API responded but no token - return basic payment info
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
      console.error('Paytm initiation failed:', paytmError.message);
      // Still return payment config so frontend can retry
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

    return res.status(201).json({      message: 'Booking created. Please complete payment.',
      data: {
        booking_id: booking.booking_id,
        doctor_name: doctor.full_name,
        doctor_photo: doctor.profile_photo,
        category: doctor.category_name,
        consultation_type: consultation_type || 'online',
        date: bookingDate,
        slot_time: slotTime,
        slot_end_time: matchedSlot.end_time,
        amount: {
          base: baseAmount,
          tax: taxAmount,
          discount: 0,
          total: finalAmount,
        },
        status: 'pending',
        payment_status: 'unpaid',
        payment: paytmData,
      },
    });
  } catch (error) {
    console.error('createDoctorBooking error:', error.message);
    return res.status(500).json({      message: 'Something went wrong.',
    });
  }
};

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
    bookingNotification.sendBookingConfirmedNotification(updatedBooking);

    // Send SSE to lab/doctor for real-time popup
    const metadata = typeof updatedBooking.metadata === 'string' ? JSON.parse(updatedBooking.metadata) : (updatedBooking.metadata || {});
    if (updatedBooking.service_type === 'pathology_test') {
      console.log(`📡 Sending SSE to lab_${updatedBooking.provider_id}`);
      const sent = sendToLab(updatedBooking.provider_id, 'new_booking', {
        booking_id: updatedBooking.booking_id,
        date: updatedBooking.booking_date,
        amount: updatedBooking.final_amount,
        collection_type: metadata.collection_type,
        tests: metadata.tests || [],
        user_notes: updatedBooking.user_notes,
      });
      console.log(`📡 SSE sent: ${sent}`);
    } else if (updatedBooking.service_type === 'doctor_consultation') {
      sendToDoctor(updatedBooking.provider_id, 'new_booking', {
        booking_id: updatedBooking.booking_id,
        date: updatedBooking.booking_date,
        slot_time: updatedBooking.slot_start_time,
        amount: updatedBooking.final_amount,
      });
    }

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
    const { page = 1, limit = 10, status } = req.query;

    const result = await bookingModel.getUserBookings(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      status: status || null,
    });

    const bookings = result.bookings.map((b) => ({
      booking_id: b.booking_id,
      service_type: b.service_type,
      doctor_name: b.doctor_name,
      doctor_photo: b.doctor_photo,
      category: b.category_name,
      date: b.booking_date,
      slot_time: b.slot_start_time,
      status: b.status,
      payment_status: b.payment_status,
      amount: b.final_amount,
      created_at: b.created_at,
    }));

    return res.status(200).json({      message: 'Bookings fetched.',
      data: bookings,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        total_pages: Math.ceil(result.total / result.limit),
      },
    });
  } catch (error) {
    console.error('getMyBookings error:', error.message);
    return res.status(500).json({      message: 'Something went wrong.',
    });
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
      return res.status(400).json({        message: 'Invalid checksum. Payment verification failed.',
      });
    }

    const orderId = paytmParams.ORDERID;
    const txnStatus = paytmParams.STATUS;
    const txnId = paytmParams.TXNID;
    const paymentMode = paytmParams.PAYMENTMODE;

    // Find booking
    const booking = await bookingModel.findByBookingId(orderId);
    if (!booking) {
      return res.status(404).json({        message: 'Booking not found.',
      });
    }

    if (txnStatus === 'TXN_SUCCESS') {
      // Payment successful
      await bookingModel.updatePayment(orderId, {
        payment_status: 'paid',
        transaction_id: txnId,
        user_id: booking.user_id,
      });

      await bookingModel.addStatusHistory(booking.id, 'pending', 'confirmed', 'system', null, `Paytm payment success. Mode: ${paymentMode}`);

      // Send push notifications to user & doctor
      const updatedBooking = await bookingModel.findByBookingId(orderId);
      bookingNotification.sendBookingConfirmedNotification(updatedBooking);

      return res.status(200).json({        message: 'Payment successful. Booking confirmed.',
        data: {
          booking_id: orderId,
          status: 'confirmed',
          payment_status: 'paid',
          transaction_id: txnId,
        },
      });
    } else {
      // Payment failed
      await bookingModel.addStatusHistory(booking.id, 'pending', 'pending', 'system', null, `Paytm payment failed: ${txnStatus}`);

      return res.status(200).json({        message: 'Payment failed. Please try again.',
        data: {
          booking_id: orderId,
          status: 'pending',
          payment_status: 'unpaid',
          reason: paytmParams.RESPMSG,
        },
      });
    }
  } catch (error) {
    console.error('paytmCallback error:', error.message);
    return res.status(500).json({      message: 'Something went wrong.',
    });
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
      `SELECT ltp.test_id, ltp.price, ltp.discount_percent, lt.name as test_name
       FROM lab_test_pricing ltp
       JOIN lab_tests lt ON ltp.test_id = lt.id
       WHERE ltp.pathology_lab_id = ? AND ltp.test_id IN (?) AND ltp.is_available = 1`,
      [lab.id, test_ids]
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

    const finalAmount = baseAmount - totalDiscount;

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
        tests: testsBooked,
        attachments: attachments || [],
      },
      user_notes: user_notes || null,
    });

    await bookingModel.addStatusHistory(booking.id, null, 'pending', 'user', userId, 'Lab test booking created');

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

module.exports = {
  createDoctorBooking,
  createLabBooking,
  confirmPayment,
  paytmCallback,
  verifyPayment,
  getMyBookings,
  getBookingDetail,
  getAppointments,
  getAppointmentDetail,
};
