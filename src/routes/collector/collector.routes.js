const express = require('express');
const router = express.Router();
const collectorController = require('../../controllers/collector/collector.controller');
const notificationController = require('../../controllers/notification.controller');
const { registerClient } = require('../../events/sse');
const collectorAuth = require('../../middlewares/collector/collector.auth');

// Public (OTP)
router.post('/send-otp', collectorController.sendOtp);
router.post('/verify-otp', collectorController.verifyOtp);

// Registration (step-wise)
router.put('/registration/step1', collectorAuth, collectorController.step1Personal);
router.put('/registration/step2', collectorAuth, collectorController.step2Experience);
router.put('/registration/step3', collectorAuth, collectorController.step3Documents);
router.put('/registration/step4', collectorAuth, collectorController.step4Bank);

// Profile & Status
router.get('/profile', collectorAuth, collectorController.getProfile);
router.put('/toggle-online', collectorAuth, collectorController.toggleOnline);
router.put('/location', collectorAuth, collectorController.updateLocation);

// Collection Requests
router.get('/active', collectorAuth, collectorController.getActiveCollection);
router.get('/requests', collectorAuth, collectorController.getRequests);
router.put('/request/:id/accept', collectorAuth, collectorController.acceptRequest);
router.put('/request/:id/reject', collectorAuth, collectorController.rejectRequest);
router.put('/request/:id/reached', collectorAuth, collectorController.markReachedPatient);
router.put('/request/:id/collected', collectorAuth, collectorController.markSampleCollected);
router.put('/request/:id/delivered', collectorAuth, collectorController.markDeliveredToLab);

// History & Earnings
router.get('/history', collectorAuth, collectorController.getHistory);
router.get('/earnings', collectorAuth, collectorController.getEarnings);

// Wallet
router.get('/wallet', collectorAuth, collectorController.getWallet);
router.get('/wallet/transactions', collectorAuth, collectorController.getTransactions);
router.post('/wallet/withdraw', collectorAuth, collectorController.requestWithdrawal);
router.get('/wallet/withdrawals', collectorAuth, collectorController.getWithdrawals);

// SSE
router.get('/events/stream', collectorAuth, (req, res) => {
  registerClient(req, res, `collector_${req.collector.id}`);
});

// Notifications
router.get('/notifications', collectorAuth, notificationController.list('sample_collector'));
router.put('/notifications/read-all', collectorAuth, notificationController.markAllRead('sample_collector'));
router.put('/notifications/:id/read', collectorAuth, notificationController.markRead('sample_collector'));

module.exports = router;
