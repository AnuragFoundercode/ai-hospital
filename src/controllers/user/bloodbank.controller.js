const { pool } = require('../../config/database');
const paytmService = require('../../services/paytm.service');
const paytmConfig = require('../../config/paytm');
const distanceService = require('../../services/distance.service');

// ─────────────────────────────────────────────
// USER BLOOD BANK CONTROLLER
// ─────────────────────────────────────────────

/**
 * GET /api/v1/user/blood-banks?search=&city=&blood_group=&page=1&limit=10
 * Blood bank list
 */
const getBloodBankList = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, city, blood_group, pincode } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['bb.is_active = 1', 'bb.is_verified = 1'];
    let params = [];
    let join = '';

    if (search) {
      where.push('bb.name LIKE ?');
      params.push(`%${search}%`);
    }

    if (city) {
      where.push('bb.city = ?');
      params.push(city);
    }

    // Zone filter by pincode
    if (pincode) {
      const [zoneRows] = await pool.query("SELECT id FROM zones WHERE is_active = 1 AND JSON_CONTAINS(pincodes, ?)", [JSON.stringify(pincode)]);
      if (zoneRows.length) { where.push('bb.zone_id = ?'); params.push(zoneRows[0].id); }
      else { return res.status(200).json({ message: 'No service available in this pincode.', data: [], pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, total_pages: 0 } }); }
    }

    if (blood_group) {
      join = 'JOIN bloodbank_inventory bi ON bb.id = bi.blood_bank_id AND bi.blood_group = ? AND bi.available_units > 0';
      params.unshift(blood_group);
    }

    const whereClause = where.join(' AND ');

    const [countResult] = await pool.query(
      `SELECT COUNT(DISTINCT bb.id) as total FROM blood_banks bb ${join} WHERE ${whereClause}`, params
    );

    const [rows] = await pool.query(
      `SELECT DISTINCT bb.id, bb.uuid, bb.name, bb.profile_photo, bb.address_line1, bb.city, bb.state, bb.blood_bank_category, bb.is_24hours, bb.opening_time, bb.closing_time, bb.average_rating
       FROM blood_banks bb ${join}
       WHERE ${whereClause}
       ORDER BY bb.name
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Get total available units per bank
    const bankIds = rows.map(r => r.id);
    let inventoryMap = {};
    if (bankIds.length) {
      const placeholders = bankIds.map(() => '?').join(',');
      const [invRows] = await pool.query(
        `SELECT blood_bank_id, SUM(available_units) as total_units FROM bloodbank_inventory WHERE blood_bank_id IN (${placeholders}) GROUP BY blood_bank_id`, bankIds
      );
      for (const inv of invRows) {
        inventoryMap[inv.blood_bank_id] = inv.total_units;
      }
    }

    // Get available blood groups per bank
    let groupsMap = {};
    if (bankIds.length) {
      const placeholders = bankIds.map(() => '?').join(',');
      const [groupRows] = await pool.query(
        `SELECT blood_bank_id, blood_group, available_units FROM bloodbank_inventory WHERE blood_bank_id IN (${placeholders}) AND available_units > 0 ORDER BY blood_group`, bankIds
      );
      for (const g of groupRows) {
        if (!groupsMap[g.blood_bank_id]) groupsMap[g.blood_bank_id] = [];
        groupsMap[g.blood_bank_id].push(g.blood_group);
      }
    }

    return res.status(200).json({
      message: 'Blood banks fetched.',
      data: rows.map((r) => ({
        id: r.uuid,
        name: r.name,
        profile_photo: r.profile_photo,
        address: r.address_line1,
        city: r.city,
        state: r.state,
        category: r.blood_bank_category,
        is_24hours: r.is_24hours,
        opening_time: r.opening_time,
        closing_time: r.closing_time,
        available_units: inventoryMap[r.id] || 0,
        available_groups: groupsMap[r.id] || [],
        rating: r.average_rating,
        status: (inventoryMap[r.id] || 0) > 0 ? 'available' : 'unavailable',
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        total_pages: Math.ceil(countResult[0].total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('getBloodBankList error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/blood-bank/:id
 * Blood bank detail
 */
const getBloodBankDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      'SELECT * FROM blood_banks WHERE uuid = ? AND is_active = 1 AND is_verified = 1', [id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Blood bank not found.' });
    }

    const bank = rows[0];

    // Get reviews from blood_requests
    const [reviews] = await pool.query(
      `SELECT br.id, u.full_name, u.profile_photo FROM blood_requests br
       JOIN users u ON br.user_id = u.id
       WHERE br.blood_bank_id = ? AND br.status = 'completed'
       ORDER BY br.updated_at DESC LIMIT 10`,
      [bank.id]
    );

    return res.status(200).json({
      message: 'Blood bank detail fetched.',
      data: {
        id: bank.uuid,
        name: bank.name,
        contact_person: bank.contact_person,
        mobile: bank.mobile,
        email: bank.email,
        profile_photo: bank.profile_photo,
        category: bank.blood_bank_category,
        rating: bank.average_rating,
        about_description: bank.about_description || null,
        license_number: bank.license_number,
        location: {
          address: bank.address_line1,
          address_line2: bank.address_line2,
          landmark: bank.landmark,
          city: bank.city,
          state: bank.state,
          pincode: bank.pincode,
          latitude: bank.latitude,
          longitude: bank.longitude,
        },
        timing: {
          is_24hours: bank.is_24hours,
          opening_time: bank.opening_time,
          closing_time: bank.closing_time,
        },
        verification_status: bank.verification_status,
      },
    });
  } catch (error) {
    console.error('getBloodBankDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/blood-bank/:id/availability
 * Blood availability by blood bank - groups with units
 */
const getBloodAvailability = async (req, res) => {
  try {
    const { id } = req.params;

    const [bankRows] = await pool.query('SELECT id, uuid, name FROM blood_banks WHERE uuid = ? AND is_active = 1', [id]);
    if (!bankRows.length) {
      return res.status(404).json({ message: 'Blood bank not found.' });
    }

    const bankId = bankRows[0].id;

    // Live count — non-expired available bags per group (1 bag = 1 unit)
    const [inventory] = await pool.query(
      `SELECT blood_group, COUNT(*) AS available_units, COALESCE(MAX(price_per_unit), 0) AS price_per_unit
       FROM bloodbank_inventory_items
       WHERE blood_bank_id = ? AND status = 'available' AND expiry_date >= CURDATE()
       GROUP BY blood_group ORDER BY blood_group`,
      [bankId]
    );

    const totalUnits = inventory.reduce((sum, item) => sum + Number(item.available_units), 0);

    return res.status(200).json({
      message: 'Blood availability fetched.',
      data: {
        blood_bank_id: bankRows[0].uuid,
        blood_bank_name: bankRows[0].name,
        total_units: totalUnits,
        groups: inventory.map((item) => ({
          blood_group: item.blood_group,
          available_units: item.available_units,
          price_per_unit: item.price_per_unit,
          status: item.available_units > 0 ? 'available' : 'unavailable',
        })),
      },
    });
  } catch (error) {
    console.error('getBloodAvailability error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/user/blood-request
 * Request blood from a blood bank
 */
/**
 * GET /api/v1/user/blood-delivery-quote?blood_bank_id=<uuid>&drop_latitude=&drop_longitude=&blood_group=&units_required=
 * Pre-booking estimate: distance from blood bank to drop, delivery fee, and total.
 * Lets the user see the delivery charge before creating the request.
 */
const getBloodDeliveryQuote = async (req, res) => {
  try {
    const { blood_bank_id, drop_latitude, drop_longitude, blood_group, units_required = 1 } = req.query;
    if (!blood_bank_id || !drop_latitude || !drop_longitude) {
      return res.status(400).json({ message: 'Required: blood_bank_id, drop_latitude, drop_longitude' });
    }

    const [bankRows] = await pool.query('SELECT id, latitude, longitude FROM blood_banks WHERE uuid = ? AND is_active = 1 AND is_verified = 1', [blood_bank_id]);
    if (!bankRows.length) return res.status(404).json({ message: 'Blood bank not found.' });
    const bank = bankRows[0];

    const [perKmRows] = await pool.query("SELECT config_value FROM admin_config WHERE config_key = 'blood_delivery_per_km_charge'");
    const perKmCharge = perKmRows.length ? parseFloat(perKmRows[0].config_value) : 15;

    let distanceKm = 0;
    let deliveryFee = 0;
    if (parseFloat(bank.latitude) && parseFloat(bank.longitude)) {
      const dist = await distanceService.getDistance(parseFloat(bank.latitude), parseFloat(bank.longitude), parseFloat(drop_latitude), parseFloat(drop_longitude));
      distanceKm = dist.distance_km;
      deliveryFee = parseFloat((distanceKm * perKmCharge).toFixed(2));
    }

    // Optional blood amount preview if group provided
    let bloodAmount = null;
    if (blood_group) {
      const [availRows] = await pool.query(
        "SELECT COALESCE(MAX(price_per_unit), 0) AS price_per_unit FROM bloodbank_inventory_items WHERE blood_bank_id = ? AND blood_group = ? AND status = 'available' AND expiry_date >= CURDATE()",
        [bank.id, blood_group]
      );
      const pricePerUnit = parseFloat(availRows[0].price_per_unit) || 0;
      bloodAmount = parseFloat((pricePerUnit * parseInt(units_required)).toFixed(2));
    }

    return res.status(200).json({
      message: 'Delivery quote fetched.',
      data: {
        distance_km: distanceKm,
        per_km_charge: perKmCharge,
        delivery_fee: deliveryFee,
        blood_amount: bloodAmount,
        total: bloodAmount != null ? parseFloat((bloodAmount + deliveryFee).toFixed(2)) : null,
      },
    });
  } catch (error) {
    console.error('getBloodDeliveryQuote error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const requestBlood = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      blood_bank_id, patient_name, patient_age, patient_gender, hospital_name,
      blood_group, units_required, required_date, reason,
      attendant_name, attendant_mobile,
      doctor_prescription_url, blood_requirement_letter_url, patient_id_proof_url,
      drop_address, drop_latitude, drop_longitude,
      payment_method
    } = req.body;

    // Validate required (drop location needed to compute delivery fee & assign a rider)
    if (!blood_bank_id || !patient_name || !patient_age || !patient_gender || !hospital_name || !blood_group || !units_required || !required_date || !attendant_name || !attendant_mobile || !payment_method || !drop_address || !drop_latitude || !drop_longitude) {
      return res.status(400).json({ message: 'Required: blood_bank_id, patient_name, patient_age, patient_gender, hospital_name, blood_group, units_required, required_date, attendant_name, attendant_mobile, drop_address, drop_latitude, drop_longitude, payment_method' });
    }

    if (!['online', 'offline'].includes(payment_method)) {
      return res.status(400).json({ message: 'payment_method must be "online" or "offline".' });
    }

    // Get blood bank (with location for delivery distance)
    const [bankRows] = await pool.query('SELECT id, latitude, longitude FROM blood_banks WHERE uuid = ? AND is_active = 1 AND is_verified = 1', [blood_bank_id]);
    if (!bankRows.length) {
      return res.status(404).json({ message: 'Blood bank not found.' });
    }
    const bankId = bankRows[0].id;

    // Live availability check — count non-expired available bags (1 bag = 1 unit)
    const [availRows] = await pool.query(
      "SELECT COUNT(*) AS available_units, COALESCE(MAX(price_per_unit), 0) AS price_per_unit FROM bloodbank_inventory_items WHERE blood_bank_id = ? AND blood_group = ? AND status = 'available' AND expiry_date >= CURDATE()",
      [bankId, blood_group]
    );

    if (!availRows.length || availRows[0].available_units < units_required) {
      return res.status(400).json({ message: `${blood_group} blood not available in required quantity. Available: ${availRows.length ? availRows[0].available_units : 0} units.` });
    }

    const pricePerUnit = parseFloat(availRows[0].price_per_unit);
    const bloodAmount = pricePerUnit * units_required;

    // Distance-based delivery fee (blood bank -> drop). User pays this on top of the blood amount.
    const [perKmRows] = await pool.query("SELECT config_value FROM admin_config WHERE config_key = 'blood_delivery_per_km_charge'");
    const perKmCharge = perKmRows.length ? parseFloat(perKmRows[0].config_value) : 15;
    let deliveryDistanceKm = 0;
    let deliveryFee = 0;
    const bankLat = parseFloat(bankRows[0].latitude);
    const bankLng = parseFloat(bankRows[0].longitude);
    if (bankLat && bankLng && parseFloat(drop_latitude) && parseFloat(drop_longitude)) {
      const dist = await distanceService.getDistance(bankLat, bankLng, parseFloat(drop_latitude), parseFloat(drop_longitude));
      deliveryDistanceKm = dist.distance_km;
      deliveryFee = parseFloat((deliveryDistanceKm * perKmCharge).toFixed(2));
    }

    const totalAmount = parseFloat((bloodAmount + deliveryFee).toFixed(2));

    // Generate request ID
    const requestId = `BR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Create request
    const [result] = await pool.query(
      `INSERT INTO blood_requests (request_id, user_id, blood_bank_id, patient_name, patient_age, patient_gender, hospital_name, drop_address, drop_latitude, drop_longitude, blood_group, units_required, required_date, reason, attendant_name, attendant_mobile, doctor_prescription_url, blood_requirement_letter_url, patient_id_proof_url, price_per_unit, total_amount, delivery_distance_km, delivery_fee, payment_method, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [requestId, userId, bankId, patient_name, patient_age, patient_gender, hospital_name, drop_address, drop_latitude, drop_longitude, blood_group, units_required, required_date, reason || null, attendant_name, attendant_mobile, doctor_prescription_url || null, blood_requirement_letter_url || null, patient_id_proof_url || null, pricePerUnit, totalAmount, deliveryDistanceKm, deliveryFee, payment_method, payment_method === 'offline' ? 'confirmed' : 'pending']
    );

    const amountBreakdown = {
      blood_amount: bloodAmount,
      delivery_fee: deliveryFee,
      delivery_distance_km: deliveryDistanceKm,
      per_km_charge: perKmCharge,
      total: totalAmount,
    };

    // Send SSE event to blood bank (only meaningful for offline; online notified after payment)
    if (payment_method === 'offline') {
      const { sendToClient } = require('../../events/sse');
      sendToClient(`bloodbank_${bankId}`, 'new_request', {
        request_id: requestId,
        patient_name,
        hospital_name,
        blood_group,
        units_required,
        required_date,
        total_amount: totalAmount,
        payment_method,
      });
    }

    // OFFLINE → direct confirm
    if (payment_method === 'offline') {
      return res.status(201).json({
        message: 'Blood request submitted! Pay at blood bank.',
        data: {
          request_id: requestId,
          blood_group,
          units_required,
          amount: amountBreakdown,
          total_amount: totalAmount,
          payment_method: 'offline',
          status: 'confirmed',
          payment_status: 'unpaid',
          payment: null,
        },
      });
    }

    // ONLINE → Paytm
    let paytmData = null;
    try {
      const paytmResponse = await paytmService.initiateTransaction(requestId, totalAmount, userId);
      if (paytmResponse.body && paytmResponse.body.txnToken) {
        paytmData = { txn_token: paytmResponse.body.txnToken, order_id: requestId, mid: paytmConfig.mid, amount: totalAmount.toFixed(2), callback_url: paytmConfig.callbackUrl, website: paytmConfig.website, base_url: paytmConfig.baseUrl };
      } else {
        paytmData = { txn_token: null, order_id: requestId, mid: paytmConfig.mid, amount: totalAmount.toFixed(2), callback_url: paytmConfig.callbackUrl, website: paytmConfig.website, base_url: paytmConfig.baseUrl, error: paytmResponse.body?.resultInfo?.resultMsg || 'Failed' };
      }
    } catch (paytmError) {
      paytmData = { txn_token: null, order_id: requestId, mid: paytmConfig.mid, amount: totalAmount.toFixed(2), callback_url: paytmConfig.callbackUrl, website: paytmConfig.website, base_url: paytmConfig.baseUrl, error: paytmError.message };
    }

    return res.status(201).json({
      message: 'Blood request created. Complete payment.',
      data: {
        request_id: requestId,
        blood_group,
        units_required,
        amount: amountBreakdown,
        total_amount: totalAmount,
        payment_method: 'online',
        status: 'pending',
        payment_status: 'unpaid',
        payment: paytmData,
      },
    });
  } catch (error) {
    console.error('requestBlood error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/blood-requests?status=active|completed|rejected
 * Blood request history
 */
const getBloodRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    let where = ['br.user_id = ?'];
    let params = [userId];

    if (status === 'active') {
      where.push("br.status IN ('pending', 'confirmed', 'ready')");
    } else if (status === 'completed') {
      where.push("br.status = 'completed'");
    } else if (status === 'rejected') {
      where.push("br.status IN ('rejected', 'cancelled')");
    }

    const whereClause = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT br.request_id, br.status, br.blood_group, br.units_required, br.required_date, br.total_amount, br.payment_status, br.hospital_name, br.created_at,
              bb.uuid as bank_uuid, bb.name as bank_name
       FROM blood_requests br
       JOIN blood_banks bb ON br.blood_bank_id = bb.id
       WHERE ${whereClause}
       ORDER BY br.created_at DESC`,
      params
    );

    return res.status(200).json({
      message: 'Blood requests fetched.',
      data: rows.map((r) => ({
        request_id: r.request_id,
        status: r.status,
        blood_group: r.blood_group,
        units_required: r.units_required,
        required_date: r.required_date,
        total_amount: r.total_amount,
        payment_status: r.payment_status,
        hospital_name: r.hospital_name,
        blood_bank: {
          id: r.bank_uuid,
          name: r.bank_name,
        },
        created_at: r.created_at,
      })),
    });
  } catch (error) {
    console.error('getBloodRequests error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/blood-request/:request_id
 * Blood request detail
 */
const getBloodRequestDetail = async (req, res) => {
  try {
    const userId = req.user.id;
    const { request_id } = req.params;

    const [rows] = await pool.query(
      `SELECT br.*, bb.uuid as bank_uuid, bb.name as bank_name, bb.mobile as bank_mobile, bb.address_line1 as bank_address, bb.city as bank_city
       FROM blood_requests br
       JOIN blood_banks bb ON br.blood_bank_id = bb.id
       WHERE br.request_id = ? AND br.user_id = ?`,
      [request_id, userId]
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
        rejection_reason: r.rejection_reason,
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
        blood_bank: {
          id: r.bank_uuid,
          name: r.bank_name,
          mobile: r.bank_mobile,
          address: r.bank_address,
          city: r.bank_city,
        },
        created_at: r.created_at,
      },
    });
  } catch (error) {
    console.error('getBloodRequestDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getBloodBankList,
  getBloodBankDetail,
  getBloodAvailability,
  getBloodDeliveryQuote,
  requestBlood,
  getBloodRequests,
  getBloodRequestDetail,
};
