const express = require('express');
const router = express.Router();
const diagnosticController = require('../../controllers/diagnostic/diagnostic.controller');
const serviceController = require('../../controllers/diagnostic/service.controller');
const slotController = require('../../controllers/diagnostic/slot.controller');
const bookingController = require('../../controllers/diagnostic/booking.controller');
const { registerClient } = require('../../events/sse');
const diagnosticAuth = require('../../middlewares/diagnostic/diagnostic.auth');

// ─────────────────────────────────────────────
// DIAGNOSTIC CENTER ROUTES
// ─────────────────────────────────────────────

// Public
router.post('/register', diagnosticController.register);
router.post('/login', diagnosticController.login);
router.post('/forgot-password', diagnosticController.forgotPassword);
router.post('/reset-password', diagnosticController.resetPassword);

// Protected
router.get('/profile', diagnosticAuth, diagnosticController.getProfile);
router.put('/profile', diagnosticAuth, diagnosticController.updateProfile);
router.put('/change-password', diagnosticAuth, diagnosticController.changePassword);

// Bank details
router.get('/bank-details', diagnosticAuth, diagnosticController.getBankDetails);
router.put('/bank-details', diagnosticAuth, diagnosticController.updateBankDetails);

// Service Management
router.get('/services', diagnosticAuth, serviceController.getMyServices);
router.get('/services/categories', diagnosticAuth, serviceController.getCategories);
router.post('/services', diagnosticAuth, serviceController.addService);
router.put('/services/:id', diagnosticAuth, serviceController.updateService);
router.delete('/services/:id', diagnosticAuth, serviceController.removeService);

// Slot Management
router.get('/slots', diagnosticAuth, slotController.getSlots);
router.post('/slots', diagnosticAuth, slotController.createSlot);
router.put('/slots/:id', diagnosticAuth, slotController.updateSlot);
router.delete('/slots/:id', diagnosticAuth, slotController.deleteSlot);

// Bookings
router.get('/bookings', diagnosticAuth, bookingController.getBookings);
router.get('/booking/:booking_id', diagnosticAuth, bookingController.getBookingDetail);
router.put('/booking/:booking_id/accept', diagnosticAuth, bookingController.acceptBooking);
router.put('/booking/:booking_id/reject', diagnosticAuth, bookingController.rejectBooking);
router.put('/booking/:booking_id/status', diagnosticAuth, bookingController.updateStatus);
router.put('/booking/:booking_id/upload-report', diagnosticAuth, bookingController.uploadReport);

// SSE
router.get('/events/stream', diagnosticAuth, (req, res) => {
  registerClient(req, res, `diagnostic_${req.diagnostic.id}`);
});

module.exports = router;
