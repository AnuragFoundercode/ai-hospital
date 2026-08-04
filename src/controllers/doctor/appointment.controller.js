const appointmentModel = require('../../models/doctor/appointment.model');
const walletModel = require('../../models/doctor/wallet.model');
const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// APPOINTMENT CONTROLLER - Doctor Panel
// ─────────────────────────────────────────────

/**
 * GET /api/v1/doctor/appointments?type=upcoming|ongoing|completed&page=1&limit=10
 */
const getAppointments = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { type = 'upcoming', page = 1, limit = 10 } = req.query;

    if (!['upcoming', 'ongoing', 'completed'].includes(type)) {
      return res.status(400).json({        message: 'Type must be: upcoming, ongoing, or completed.',
      });
    }

    const result = await appointmentModel.getAppointments(doctorId, {
      type,
      page: parseInt(page),
      limit: parseInt(limit),
    });

    const appointments = result.appointments.map((a) => ({
      booking_id: a.booking_id,
      user_name: a.user_name,
      user_gender: a.user_gender,
      user_photo: a.user_photo,
      date: a.booking_date,
      time: a.slot_start_time,
      end_time: a.slot_end_time,
      status: a.status,
      user_notes: a.user_notes,
    }));

    return res.status(200).json({      message: `${type} appointments fetched.`,
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
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/doctor/appointment/:booking_id
 * Full booking detail for doctor
 */
const getAppointmentDetail = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { booking_id } = req.params;

    const [rows] = await pool.query(
      `SELECT b.*, u.full_name as user_name, u.mobile as user_mobile, u.email as user_email, u.gender as user_gender, u.date_of_birth as user_dob, u.blood_group as user_blood_group, u.profile_photo as user_photo
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       WHERE b.booking_id = ? AND b.provider_id = ? AND b.service_type = 'doctor_consultation'`,
      [booking_id, doctorId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Appointment not found.' });
    }

    const b = rows[0];
    const metadata = typeof b.metadata === 'string' ? JSON.parse(b.metadata) : (b.metadata || {});

    return res.status(200).json({      message: 'Appointment detail fetched.',
      data: {
        booking_id: b.booking_id,
        status: b.status,
        patient: {
          name: b.user_name,
          mobile: b.user_mobile,
          email: b.user_email,
          gender: b.user_gender,
          date_of_birth: b.user_dob,
          blood_group: b.user_blood_group,
          profile_photo: b.user_photo,
        },
        appointment: {
          date: b.booking_date,
          time: b.slot_start_time,
          end_time: b.slot_end_time,
          consultation_type: metadata.consultation_type || 'online',
        },
        clinical: {
          user_notes: b.user_notes,
          user_reports: metadata.attachments || [],
          doctor_notes: b.provider_notes,
          diagnosis: metadata.diagnosis || null,
          prescriptions: metadata.prescriptions || [],
          prescription_notes: metadata.prescription_notes || null,
        },
        payment: {
          status: b.payment_status,
          method: b.payment_method,
          amount: b.final_amount,
          transaction_id: b.transaction_id,
        },
        rating: {
          user_rating: b.user_rating,
          user_review: b.user_review,
        },
        timestamps: {
          created_at: b.created_at,
          confirmed_at: b.confirmed_at,
          started_at: b.started_at,
          completed_at: b.completed_at,
          cancelled_at: b.cancelled_at,
        },
      },
    });
  } catch (error) {
    console.error('getAppointmentDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/doctor/appointment/:booking_id/notes
 * Doctor adds notes, diagnosis, prescriptions
 * Body: { doctor_notes, diagnosis, prescriptions, prescription_notes }
 * prescriptions = array of Cloudinary URLs or text
 */
const updateAppointmentNotes = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { booking_id } = req.params;
    const { doctor_notes, diagnosis, prescriptions, prescription_notes } = req.body;

    // Find booking
    const [rows] = await pool.query(
      `SELECT * FROM bookings WHERE booking_id = ? AND provider_id = ? AND service_type = 'doctor_consultation'`,
      [booking_id, doctorId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Appointment not found.' });
    }

    const booking = rows[0];
    const metadata = typeof booking.metadata === 'string' ? JSON.parse(booking.metadata) : (booking.metadata || {});

    // Update metadata with clinical data
    if (diagnosis !== undefined) metadata.diagnosis = diagnosis;
    if (prescriptions !== undefined) metadata.prescriptions = prescriptions;
    if (prescription_notes !== undefined) metadata.prescription_notes = prescription_notes;

    // Update booking
    await pool.query(
      `UPDATE bookings SET provider_notes = ?, metadata = ? WHERE id = ?`,
      [doctor_notes || booking.provider_notes, JSON.stringify(metadata), booking.id]
    );

    return res.status(200).json({      message: 'Notes updated successfully.',
      data: {
        booking_id,
        doctor_notes: doctor_notes || booking.provider_notes,
        diagnosis: metadata.diagnosis,
        prescriptions: metadata.prescriptions,
        prescription_notes: metadata.prescription_notes,
      },
    });
  } catch (error) {
    console.error('updateAppointmentNotes error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/doctor/appointment/:booking_id/complete
 * Doctor marks appointment as completed
 */
const completeAppointment = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { booking_id } = req.params;

    const [rows] = await pool.query(
      `SELECT * FROM bookings WHERE booking_id = ? AND provider_id = ? AND service_type = 'doctor_consultation'`,
      [booking_id, doctorId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Appointment not found.' });
    }

    const booking = rows[0];

    if (booking.status === 'completed') {
      return res.status(400).json({ message: 'Already completed.' });
    }

    await pool.query(
      `UPDATE bookings SET status = 'completed', completed_at = NOW() WHERE id = ?`,
      [booking.id]
    );

    // Credit doctor wallet with consultation fee
    if (booking.payment_status === 'paid') {
      const amount = parseFloat(booking.final_amount);
      await walletModel.credit(
        doctorId,
        amount,
        `Consultation fee - ${booking.booking_id}`,
        'consultation_fee',
        booking.id
      );
    }

    return res.status(200).json({      message: 'Appointment marked as completed.',
      data: { booking_id, status: 'completed' },
    });
  } catch (error) {
    console.error('completeAppointment error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getAppointments,
  getAppointmentDetail,
  updateAppointmentNotes,
  completeAppointment,
};
