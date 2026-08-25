const express = require('express');
const router = express.Router();
const deliveryController = require('../../controllers/delivery/delivery.controller');
const walletController = require('../../controllers/delivery/wallet.controller');
const { registerClient } = require('../../events/sse');
const deliveryAuth = require('../../middlewares/delivery/delivery.auth');

// Public (OTP)
router.post('/send-otp', deliveryController.sendOtp);
router.post('/verify-otp', deliveryController.verifyOtp);
router.get('/vehicle-types', deliveryController.getVehicleTypes);

// Registration (step-wise)
router.put('/registration/step1', deliveryAuth, deliveryController.step1Personal);
router.put('/registration/step2', deliveryAuth, deliveryController.step2Vehicle);
router.put('/registration/step3', deliveryAuth, deliveryController.step3Documents);
router.put('/registration/step4', deliveryAuth, deliveryController.step4Bank);

// Profile & Status
router.get('/profile', deliveryAuth, deliveryController.getProfile);
router.put('/toggle-online', deliveryAuth, deliveryController.toggleOnline);
router.put('/location', deliveryAuth, deliveryController.updateLocation);

// Delivery Requests
router.get('/active', deliveryAuth, deliveryController.getActiveDelivery);
router.get('/requests', deliveryAuth, deliveryController.getDeliveryRequests);
router.put('/request/:id/accept', deliveryAuth, deliveryController.acceptDelivery);
router.put('/request/:id/reject', deliveryAuth, deliveryController.rejectDelivery);
router.put('/request/:id/picked-up', deliveryAuth, deliveryController.markPickedUp);
router.put('/request/:id/reached', deliveryAuth, deliveryController.markReached);
router.put('/request/:id/delivered', deliveryAuth, deliveryController.markDelivered);

// History & Earnings
router.get('/history', deliveryAuth, deliveryController.getDeliveryHistory);
router.get('/earnings', deliveryAuth, deliveryController.getEarnings);

// Wallet
router.get('/wallet', deliveryAuth, walletController.getWallet);
router.get('/wallet/transactions', deliveryAuth, walletController.getTransactions);
router.post('/wallet/withdraw', deliveryAuth, walletController.requestWithdrawal);
router.get('/wallet/withdrawals', deliveryAuth, walletController.getWithdrawals);

// SSE
router.get('/events/stream', deliveryAuth, (req, res) => {
  registerClient(req, res, `delivery_${req.delivery.id}`);
});

module.exports = router;
