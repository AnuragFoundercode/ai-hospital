const walletModel = require('../../models/user/wallet.model');
const paytmService = require('../../services/paytm.service');
const paytmConfig = require('../../config/paytm');
const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// USER WALLET CONTROLLER
// Tables: wallets + wallet_transactions
// ─────────────────────────────────────────────

/**
 * GET /api/v1/user/wallet
 */
const getWallet = async (req, res) => {
  try {
    const wallet = await walletModel.getWallet(req.user.id);
    return res.status(200).json({ message: 'Wallet fetched.', data: { balance: parseFloat(wallet.balance), is_active: wallet.is_active } });
  } catch (error) { console.error('getWallet error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * POST /api/v1/user/wallet/add
 * Body: { amount }
 * Initiates a Paytm transaction to add money. Wallet is credited after verify.
 */
const addMoney = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount } = req.body;
    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ message: 'Valid amount required.' });

    const amt = parseFloat(amount);
    const rechargeId = `WRC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await walletModel.getWallet(userId); // ensure wallet exists

    // TEST MODE: directly credit wallet without Paytm (enable via .env WALLET_TEST_MODE=true)
    if (String(process.env.WALLET_TEST_MODE).toLowerCase() === 'true') {
      const newBalance = await walletModel.credit(userId, amt, `Wallet recharge (test) - ${rechargeId}`, 'recharge', null, 'user');
      return res.status(201).json({ message: 'Money added to wallet (test mode).', data: { recharge_id: rechargeId, amount: amt, balance: newBalance, test_mode: true } });
    }

    let paytmData = null;
    try {
      const paytmResponse = await paytmService.initiateTransaction(rechargeId, amt, userId);
      if (paytmResponse.body && paytmResponse.body.txnToken) {
        paytmData = { txn_token: paytmResponse.body.txnToken, order_id: rechargeId, mid: paytmConfig.mid, amount: amt.toFixed(2), callback_url: paytmConfig.callbackUrl, website: paytmConfig.website, base_url: paytmConfig.baseUrl };
      } else {
        paytmData = { txn_token: null, order_id: rechargeId, mid: paytmConfig.mid, amount: amt.toFixed(2), error: paytmResponse.body?.resultInfo?.resultMsg || 'Token generation failed' };
      }
    } catch (e) {
      paytmData = { txn_token: null, order_id: rechargeId, mid: paytmConfig.mid, amount: amt.toFixed(2), error: e.message };
    }

    return res.status(201).json({ message: 'Complete payment to add money.', data: { recharge_id: rechargeId, amount: amt, payment: paytmData } });
  } catch (error) { console.error('addMoney error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * POST /api/v1/user/wallet/verify
 * Body: { recharge_id, amount }
 * Verifies Paytm payment and credits wallet on success.
 */
const verifyRecharge = async (req, res) => {
  try {
    const userId = req.user.id;
    const { recharge_id, amount } = req.body;
    if (!recharge_id || !amount) return res.status(400).json({ message: 'recharge_id and amount required.' });

    // Idempotency: if this recharge already credited, don't double-credit
    const [existing] = await pool.query(
      "SELECT id FROM wallet_transactions WHERE user_id = ? AND reference_type = 'recharge' AND description = ?",
      [userId, `Wallet recharge - ${recharge_id}`]
    );
    if (existing.length) {
      const wallet = await walletModel.getWallet(userId);
      return res.status(200).json({ message: 'Recharge already credited.', data: { balance: parseFloat(wallet.balance) } });
    }

    const paytmResponse = await paytmService.verifyTransaction(recharge_id);
    const resultStatus = paytmResponse.body?.resultInfo?.resultStatus;
    const txnId = paytmResponse.body?.txnId || null;

    if (resultStatus === 'TXN_SUCCESS') {
      const newBalance = await walletModel.credit(userId, parseFloat(amount), `Wallet recharge - ${recharge_id}`, 'recharge', null, 'user');
      return res.status(200).json({ message: 'Money added to wallet.', data: { balance: newBalance, transaction_id: txnId } });
    }

    return res.status(200).json({ message: 'Payment not completed yet.', data: { status: 'pending' } });
  } catch (error) { console.error('verifyRecharge error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/user/wallet/transactions?type=credit|debit&page=1&limit=20
 */
const getTransactions = async (req, res) => {
  try {
    const { type, page = 1, limit = 20 } = req.query;
    const result = await walletModel.getTransactions(req.user.id, { page: parseInt(page), limit: parseInt(limit), type });
    return res.status(200).json({
      message: 'Transactions fetched.',
      data: result.transactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: parseFloat(t.amount),
        description: t.description,
        reference_type: t.reference_type,
        balance_after: parseFloat(t.balance_after),
        created_at: t.created_at,
      })),
      pagination: { page: result.page, limit: result.limit, total: result.total, total_pages: Math.ceil(result.total / result.limit) },
    });
  } catch (error) { console.error('getTransactions error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = { getWallet, addMoney, verifyRecharge, getTransactions };
