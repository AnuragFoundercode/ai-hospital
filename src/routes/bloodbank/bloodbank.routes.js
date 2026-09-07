const express = require('express');
const router = express.Router();
const bloodbankController = require('../../controllers/bloodbank/bloodbank.controller');
const inventoryController = require('../../controllers/bloodbank/inventory.controller');
const requestController = require('../../controllers/bloodbank/request.controller');
const dashboardController = require('../../controllers/bloodbank/dashboard.controller');
const walletController = require('../../controllers/bloodbank/wallet.controller');
const { registerClient } = require('../../events/sse');
const bloodbankAuth = require('../../middlewares/bloodbank/bloodbank.auth');

// ─────────────────────────────────────────────
// BLOOD BANK ROUTES
// ─────────────────────────────────────────────

// Public routes
router.post('/register', bloodbankController.register);
router.post('/login', bloodbankController.login);
router.post('/forgot-password', bloodbankController.forgotPassword);
router.post('/reset-password', bloodbankController.resetPassword);

// Protected routes (blood bank token required)
router.get('/profile', bloodbankAuth, bloodbankController.getProfile);
router.put('/profile', bloodbankAuth, bloodbankController.updateProfile);
router.put('/change-password', bloodbankAuth, bloodbankController.changePassword);

// Bank details
router.get('/bank-details', bloodbankAuth, bloodbankController.getBankDetails);
router.put('/bank-details', bloodbankAuth, bloodbankController.updateBankDetails);

// Dashboard
router.get('/dashboard', bloodbankAuth, dashboardController.getDashboard);

// Inventory Management
router.get('/inventory', bloodbankAuth, inventoryController.getInventoryItems);
router.get('/inventory/summary', bloodbankAuth, inventoryController.getInventorySummary);
router.get('/inventory/batch/:batch_number', bloodbankAuth, inventoryController.getBatchDetail);
router.post('/inventory', bloodbankAuth, inventoryController.addInventory);
router.get('/inventory/:id', bloodbankAuth, inventoryController.getInventoryItemDetail);
router.put('/inventory/:id', bloodbankAuth, inventoryController.updateInventoryItem);
router.delete('/inventory/:id', bloodbankAuth, inventoryController.deleteInventoryItem);

// Blood Requests Management
router.get('/requests', bloodbankAuth, requestController.getRequests);
router.get('/request/:request_id', bloodbankAuth, requestController.getRequestDetail);
router.put('/request/:request_id/accept', bloodbankAuth, requestController.acceptRequest);
router.put('/request/:request_id/reject', bloodbankAuth, requestController.rejectRequest);
router.put('/request/:request_id/ready', bloodbankAuth, requestController.markReady);
router.put('/request/:request_id/complete', bloodbankAuth, requestController.markComplete);

// Wallet & Earnings
router.get('/wallet', bloodbankAuth, walletController.getWallet);
router.get('/wallet/transactions', bloodbankAuth, walletController.getTransactions);
router.post('/wallet/withdraw', bloodbankAuth, walletController.requestWithdrawal);
router.get('/wallet/withdrawals', bloodbankAuth, walletController.getWithdrawals);

// SSE - Real-time booking notifications
router.get('/events/stream', bloodbankAuth, async (req, res) => {
  const clientKey = `bloodbank_${req.bloodbank.id}`;
  registerClient(req, res, clientKey);

  // Send pending requests count on connect
  const { pool } = require('../../config/database');
  const [pending] = await pool.query(
    "SELECT COUNT(*) as count FROM blood_requests WHERE blood_bank_id = ? AND status = 'pending'",
    [req.bloodbank.id]
  );
  res.write(`event: initial\ndata: ${JSON.stringify({ pending_requests: pending[0].count })}\n\n`);
});

module.exports = router;
