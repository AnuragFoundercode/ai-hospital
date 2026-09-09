const express = require('express');
const router = express.Router();
const bloodDeliveryController = require('../../controllers/blood-delivery/blood-delivery.controller');
const walletController = require('../../controllers/blood-delivery/wallet.controller');
const notificationController = require('../../controllers/notification.controller');
const { registerClient } = require('../../events/sse');
const bloodDeliveryAuth = require('../../middlewares/blood-delivery/blood-delivery.auth');

// Public (OTP)
router.post('/send-otp', bloodDeliveryController.sendOtp);
router.post('/verify-otp', bloodDeliveryController.verifyOtp);
router.get('/vehicle-types', bloodDeliveryController.getVehicleTypes);

// Registration (step-wise)
router.put('/registration/step1', bloodDeliveryAuth, bloodDeliveryController.step1Personal);
router.put('/registration/step2', bloodDeliveryAuth, bloodDeliveryController.step2Vehicle);
router.put('/registration/step3', bloodDeliveryAuth, bloodDeliveryController.step3Documents);
router.put('/registration/step4', bloodDeliveryAuth, bloodDeliveryController.step4Bank);

// Profile & Status
router.get('/profile', bloodDeliveryAuth, bloodDeliveryController.getProfile);
router.put('/toggle-online', bloodDeliveryAuth, bloodDeliveryController.toggleOnline);
router.put('/location', bloodDeliveryAuth, bloodDeliveryController.updateLocation);

// Delivery Requests
router.get('/active', bloodDeliveryAuth, bloodDeliveryController.getActiveDelivery);
router.get('/requests', bloodDeliveryAuth, bloodDeliveryController.getDeliveryRequests);
router.put('/request/:id/accept', bloodDeliveryAuth, bloodDeliveryController.acceptDelivery);
router.put('/request/:id/reject', bloodDeliveryAuth, bloodDeliveryController.rejectDelivery);
router.put('/request/:id/picked-up', bloodDeliveryAuth, bloodDeliveryController.markPickedUp);
router.put('/request/:id/reached', bloodDeliveryAuth, bloodDeliveryController.markReached);
router.put('/request/:id/delivered', bloodDeliveryAuth, bloodDeliveryController.markDelivered);

// History & Earnings
router.get('/history', bloodDeliveryAuth, bloodDeliveryController.getDeliveryHistory);
router.get('/earnings', bloodDeliveryAuth, bloodDeliveryController.getEarnings);

// Wallet
router.get('/wallet', bloodDeliveryAuth, walletController.getWallet);
router.get('/wallet/transactions', bloodDeliveryAuth, walletController.getTransactions);
router.post('/wallet/withdraw', bloodDeliveryAuth, walletController.requestWithdrawal);
router.get('/wallet/withdrawals', bloodDeliveryAuth, walletController.getWithdrawals);

// SSE
router.get('/events/stream', bloodDeliveryAuth, (req, res) => {
  registerClient(req, res, `blood_delivery_${req.bloodDelivery.id}`);
});

// Notifications
router.get('/notifications', bloodDeliveryAuth, notificationController.list('blood_delivery_partner'));
router.put('/notifications/read-all', bloodDeliveryAuth, notificationController.markAllRead('blood_delivery_partner'));
router.put('/notifications/:id/read', bloodDeliveryAuth, notificationController.markRead('blood_delivery_partner'));

module.exports = router;
