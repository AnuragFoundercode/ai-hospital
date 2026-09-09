const express = require('express');
const router = express.Router();
const ambulanceController = require('../../controllers/ambulance/ambulance.controller');
const notificationController = require('../../controllers/notification.controller');
const { registerClient } = require('../../events/sse');
const ambulanceAuth = require('../../middlewares/ambulance/ambulance.auth');

// Vehicle types (for choosing during registration) — auth so partner is logged in
router.get('/vehicle-types', ambulanceAuth, ambulanceController.getVehicleTypes);

// Registration (step-wise)
router.put('/registration/step1', ambulanceAuth, ambulanceController.step1Personal);
router.put('/registration/step2', ambulanceAuth, ambulanceController.step2License);
router.put('/registration/step3', ambulanceAuth, ambulanceController.step3Vehicle);
router.put('/registration/step4', ambulanceAuth, ambulanceController.step4Bank);
router.put('/registration/step5', ambulanceAuth, ambulanceController.step5Documents);

// Profile & Status
router.get('/profile', ambulanceAuth, ambulanceController.getProfile);
router.put('/toggle-online', ambulanceAuth, ambulanceController.toggleOnline);
router.put('/location', ambulanceAuth, ambulanceController.updateLocation);

// Dashboard
router.get('/dashboard', ambulanceAuth, ambulanceController.getDashboard);

// Bookings / Rides
router.get('/requests', ambulanceAuth, ambulanceController.getRequests);
router.get('/active', ambulanceAuth, ambulanceController.getActiveRide);
router.put('/booking/:booking_id/accept', ambulanceAuth, ambulanceController.acceptBooking);
router.put('/booking/:booking_id/reject', ambulanceAuth, ambulanceController.rejectBooking);
router.put('/booking/:booking_id/status', ambulanceAuth, ambulanceController.updateStatus);

// Trip History
router.get('/trips', ambulanceAuth, ambulanceController.getTripHistory);
router.get('/trip/:booking_id', ambulanceAuth, ambulanceController.getTripDetail);

// Wallet
router.get('/wallet', ambulanceAuth, ambulanceController.getWallet);
router.get('/wallet/transactions', ambulanceAuth, ambulanceController.getTransactions);
router.post('/wallet/withdraw', ambulanceAuth, ambulanceController.requestWithdrawal);
router.get('/wallet/withdrawals', ambulanceAuth, ambulanceController.getWithdrawals);

// SSE
router.get('/events/stream', ambulanceAuth, (req, res) => {
  registerClient(req, res, `ambulance_${req.ambulance.id}`);
});

// Notifications
router.get('/notifications', ambulanceAuth, notificationController.list('ambulance_service'));
router.put('/notifications/read-all', ambulanceAuth, notificationController.markAllRead('ambulance_service'));
router.put('/notifications/:id/read', ambulanceAuth, notificationController.markRead('ambulance_service'));

module.exports = router;
