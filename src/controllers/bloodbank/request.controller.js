const { pool } = require('../../config/database');
const notificationService = require('../../services/notification.service');
const distanceService = require('../../services/distance.service');
const { notify } = require('../../services/notify');
const { sendToClient } = require('../../events/sse');
const { recordCommission } = require('../../services/commission');

// ─────────────────────────────────────────────
// BLOOD BANK REQUEST MANAGEMENT
// ─────────────────────────────────────────────

// Create a blood_delivery_requests row (status 'searching') for a ready blood request
// and broadcast it to nearby online, approved blood delivery partners.
// Idempotent: skips if a live delivery request already exists for this blood request.
const createBloodDeliveryRequest = async (bankId, request) => {
  try {
    // Skip if already created / in progress
    const [existing] = await pool.query(
      "SELECT id FROM blood_delivery_requests WHERE blood_request_id = ? AND status NOT IN ('cancelled')",
      [request.id]
    );
    if (existing.length) return;

    const [bankRows] = await pool.query('SELECT latitude, longitude, address_line1, city FROM blood_banks WHERE id = ?', [bankId]);
    if (!bankRows.length) return;
    const bank = bankRows[0];

    const pickupLat = parseFloat(bank.latitude);
    const pickupLng = parseFloat(bank.longitude);
    const dropLat = parseFloat(request.drop_latitude);
    const dropLng = parseFloat(request.drop_longitude);
    if (!pickupLat || !pickupLng || !dropLat || !dropLng) return; // can't route without coords

    // Fee/distance already computed & paid by the user at request time.
    const [perKmRows] = await pool.query("SELECT config_value FROM admin_config WHERE config_key = 'blood_delivery_per_km_charge'");
    const perKmCharge = perKmRows.length ? parseFloat(perKmRows[0].config_value) : 15;
    const distanceKm = parseFloat(request.delivery_distance_km) || 0;
    const deliveryFee = parseFloat(request.delivery_fee) || 0;
    // Commission is deducted per-partner at accept time; earning shown as full fee until then.
    const deliveryEarning = deliveryFee;

    const deliveryReqId = `BDL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const [ins] = await pool.query(
      "INSERT INTO blood_delivery_requests (request_id, blood_request_id, blood_bank_id, pickup_address, pickup_latitude, pickup_longitude, drop_address, drop_latitude, drop_longitude, distance_km, per_km_charge, delivery_fee, delivery_earning, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'searching')",
      [deliveryReqId, request.id, bankId, `${bank.address_line1}, ${bank.city}`, pickupLat, pickupLng, request.drop_address || '', dropLat, dropLng, distanceKm.toFixed(2), perKmCharge, deliveryFee, deliveryEarning]
    );
    await pool.query('UPDATE blood_requests SET delivery_request_id = ? WHERE id = ?', [ins.insertId, request.id]);

    // Broadcast to nearby online approved blood delivery partners
    const [radiusRows] = await pool.query("SELECT config_value FROM admin_config WHERE config_key = 'blood_delivery_search_radius_km'");
    const searchRadius = radiusRows.length ? parseFloat(radiusRows[0].config_value) : 5;
    const [nearbyPartners] = await pool.query(
      "SELECT id, fcm_token FROM blood_delivery_partners WHERE is_online = 1 AND is_active = 1 AND verification_status = 'approved' AND latitude IS NOT NULL AND (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude)))) <= ?",
      [pickupLat, pickupLng, pickupLat, searchRadius]
    );

    for (const dp of nearbyPartners) {
      sendToClient(`blood_delivery_${dp.id}`, 'new_delivery_request', {
        request_id: deliveryReqId, pickup_address: `${bank.address_line1}, ${bank.city}`, distance_km: distanceKm.toFixed(2), earning: deliveryEarning,
      });
      await notify('blood_delivery_partner', dp.id, {
        title: 'New Blood Delivery 🩸',
        body: `₹${deliveryEarning} | ${distanceKm.toFixed(1)} km`,
        type: 'order', reference_type: 'blood_delivery_request', reference_id: ins.insertId, reference_code: deliveryReqId,
        data: { event: 'new_blood_delivery', request_id: deliveryReqId },
        fcmToken: dp.fcm_token,
      });
    }
  } catch (e) {
    console.error('createBloodDeliveryRequest error:', e.message);
  }
};

// Ensure the request has its units reserved (FEFO). Reserves only the shortfall,
// so it is safe to call whether or not the request was explicitly accepted.
const ensureReserved = async (bankId, bloodGroup, unitsRequired, requestId) => {
  // Count bags currently reserved for this blood group at this bank.
  // (Reservation is per group/bank pool; markComplete/markDelivered dispatch the same pool.)
  const [reserved] = await pool.query(
    "SELECT COUNT(*) AS c FROM bloodbank_inventory_items WHERE blood_bank_id = ? AND blood_group = ? AND status = 'reserved'",
    [bankId, bloodGroup]
  );
  const shortfall = unitsRequired - (reserved[0].c || 0);
  if (shortfall > 0) {
    await pool.query(
      `UPDATE bloodbank_inventory_items SET status = 'reserved'
       WHERE blood_bank_id = ? AND blood_group = ? AND status = 'available' AND expiry_date >= CURDATE()
       ORDER BY expiry_date ASC LIMIT ?`,
      [bankId, bloodGroup, shortfall]
    );
  }
};

// Recompute summary (available = non-expired available bags) after stock changes.
const refreshSummary = async (bankId, bloodGroup) => {
  const [s] = await pool.query(
    "SELECT COUNT(*) AS available, COALESCE(MAX(price_per_unit),0) AS price FROM bloodbank_inventory_items WHERE blood_bank_id = ? AND blood_group = ? AND status = 'available' AND expiry_date >= CURDATE()",
    [bankId, bloodGroup]
  );
  const available = s[0].available || 0;
  const price = parseFloat(s[0].price) || 0;
  const [exists] = await pool.query('SELECT id FROM bloodbank_inventory WHERE blood_bank_id = ? AND blood_group = ?', [bankId, bloodGroup]);
  if (exists.length) {
    await pool.query('UPDATE bloodbank_inventory SET available_units = ? WHERE blood_bank_id = ? AND blood_group = ?', [available, bankId, bloodGroup]);
  } else {
    await pool.query('INSERT INTO bloodbank_inventory (blood_bank_id, blood_group, available_units, price_per_unit) VALUES (?, ?, ?, ?)', [bankId, bloodGroup, available, price]);
  }
};

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
    // Accept from 'pending' (offline/online-unpaid) or 'confirmed' (online paid / offline auto-confirmed).
    // Reserving is idempotent-ish: we only reserve if this request has no reserved bags yet.
    if (!['pending', 'confirmed'].includes(rows[0].status)) return res.status(400).json({ message: `Cannot accept. Current status: ${rows[0].status}` });

    // Enough non-expired available bags? (1 bag = 1 unit)
    const [avail] = await pool.query(
      "SELECT COUNT(*) AS c FROM bloodbank_inventory_items WHERE blood_bank_id = ? AND blood_group = ? AND status = 'available' AND expiry_date >= CURDATE()",
      [bankId, rows[0].blood_group]
    );
    if (avail[0].c < rows[0].units_required) {
      return res.status(400).json({ message: `Not enough ${rows[0].blood_group} stock. Available: ${avail[0].c}, required: ${rows[0].units_required}.` });
    }

    // Reserve exactly units_required bags — FEFO (earliest expiry first). 1 row = 1 unit so LIMIT is correct.
    await pool.query(
      `UPDATE bloodbank_inventory_items SET status = 'reserved'
       WHERE blood_bank_id = ? AND blood_group = ? AND status = 'available' AND expiry_date >= CURDATE()
       ORDER BY expiry_date ASC LIMIT ?`,
      [bankId, rows[0].blood_group, rows[0].units_required]
    );

    await pool.query('UPDATE blood_requests SET status = ? WHERE id = ?', ['confirmed', rows[0].id]);
    await refreshSummary(bankId, rows[0].blood_group);

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

    // If was confirmed, release reserved units back to available
    if (rows[0].status === 'confirmed') {
      await pool.query(
        `UPDATE bloodbank_inventory_items SET status = 'available'
         WHERE blood_bank_id = ? AND blood_group = ? AND status = 'reserved'
         ORDER BY expiry_date ASC LIMIT ?`,
        [bankId, rows[0].blood_group, rows[0].units_required || 1]
      );
      await refreshSummary(bankId, rows[0].blood_group);
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
      'SELECT * FROM blood_requests WHERE request_id = ? AND blood_bank_id = ?',
      [request_id, bankId]
    );

    if (!rows.length) return res.status(404).json({ message: 'Request not found.' });
    if (rows[0].status !== 'confirmed') return res.status(400).json({ message: `Cannot mark ready. Current status: ${rows[0].status}` });

    const request = rows[0];
    await pool.query('UPDATE blood_requests SET status = ? WHERE id = ?', ['ready', request.id]);

    // Notify user
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [request.user_id]);
    if (userRows[0]?.fcm_token) {
      await notificationService.sendToDevice(userRows[0].fcm_token, 'Blood Ready 🩸', 'Your blood units are ready. A delivery partner will be assigned shortly.', { type: 'blood_ready', request_id });
    }

    // Make sure the units are reserved (covers requests confirmed via payment without an explicit accept)
    await ensureReserved(bankId, request.blood_group, request.units_required, request.id);
    await refreshSummary(bankId, request.blood_group);

    // Create a blood delivery request and broadcast to nearby blood delivery partners
    await createBloodDeliveryRequest(bankId, request);

    return res.status(200).json({ message: 'Marked as ready. Searching for a delivery partner.', data: { status: 'ready' } });
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

    // Admin commission ledger (direct pickup complete — no delivery leg)
    await recordCommission({ module: 'blood_bank', reference_type: 'blood_request', reference_id: rows[0].id, reference_code: request_id, user_id: rows[0].user_id, vendor_type: 'blood_bank', vendor_id: bankId, gross_amount: totalAmount, commission_percent: commissionPercent, commission_amount: adminCommission });

    // Refresh summary (available = non-expired available bags)
    await refreshSummary(bankId, rows[0].blood_group);

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
