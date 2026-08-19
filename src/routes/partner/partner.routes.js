const express = require('express');
const router = express.Router();
const partnerController = require('../../controllers/partner/partner.controller');
const { registerClient } = require('../../events/sse');
const partnerAuth = require('../../middlewares/partner/partner.auth');

// Public
router.post('/register', partnerController.register);
router.post('/login', partnerController.login);

// Protected
router.get('/profile', partnerAuth, partnerController.getProfile);
router.put('/profile', partnerAuth, partnerController.updateProfile);
router.put('/location', partnerAuth, partnerController.updateLocation);
router.put('/toggle-online', partnerAuth, partnerController.toggleOnline);

// Bookings
router.get('/bookings', partnerAuth, partnerController.getBookings);
router.put('/booking/:booking_id/accept', partnerAuth, partnerController.acceptBooking);
router.put('/booking/:booking_id/reject', partnerAuth, partnerController.rejectBooking);
router.put('/booking/:booking_id/status', partnerAuth, partnerController.updateBookingStatus);

// SSE
router.get('/events/stream', partnerAuth, async (req, res) => {
  registerClient(req, res, `partner_${req.partner.id}`);
  const { pool } = require('../../config/database');
  const [pending] = await pool.query("SELECT COUNT(*) as count FROM ambulance_bookings WHERE partner_id = ? AND status = 'pending'", [req.partner.id]);
  res.write(`event: initial\ndata: ${JSON.stringify({ pending_bookings: pending[0].count })}\n\n`);
});

module.exports = router;
