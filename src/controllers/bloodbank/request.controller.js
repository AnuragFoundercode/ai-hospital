const { pool } = require('../../config/database');
const notificationService = require('../../services/notification.service');

// ─────────────────────────────────────────────
// BLOOD BANK REQUEST MANAGEMENT
// ─────────────────────────────────────────────

/**
 * GET /api/v1/bloodbank/requests?status=pending|confirmed|ready|completed|rejected&page=1&limit=20
 */
const getRequests = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['br.blood_bank_id = ?'];
    let params = [bankId];

    if (status) {
      where.push('br.status = ?');
      params.push(status);
    }

    const whereClause = where.join(' AND ');

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM blood_requests br WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT br.request_id, br.patient_name, br.hospital_name, br.blood_group, br.units_required, br.required_date, br.status, br.total_amount, br.payment_status, br.payment_method, br.created_at,
              u.full_name as user_name, u.mobile as user_mobile
       FROM blood_requests br
       JOIN users u ON br.user_id = u.id
       WHERE ${whereClause}
       ORDER BY br.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Requests fetched.',
      data: rows.map((r) => ({
        request_id: r.request_id,
        patient_name: r.patient_name,
        hospital_name: r.hospital_name,
        blood_group: r.blood_group,
        units_required: r.units_required,
        required_date: r.required_date,
        status: r.status,
        total_amount: r.total_amount,
        payment_status: r.payment_status,
        payment_method: r.payment_method,
        requested_by: r.user_name,
        user_mobile: r.user_mobile,
        created_at: r.created_at,
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('bloodbank getRequests error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/bloodbank/request/:request_id
 */
const getRequestDetail = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const { request_id } = req.params;

    const [rows] = await pool.query(
      `SELECT br.*, u.full_name as user_name, u.mobile as user_mobile, u.email as user_email
       FROM blood_requests br
       JOIN users u ON br.user_id = u.id
       WHERE br.request_id = ? AND br.blood_bank_id = ?`,
      [request_id, bankId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Request not found.' });
    }

    const r = rows[0];

    return res.status(200).json({
      message: 'Request detail fetched.',
      data: {
        request_id: r.request_id,
        status: r.status,
        patient: {
          name: r.patient_name,
          age: r.patient_age,
          gender: r.patient_gender,
          hospital_name: r.hospital_name,
        },
        blood_requirement: {
          blood_group: r.blood_group,
          units_required: r.units_required,
          required_date: r.required_date,
          reason: r.reason,
        },
        attendant: {
          name: r.attendant_name,
          mobile: r.attendant_mobile,
        },
        documents: {
          doctor_prescription_url: r.doctor_prescription_url,
          blood_requirement_letter_url: r.blood_requirement_letter_url,
          patient_id_proof_url: r.patient_id_proof_url,
        },
        payment: {
          price_per_unit: r.price_per_unit,
          total_amount: r.total_amount,
          payment_method: r.payment_method,
          payment_status: r.payment_status,
          transaction_id: r.transaction_id,
          paid_at: r.paid_at,
        },
        requested_by: {
          name: r.user_name,
          mobile: r.user_mobile,
          email: r.user_email,
        },
        rejection_reason: r.rejection_reason,
        created_at: r.created_at,
        updated_at: r.updated_at,
      },
    });
  } catch (error) {
    console.error('bloodbank getRequestDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/bloodbank/request/:request_id/accept
 */
const acceptRequest = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const { request_id } = req.params;

    const [rows] = await pool.query(
      'SELECT id, status, blood_group, units_required, user_id FROM blood_requests WHERE request_id = ? AND blood_bank_id = ?',
      [request_id, bankId]
    );

    if (!rows.length) return res.status(404).json({ message: 'Request not found.' });
    if (rows[0].status !== 'pending') return res.status(400).json({ message: `Cannot accept. Current status: ${rows[0].status}` });

    // Reserve units in inventory
    await pool.query(
      `UPDATE bloodbank_inventory_items SET status = 'reserved' 
       WHERE blood_bank_id = ? AND blood_group = ? AND status = 'available' 
       ORDER BY expiry_date ASC LIMIT ?`,
      [bankId, rows[0].blood_group, rows[0].units_required]
    );

    await pool.query('UPDATE blood_requests SET status = ? WHERE id = ?', ['confirmed', rows[0].id]);

    // Notify user
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [rows[0].user_id]);
    if (userRows[0]?.fcm_token) {
      await notificationService.sendToDevice(userRows[0].fcm_token, 'Blood Request Accepted ✅', `Your ${rows[0].blood_group} blood request has been accepted.`, { type: 'blood_request_accepted', request_id });
    }

    return res.status(200).json({ message: 'Request accepted.', data: { status: 'confirmed' } });
  } catch (error) {
    console.error('acceptRequest error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/bloodbank/request/:request_id/reject
 * Body: { reason }
 */
const rejectRequest = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const { request_id } = req.params;
    const { reason } = req.body;

    const [rows] = await pool.query(
      'SELECT id, status, user_id, blood_group FROM blood_requests WHERE request_id = ? AND blood_bank_id = ?',
      [request_id, bankId]
    );

    if (!rows.length) return res.status(404).json({ message: 'Request not found.' });
    if (!['pending', 'confirmed'].includes(rows[0].status)) return res.status(400).json({ message: `Cannot reject. Current status: ${rows[0].status}` });

    await pool.query('UPDATE blood_requests SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', reason || null, rows[0].id]);

    // If was confirmed, release reserved units
    if (rows[0].status === 'confirmed') {
      await pool.query(
        `UPDATE bloodbank_inventory_items SET status = 'available' 
         WHERE blood_bank_id = ? AND blood_group = ? AND status = 'reserved' 
         ORDER BY expiry_date ASC LIMIT ?`,
        [bankId, rows[0].blood_group, rows[0].units_required || 1]
      );
    }

    // Notify user
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [rows[0].user_id]);
    if (userRows[0]?.fcm_token) {
      await notificationService.sendToDevice(userRows[0].fcm_token, 'Blood Request Rejected ❌', `Your blood request was rejected. ${reason || ''}`, { type: 'blood_request_rejected', request_id });
    }

    return res.status(200).json({ message: 'Request rejected.', data: { status: 'rejected' } });
  } catch (error) {
    console.error('rejectRequest error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/bloodbank/request/:request_id/ready
 */
const markReady = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const { request_id } = req.params;

    const [rows] = await pool.query(
      'SELECT id, status, user_id FROM blood_requests WHERE request_id = ? AND blood_bank_id = ?',
      [request_id, bankId]
    );

    if (!rows.length) return res.status(404).json({ message: 'Request not found.' });
    if (rows[0].status !== 'confirmed') return res.status(400).json({ message: `Cannot mark ready. Current status: ${rows[0].status}` });

    await pool.query('UPDATE blood_requests SET status = ? WHERE id = ?', ['ready', rows[0].id]);

    // Notify user
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [rows[0].user_id]);
    if (userRows[0]?.fcm_token) {
      await notificationService.sendToDevice(userRows[0].fcm_token, 'Blood Ready for Pickup 🩸', 'Your blood units are ready. Please collect from blood bank.', { type: 'blood_ready', request_id });
    }

    return res.status(200).json({ message: 'Marked as ready.', data: { status: 'ready' } });
  } catch (error) {
    console.error('markReady error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/bloodbank/request/:request_id/complete
 */
const markComplete = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const { request_id } = req.params;

    const [rows] = await pool.query(
      'SELECT id, status, blood_group, units_required, user_id, payment_method FROM blood_requests WHERE request_id = ? AND blood_bank_id = ?',
      [request_id, bankId]
    );

    if (!rows.length) return res.status(404).json({ message: 'Request not found.' });
    if (!['confirmed', 'ready'].includes(rows[0].status)) return res.status(400).json({ message: `Cannot complete. Current status: ${rows[0].status}` });

    // Mark dispatched in inventory
    await pool.query(
      `UPDATE bloodbank_inventory_items SET status = 'dispatched' 
       WHERE blood_bank_id = ? AND blood_group = ? AND status = 'reserved' 
       ORDER BY expiry_date ASC LIMIT ?`,
      [bankId, rows[0].blood_group, rows[0].units_required]
    );

    // Update request status + payment (offline = mark paid)
    const updates = { status: 'completed' };
    if (rows[0].payment_method === 'offline') {
      await pool.query('UPDATE blood_requests SET status = ?, payment_status = ?, paid_at = NOW() WHERE id = ?', ['completed', 'paid', rows[0].id]);
    } else {
      await pool.query('UPDATE blood_requests SET status = ? WHERE id = ?', ['completed', rows[0].id]);
    }

    // Credit wallet (total - admin commission)
    const [bankRow] = await pool.query('SELECT admin_commission_percent FROM blood_banks WHERE id = ?', [bankId]);
    const commissionPercent = bankRow[0]?.admin_commission_percent || 15;

    const [reqRow] = await pool.query('SELECT total_amount FROM blood_requests WHERE id = ?', [rows[0].id]);
    const totalAmount = parseFloat(reqRow[0].total_amount);
    const adminCommission = totalAmount * (commissionPercent / 100);
    const bankEarning = totalAmount - adminCommission;

    // Ensure wallet exists
    const [walletExists] = await pool.query('SELECT id FROM bloodbank_wallets WHERE blood_bank_id = ?', [bankId]);
    if (!walletExists.length) {
      await pool.query('INSERT INTO bloodbank_wallets (blood_bank_id) VALUES (?)', [bankId]);
    }

    // Update wallet
    await pool.query(
      'UPDATE bloodbank_wallets SET balance = balance + ?, total_earned = total_earned + ? WHERE blood_bank_id = ?',
      [bankEarning, bankEarning, bankId]
    );

    // Get new balance
    const [walletRow] = await pool.query('SELECT balance FROM bloodbank_wallets WHERE blood_bank_id = ?', [bankId]);

    // Add transaction
    await pool.query(
      `INSERT INTO bloodbank_wallet_transactions (blood_bank_id, type, amount, description, reference_type, reference_id, admin_commission, balance_after) VALUES (?, 'credit', ?, ?, 'blood_request_fee', ?, ?, ?)`,
      [bankId, bankEarning, `Blood request ${request_id} completed. Commission: ₹${adminCommission.toFixed(2)}`, rows[0].id, adminCommission, walletRow[0].balance]
    );

    // Update summary table
    const [summary] = await pool.query(
      `SELECT SUM(CASE WHEN status = 'available' THEN units ELSE 0 END) as available
       FROM bloodbank_inventory_items WHERE blood_bank_id = ? AND blood_group = ?`,
      [bankId, rows[0].blood_group]
    );
    await pool.query('UPDATE bloodbank_inventory SET available_units = ? WHERE blood_bank_id = ? AND blood_group = ?',
      [summary[0].available || 0, bankId, rows[0].blood_group]);

    // Notify user
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [rows[0].user_id]);
    if (userRows[0]?.fcm_token) {
      await notificationService.sendToDevice(userRows[0].fcm_token, 'Blood Dispatched ✅', 'Your blood units have been dispatched successfully.', { type: 'blood_completed', request_id });
    }

    return res.status(200).json({ message: 'Request completed.', data: { status: 'completed' } });
  } catch (error) {
    console.error('markComplete error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getRequests,
  getRequestDetail,
  acceptRequest,
  rejectRequest,
  markReady,
  markComplete,
};
