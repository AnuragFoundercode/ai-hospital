const notificationService = require('./notification.service');
const { pool } = require('../config/database');

// ─────────────────────────────────────────────
// BOOKING NOTIFICATION SERVICE
// Send push notifications after booking events
// ─────────────────────────────────────────────

/**
 * Send notification after successful payment
 * Notifies both USER and DOCTOR
 */
const sendBookingConfirmedNotification = async (booking) => {
  const metadata = booking.metadata ? JSON.parse(booking.metadata) : {};
  const bookingDate = new Date(booking.booking_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const slotTime = booking.slot_start_time;

  // ─── Notification to USER (patient) ───
  try {
    const [userRows] = await pool.query('SELECT fcm_token, full_name FROM users WHERE id = ?', [booking.user_id]);
    const user = userRows[0];

    if (user && user.fcm_token) {
      await notificationService.sendToDevice(
        user.fcm_token,
        'Booking Confirmed ✅',
        `Your consultation with ${metadata.doctor_name || 'Doctor'} on ${bookingDate} at ${slotTime} is confirmed.`,
        {
          type: 'booking_confirmed',
          booking_id: booking.booking_id,
          service_type: booking.service_type,
        }
      );
    }

    // Save notification in DB
    await pool.query(
      `INSERT INTO notifications (recipient_type, recipient_id, title, body, type, reference_type, reference_id, sent_via) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['user', booking.user_id, 'Booking Confirmed ✅', `Your consultation with ${metadata.doctor_name || 'Doctor'} is confirmed for ${bookingDate} at ${slotTime}.`, 'booking', 'booking', booking.id, user?.fcm_token ? 'push' : 'sms']
    );
  } catch (err) {
    console.error('User notification failed:', err.message);
  }

  // ─── Notification to DOCTOR ───
  try {
    const [doctorRows] = await pool.query('SELECT fcm_token, full_name FROM doctors WHERE id = ?', [booking.provider_id]);
    const doctor = doctorRows[0];

    if (doctor && doctor.fcm_token) {
      await notificationService.sendToDevice(
        doctor.fcm_token,
        'New Appointment Booked 📋',
        `New consultation booked for ${bookingDate} at ${slotTime}. Please check your schedule.`,
        {
          type: 'new_booking',
          booking_id: booking.booking_id,
          service_type: booking.service_type,
        }
      );
    }

    // Save notification in DB for doctor
    await pool.query(
      `INSERT INTO notifications (recipient_type, recipient_id, title, body, type, reference_type, reference_id, sent_via) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['doctor', booking.provider_id, 'New Appointment Booked 📋', `New consultation booked for ${bookingDate} at ${slotTime}.`, 'booking', 'booking', booking.id, doctor?.fcm_token ? 'push' : 'sms']
    );
  } catch (err) {
    console.error('Doctor notification failed:', err.message);
  }
};

/**
 * Send notification when booking is cancelled
 */
const sendBookingCancelledNotification = async (booking, cancelledBy) => {
  const metadata = booking.metadata ? JSON.parse(booking.metadata) : {};

  try {
    // Notify the other party
    if (cancelledBy === 'user') {
      // Notify doctor
      const [doctorRows] = await pool.query('SELECT fcm_token FROM doctors WHERE id = ?', [booking.provider_id]);
      const doctor = doctorRows[0];
      if (doctor && doctor.fcm_token) {
        await notificationService.sendToDevice(
          doctor.fcm_token,
          'Appointment Cancelled ❌',
          `Appointment on ${booking.booking_date} at ${booking.slot_start_time} has been cancelled by patient.`,
          { type: 'booking_cancelled', booking_id: booking.booking_id }
        );
      }
    } else {
      // Notify user
      const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [booking.user_id]);
      const user = userRows[0];
      if (user && user.fcm_token) {
        await notificationService.sendToDevice(
          user.fcm_token,
          'Appointment Cancelled ❌',
          `Your appointment with ${metadata.doctor_name || 'Doctor'} on ${booking.booking_date} has been cancelled.`,
          { type: 'booking_cancelled', booking_id: booking.booking_id }
        );
      }
    }
  } catch (err) {
    console.error('Cancel notification failed:', err.message);
  }
};

module.exports = {
  sendBookingConfirmedNotification,
  sendBookingCancelledNotification,
};
