const express = require('express');
const router = express.Router();
const labController = require('../../controllers/lab/lab.controller');
const walletController = require('../../controllers/lab/wallet.controller');
const bookingController = require('../../controllers/lab/booking.controller');
const dashboardController = require('../../controllers/lab/dashboard.controller');
const testController = require('../../controllers/lab/test.controller');
const notificationController = require('../../controllers/notification.controller');
const { registerClient } = require('../../events/sse');
const labAuth = require('../../middlewares/lab/lab.auth');

// ─────────────────────────────────────────────
// LAB ROUTES - Lab Panel APIs
// ─────────────────────────────────────────────

// Public routes
router.post('/register', labController.register);
router.post('/login', labController.login);
router.post('/forgot-password', labController.forgotPassword);
router.post('/reset-password', labController.resetPassword);

// Protected routes (lab token required)
router.get('/profile', labAuth, labController.getProfile);
router.put('/profile', labAuth, labController.updateProfile);
router.put('/change-password', labAuth, labController.changePassword);

// Dashboard
router.get('/dashboard', labAuth, dashboardController.getDashboard);
router.get('/analytics/revenue', labAuth, dashboardController.getRevenueTrend);
router.get('/analytics/bookings', labAuth, dashboardController.getBookingTrend);

// Test Management
router.get('/tests', labAuth, testController.getMyTests);
router.get('/tests/master', labAuth, testController.getMasterTests);
router.get('/tests/categories', labAuth, testController.getTestCategories);
router.post('/tests', labAuth, testController.addTest);
router.put('/tests/:id', labAuth, testController.updateTest);
router.delete('/tests/:id', labAuth, testController.removeTest);

// Bookings
router.get('/bookings', labAuth, bookingController.getBookings);
router.get('/booking/:booking_id', labAuth, bookingController.getBookingDetail);
router.put('/booking/:booking_id/notes', labAuth, bookingController.updateNotes);
router.put('/booking/:booking_id/accept', labAuth, bookingController.acceptBooking);
router.put('/booking/:booking_id/reject', labAuth, bookingController.rejectBooking);
router.put('/booking/:booking_id/processing', labAuth, bookingController.startProcessing);
router.put('/booking/:booking_id/complete', labAuth, bookingController.completeBooking);
router.put('/booking/:booking_id/upload-report', labAuth, bookingController.uploadReport);

// Wallet
router.get('/wallet', labAuth, walletController.getWallet);
router.get('/wallet/transactions', labAuth, walletController.getTransactions);
router.post('/wallet/withdraw', labAuth, walletController.requestWithdrawal);
router.get('/wallet/withdrawals', labAuth, walletController.getWithdrawals);

// Bank details
router.get('/bank-details', labAuth, walletController.getBankDetails);
router.put('/bank-details', labAuth, walletController.updateBankDetails);

// SSE - Real-time booking notifications
router.get('/events/stream', labAuth, async (req, res) => {
  const clientKey = `lab_${req.lab.id}`;
  registerClient(req, res, clientKey);

  // Send pending bookings count on connect
  const { pool } = require('../../config/database');
  const [pending] = await pool.query(
    "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND status = 'confirmed'",
    [req.lab.id]
  );
  res.write(`event: initial\ndata: ${JSON.stringify({ pending_bookings: pending[0].count })}\n\n`);
});

// Notifications
router.get('/notifications', labAuth, notificationController.list('pathology_lab'));
router.put('/notifications/read-all', labAuth, notificationController.markAllRead('pathology_lab'));
router.put('/notifications/:id/read', labAuth, notificationController.markRead('pathology_lab'));

module.exports = router;
