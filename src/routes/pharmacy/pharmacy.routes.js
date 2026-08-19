const express = require('express');
const router = express.Router();
const pharmacyController = require('../../controllers/pharmacy/pharmacy.controller');
const inventoryController = require('../../controllers/pharmacy/inventory.controller');
const orderController = require('../../controllers/pharmacy/order.controller');
const dashboardController = require('../../controllers/pharmacy/dashboard.controller');
const walletController = require('../../controllers/pharmacy/wallet.controller');
const { registerClient } = require('../../events/sse');
const pharmacyAuth = require('../../middlewares/pharmacy/pharmacy.auth');

// Public
router.post('/register', pharmacyController.register);
router.post('/login', pharmacyController.login);
router.post('/forgot-password', pharmacyController.forgotPassword);
router.post('/reset-password', pharmacyController.resetPassword);

// Profile
router.get('/profile', pharmacyAuth, pharmacyController.getProfile);
router.put('/profile', pharmacyAuth, pharmacyController.updateProfile);
router.put('/change-password', pharmacyAuth, pharmacyController.changePassword);
router.get('/bank-details', pharmacyAuth, pharmacyController.getBankDetails);
router.put('/bank-details', pharmacyAuth, pharmacyController.updateBankDetails);

// Dashboard
router.get('/dashboard', pharmacyAuth, dashboardController.getDashboard);

// Inventory
router.get('/categories', pharmacyAuth, inventoryController.getCategories);
router.get('/brands', pharmacyAuth, inventoryController.getBrands);
router.get('/medicines', pharmacyAuth, inventoryController.getMedicines);
router.post('/medicines', pharmacyAuth, inventoryController.addMedicine);
router.put('/medicines/:id', pharmacyAuth, inventoryController.updateMedicine);
router.delete('/medicines/:id', pharmacyAuth, inventoryController.deleteMedicine);

// Orders
router.get('/orders', pharmacyAuth, orderController.getOrders);
router.get('/order/:order_id', pharmacyAuth, orderController.getOrderDetail);
router.put('/order/:order_id/accept', pharmacyAuth, orderController.acceptOrder);
router.put('/order/:order_id/reject', pharmacyAuth, orderController.rejectOrder);
router.put('/order/:order_id/status', pharmacyAuth, orderController.updateOrderStatus);

// Wallet
router.get('/wallet', pharmacyAuth, walletController.getWallet);
router.get('/wallet/transactions', pharmacyAuth, walletController.getTransactions);
router.post('/wallet/withdraw', pharmacyAuth, walletController.requestWithdrawal);
router.get('/wallet/withdrawals', pharmacyAuth, walletController.getWithdrawals);

// SSE
router.get('/events/stream', pharmacyAuth, async (req, res) => {
  registerClient(req, res, `pharmacy_${req.pharmacy.id}`);
  const { pool } = require('../../config/database');
  const [pending] = await pool.query("SELECT COUNT(*) as count FROM pharmacy_orders WHERE pharmacy_id = ? AND status = 'pending'", [req.pharmacy.id]);
  res.write(`event: initial\ndata: ${JSON.stringify({ pending_orders: pending[0].count })}\n\n`);
});

module.exports = router;
