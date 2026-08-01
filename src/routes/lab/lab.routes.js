const express = require('express');
const router = express.Router();
const labController = require('../../controllers/lab/lab.controller');
const walletController = require('../../controllers/lab/wallet.controller');
const bookingController = require('../../controllers/lab/booking.controller');
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

// Bookings
router.get('/bookings', labAuth, bookingController.getBookings);
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

module.exports = router;
