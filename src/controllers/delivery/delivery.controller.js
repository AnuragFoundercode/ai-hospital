const jwt = require('jsonwebtoken');
const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');
const notificationService = require('../../services/notification.service');

// ─────────────────────────────────────────────
// DELIVERY PARTNER CONTROLLER
// ─────────────────────────────────────────────

const STATIC_OTP = '111111';

/**
 * POST /api/v1/delivery/send-otp
 */
const sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ message: 'Valid 10-digit mobile required.' });

    const [existing] = await pool.query('SELECT id FROM delivery_partners WHERE mobile = ?', [mobile]);
    if (!existing.length) {
      const uuid = uuidv4();
      await pool.query('INSERT INTO delivery_partners (uuid, mobile) VALUES (?, ?)', [uuid, mobile]);
    }

    console.log(`📱 Delivery OTP for ${mobile}: ${STATIC_OTP}`);
    return res.status(200).json({ message: 'OTP sent.', data: { mobile } });
  } catch (error) {
    console.error('delivery sendOtp error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/delivery/verify-otp
 */
const verifyOtp = async (req, res) => {
  try {
    const { mobile, otp, fcm_token } = req.body;
    if (!mobile || !otp) return res.status(400).json({ message: 'Mobile and OTP required.' });
    if (otp !== STATIC_OTP) return res.status(400).json({ message: 'Invalid OTP.' });

    const [rows] = await pool.query('SELECT * FROM delivery_partners WHERE mobile = ?', [mobile]);
    if (!rows.length) return res.status(404).json({ message: 'Partner not found. Send OTP first.' });

    const partner = rows[0];
    if (fcm_token) await pool.query('UPDATE delivery_partners SET fcm_token = ?, is_verified_mobile = 1 WHERE id = ?', [fcm_token, partner.id]);
    else await pool.query('UPDATE delivery_partners SET is_verified_mobile = 1 WHERE id = ?', [partner.id]);

    const is_new_user = !partner.full_name || partner.full_name.trim() === '';
    const token = jwt.sign({ id: partner.id, uuid: partner.uuid, role: 'delivery' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

    return res.status(200).json({
      message: is_new_user ? 'OTP verified. Complete your profile.' : 'Login successful.',
      data: {
        token,
        role: 'delivery',
        is_new_user,
        registration_step: partner.registration_step || 0,
        verification_status: partner.verification_status,
        partner: { id: partner.uuid, full_name: partner.full_name, mobile: partner.mobile, profile_photo: partner.profile_photo },
      },
    });
  } catch (error) {
    console.error('delivery verifyOtp error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/delivery/registration/step1
 * Body: { full_name, email, date_of_birth, gender, profile_photo }
 */
const step1Personal = async (req, res) => {
  try {
    const { full_name, email, date_of_birth, gender, profile_photo } = req.body;
    if (!full_name) return res.status(400).json({ message: 'full_name required.' });

    await pool.query(
      'UPDATE delivery_partners SET full_name = ?, email = ?, date_of_birth = ?, gender = ?, profile_photo = ?, registration_step = GREATEST(registration_step, 1) WHERE id = ?',
      [full_name, email || null, date_of_birth || null, gender || null, profile_photo || null, req.delivery.id]
    );

    return res.status(200).json({ message: 'Step 1 saved.', data: { registration_step: 1 } });
  } catch (error) {
    console.error('delivery step1 error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/delivery/vehicle-types
 */
const getVehicleTypes = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, icon_url FROM vehicle_types WHERE is_active = 1 ORDER BY id');
    return res.status(200).json({ message: 'Vehicle types fetched.', data: rows });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * PUT /api/v1/delivery/registration/step2
 * Body: { vehicle_type_id, rc_number, dl_number, zone_id }
 */
const step2Vehicle = async (req, res) => {
  try {
    const { vehicle_type_id, vehicle_type, rc_number, dl_number, zone_id } = req.body;
    if (!rc_number || !dl_number) return res.status(400).json({ message: 'rc_number, dl_number required.' });
    if (!vehicle_type_id && !vehicle_type) return res.status(400).json({ message: 'vehicle_type_id required.' });

    await pool.query(
      'UPDATE delivery_partners SET vehicle_type = ?, vehicle_type_id = ?, rc_number = ?, dl_number = ?, zone_id = ?, registration_step = GREATEST(registration_step, 2) WHERE id = ?',
      [vehicle_type || null, vehicle_type_id || null, rc_number, dl_number, zone_id || null, req.delivery.id]
    );

    return res.status(200).json({ message: 'Step 2 saved.', data: { registration_step: 2 } });
  } catch (error) {
    console.error('delivery step2 error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/delivery/registration/step3
 * Body: { aadhaar_front_url, aadhaar_back_url, pan_card_url, driving_licence_url, rider_selfie_url }
 */
const step3Documents = async (req, res) => {
  try {
    const { aadhaar_front_url, aadhaar_back_url, pan_card_url, driving_licence_url, rider_selfie_url } = req.body;
    if (!aadhaar_front_url || !aadhaar_back_url || !driving_licence_url || !rider_selfie_url) {
      return res.status(400).json({ message: 'Required: aadhaar_front_url, aadhaar_back_url, driving_licence_url, rider_selfie_url' });
    }

    await pool.query(
      "UPDATE delivery_partners SET aadhaar_front_url = ?, aadhaar_back_url = ?, pan_card_url = ?, driving_licence_url = ?, rider_selfie_url = ?, registration_step = GREATEST(registration_step, 3) WHERE id = ?",
      [aadhaar_front_url, aadhaar_back_url, pan_card_url || null, driving_licence_url, rider_selfie_url, req.delivery.id]
    );

    return res.status(200).json({ message: 'Documents uploaded.', data: { registration_step: 3 } });
  } catch (error) {
    console.error('delivery step3 error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/delivery/registration/step4
 * Body: { account_holder_name, bank_name, account_number, ifsc_code }
 */
const step4Bank = async (req, res) => {
  try {
    const { account_holder_name, bank_name, account_number, ifsc_code } = req.body;
    if (!account_holder_name || !bank_name || !account_number || !ifsc_code) {
      return res.status(400).json({ message: 'All bank fields required: account_holder_name, bank_name, account_number, ifsc_code' });
    }

    const partnerId = req.delivery.id;

    const [existing] = await pool.query('SELECT id FROM delivery_bank_details WHERE delivery_partner_id = ?', [partnerId]);
    if (existing.length) {
      await pool.query('UPDATE delivery_bank_details SET account_holder_name = ?, bank_name = ?, account_number = ?, ifsc_code = ? WHERE delivery_partner_id = ?', [account_holder_name, bank_name, account_number, ifsc_code, partnerId]);
    } else {
      await pool.query('INSERT INTO delivery_bank_details (delivery_partner_id, account_holder_name, bank_name, account_number, ifsc_code) VALUES (?, ?, ?, ?, ?)', [partnerId, account_holder_name, bank_name, account_number, ifsc_code]);
    }

    await pool.query("UPDATE delivery_partners SET registration_step = 4, verification_status = 'pending' WHERE id = ?", [partnerId]);

    return res.status(200).json({ message: 'Bank details saved. Profile under review.', data: { registration_step: 4, verification_status: 'pending' } });
  } catch (error) {
    console.error('delivery step4 error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/delivery/profile
 */
const getProfile = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT dp.*, z.name as zone_name FROM delivery_partners dp LEFT JOIN zones z ON dp.zone_id = z.id WHERE dp.id = ?', [req.delivery.id]);
    if (!rows.length) return res.status(404).json({ message: 'Partner not found.' });
    const p = rows[0];

    // Get bank details
    const [bankRows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM delivery_bank_details WHERE delivery_partner_id = ?', [req.delivery.id]);
    const bank = bankRows[0] || null;

    return res.status(200).json({
      message: 'Profile fetched.',
      data: {
        id: p.uuid, mobile: p.mobile, registration_step: p.registration_step, verification_status: p.verification_status, rejection_reason: p.rejection_reason,
        personal: { full_name: p.full_name, email: p.email, date_of_birth: p.date_of_birth, gender: p.gender, profile_photo: p.profile_photo },
        vehicle: { vehicle_type: p.vehicle_type, vehicle_type_id: p.vehicle_type_id, rc_number: p.rc_number, dl_number: p.dl_number, zone_id: p.zone_id, zone_name: p.zone_name },
        documents: { aadhaar_front_url: p.aadhaar_front_url, aadhaar_back_url: p.aadhaar_back_url, pan_card_url: p.pan_card_url, driving_licence_url: p.driving_licence_url, rider_selfie_url: p.rider_selfie_url },
        bank: bank,
        status: { is_online: p.is_online, is_active: p.is_active },
        stats: { average_rating: p.average_rating, total_deliveries: p.total_deliveries, total_earned: p.total_earned },
      },
    });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * PUT /api/v1/delivery/toggle-online
 * Body: { latitude, longitude }
 */
const toggleOnline = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const [rows] = await pool.query('SELECT is_online, verification_status FROM delivery_partners WHERE id = ?', [req.delivery.id]);
    if (rows[0].verification_status !== 'approved') return res.status(400).json({ message: 'Account not verified yet.' });

    const newStatus = rows[0].is_online ? 0 : 1;
    if (newStatus === 1 && (!latitude || !longitude)) return res.status(400).json({ message: 'latitude, longitude required to go online.' });

    if (newStatus === 1) {
      await pool.query('UPDATE delivery_partners SET is_online = 1, latitude = ?, longitude = ?, last_location_update = NOW() WHERE id = ?', [latitude, longitude, req.delivery.id]);
    } else {
      await pool.query('UPDATE delivery_partners SET is_online = 0 WHERE id = ?', [req.delivery.id]);
    }

    return res.status(200).json({ message: newStatus ? 'You are now online.' : 'You are now offline.', data: { is_online: newStatus } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * PUT /api/v1/delivery/location
 * Body: { latitude, longitude }
 */
const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ message: 'latitude, longitude required.' });
    await pool.query('UPDATE delivery_partners SET latitude = ?, longitude = ?, last_location_update = NOW() WHERE id = ?', [latitude, longitude, req.delivery.id]);
    return res.status(200).json({ message: 'Location updated.' });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/delivery/active
 * Current active delivery (assigned or picked_up) - shows on main screen
 */
const getActiveDelivery = async (req, res) => {
  try {
    const partnerId = req.delivery.id;

    const [rows] = await pool.query(
      `SELECT dr.*, p.name as pharmacy_name, p.mobile as pharmacy_mobile, p.address_line1 as pharmacy_address,
              po.order_id as order_number, po.total_items, po.final_amount, po.payment_method,
              u.full_name as customer_name, u.mobile as customer_mobile
       FROM delivery_requests dr
       JOIN pharmacies p ON dr.pharmacy_id = p.id
       JOIN pharmacy_orders po ON dr.order_id = po.id
       JOIN users u ON po.user_id = u.id
       WHERE dr.partner_id = ? AND dr.status IN ('assigned', 'picked_up', 'reached')
       ORDER BY dr.assigned_at DESC LIMIT 1`,
      [partnerId]
    );

    if (!rows.length) {
      return res.status(200).json({ message: 'No active delivery.', data: null });
    }

    const d = rows[0];

    return res.status(200).json({
      message: 'Active delivery fetched.',
      data: {
        id: d.id,
        request_id: d.request_id,
        status: d.status,
        pickup: {
          address: d.pickup_address,
          latitude: d.pickup_latitude,
          longitude: d.pickup_longitude,
          pharmacy_name: d.pharmacy_name,
          pharmacy_mobile: d.pharmacy_mobile,
        },
        drop: {
          address: d.drop_address,
          latitude: d.drop_latitude,
          longitude: d.drop_longitude,
          customer_name: d.customer_name,
          customer_mobile: d.customer_mobile,
        },
        order: {
          order_id: d.order_number,
          total_items: d.total_items,
          amount: d.final_amount,
          payment_method: d.payment_method,
        },
        distance_km: d.distance_km,
        delivery_earning: d.delivery_earning,
        delivery_otp: d.delivery_otp,
        assigned_at: d.assigned_at,
        picked_up_at: d.picked_up_at,
      },
    });
  } catch (error) {
    console.error('delivery getActiveDelivery error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/delivery/requests
 * Pending delivery requests for this partner (searching status, within zone)
 */
const getDeliveryRequests = async (req, res) => {
  try {
    const partnerId = req.delivery.id;

    // Get partner zone & location
    const [partnerRows] = await pool.query('SELECT zone_id, latitude, longitude FROM delivery_partners WHERE id = ?', [partnerId]);
    const partner = partnerRows[0];

    // Get admin config
    const [configRows] = await pool.query("SELECT config_value FROM admin_config WHERE config_key = 'delivery_search_radius_km'");
    const radiusKm = configRows.length ? parseFloat(configRows[0].config_value) : 5;

    // Find searching requests within radius
    const [rows] = await pool.query(
      `SELECT dr.*, p.name as pharmacy_name,
       (6371 * acos(cos(radians(?)) * cos(radians(pickup_latitude)) * cos(radians(pickup_longitude) - radians(?)) + sin(radians(?)) * sin(radians(pickup_latitude)))) AS distance_from_partner
       FROM delivery_requests dr
       JOIN pharmacies p ON dr.pharmacy_id = p.id
       WHERE dr.status = 'searching'
       HAVING distance_from_partner <= ?
       ORDER BY distance_from_partner ASC`,
      [partner.latitude, partner.longitude, partner.latitude, radiusKm]
    );

    return res.status(200).json({
      message: 'Delivery requests fetched.',
      data: rows.map(r => ({
        id: r.id, request_id: r.request_id, pharmacy_name: r.pharmacy_name,
        pickup: { address: r.pickup_address, lat: r.pickup_latitude, lng: r.pickup_longitude },
        drop: { address: r.drop_address, lat: r.drop_latitude, lng: r.drop_longitude },
        distance_km: r.distance_km, delivery_earning: r.delivery_earning,
        distance_from_you_km: parseFloat(r.distance_from_partner.toFixed(2)),
        created_at: r.created_at,
      })),
    });
  } catch (error) {
    console.error('delivery getRequests error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/delivery/request/:id/accept
 */
const acceptDelivery = async (req, res) => {
  try {
    const partnerId = req.delivery.id;
    const { id } = req.params;

    const [rows] = await pool.query("SELECT * FROM delivery_requests WHERE id = ? AND status = 'searching'", [id]);
    if (!rows.length) return res.status(404).json({ message: 'Request not found or already assigned.' });

    await pool.query("UPDATE delivery_requests SET partner_id = ?, status = 'assigned', assigned_at = NOW() WHERE id = ?", [partnerId, id]);
    await pool.query('UPDATE pharmacy_orders SET delivery_partner_id = ?, delivery_request_id = ? WHERE id = ?', [partnerId, id, rows[0].order_id]);

    return res.status(200).json({ message: 'Delivery accepted!', data: { status: 'assigned' } });
  } catch (error) {
    console.error('delivery accept error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/delivery/request/:id/reject
 */
const rejectDelivery = async (req, res) => {
  try {
    // Just ignore — don't change status, other partners can still accept
    return res.status(200).json({ message: 'Request skipped.' });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * PUT /api/v1/delivery/request/:id/picked-up
 */
const markPickedUp = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, order_id, status FROM delivery_requests WHERE id = ? AND partner_id = ?", [req.params.id, req.delivery.id]);
    if (!rows.length) return res.status(404).json({ message: 'Delivery not found.' });
    if (rows[0].status !== 'assigned') return res.status(400).json({ message: `Cannot mark picked up. Current: ${rows[0].status}` });

    await pool.query("UPDATE delivery_requests SET status = 'picked_up', picked_up_at = NOW() WHERE id = ?", [rows[0].id]);
    await pool.query("UPDATE pharmacy_orders SET status = 'out_for_delivery', dispatched_at = NOW() WHERE id = ?", [rows[0].order_id]);

    // Notify user
    const [orderRows] = await pool.query('SELECT user_id FROM pharmacy_orders WHERE id = ?', [rows[0].order_id]);
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [orderRows[0].user_id]);
    if (userRows[0]?.fcm_token) await notificationService.sendToDevice(userRows[0].fcm_token, 'Order Picked Up 🛵', 'Your medicine order is on its way!', { type: 'delivery_picked_up' });

    return res.status(200).json({ message: 'Marked as picked up.', data: { status: 'picked_up' } });
  } catch (error) {
    console.error('delivery pickedUp error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/delivery/request/:id/reached
 * Delivery partner reached at user's location — OTP generated
 */
const markReached = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, order_id, status FROM delivery_requests WHERE id = ? AND partner_id = ?", [req.params.id, req.delivery.id]);
    if (!rows.length) return res.status(404).json({ message: 'Delivery not found.' });
    if (rows[0].status !== 'picked_up') return res.status(400).json({ message: `Cannot mark reached. Current: ${rows[0].status}` });

    // Generate OTP
    const deliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();
    await pool.query("UPDATE delivery_requests SET status = 'reached', reached_at = NOW(), delivery_otp = ? WHERE id = ?", [deliveryOtp, rows[0].id]);

    // Update pharmacy order status to 'reached'
    await pool.query("UPDATE pharmacy_orders SET status = 'reached' WHERE id = ?", [rows[0].order_id]);

    // Notify user with OTP
    const [orderRows] = await pool.query('SELECT user_id FROM pharmacy_orders WHERE id = ?', [rows[0].order_id]);
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [orderRows[0].user_id]);
    if (userRows[0]?.fcm_token) await notificationService.sendToDevice(userRows[0].fcm_token, 'Delivery Partner Arrived 🏠', `Your order has arrived! Delivery OTP: ${deliveryOtp}`, { type: 'delivery_reached', delivery_otp: deliveryOtp });

    return res.status(200).json({ message: 'Marked as reached. OTP sent to user.', data: { status: 'reached' } });
  } catch (error) {
    console.error('delivery markReached error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/delivery/request/:id/delivered
 * Body: { otp }
 */
const markDelivered = async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ message: 'Delivery OTP required.' });

    const [rows] = await pool.query("SELECT dr.*, po.pharmacy_id, po.user_id, po.final_amount, po.payment_method FROM delivery_requests dr JOIN pharmacy_orders po ON dr.order_id = po.id WHERE dr.id = ? AND dr.partner_id = ?", [req.params.id, req.delivery.id]);
    if (!rows.length) return res.status(404).json({ message: 'Delivery not found.' });
    if (rows[0].status !== 'reached') return res.status(400).json({ message: `Cannot mark delivered. Current: ${rows[0].status}` });

    // Verify OTP
    if (rows[0].delivery_otp !== otp) return res.status(400).json({ message: 'Invalid OTP.' });

    const delivery = rows[0];

    await pool.query("UPDATE delivery_requests SET status = 'delivered', delivered_at = NOW() WHERE id = ?", [delivery.id]);
    await pool.query("UPDATE pharmacy_orders SET status = 'delivered', delivered_at = NOW() WHERE id = ?", [delivery.order_id]);

    // COD → mark paid
    if (delivery.payment_method === 'cod') {
      await pool.query("UPDATE pharmacy_orders SET payment_status = 'paid', paid_at = NOW() WHERE id = ?", [delivery.order_id]);
    }

    // Credit delivery partner earning → wallet
    await pool.query('UPDATE delivery_partners SET total_deliveries = total_deliveries + 1, total_earned = total_earned + ? WHERE id = ?', [delivery.delivery_earning, req.delivery.id]);

    // Ensure wallet exists
    const [walletExists] = await pool.query('SELECT id FROM delivery_wallets WHERE delivery_partner_id = ?', [req.delivery.id]);
    if (!walletExists.length) await pool.query('INSERT INTO delivery_wallets (delivery_partner_id) VALUES (?)', [req.delivery.id]);

    // Credit wallet
    await pool.query('UPDATE delivery_wallets SET balance = balance + ?, total_earned = total_earned + ? WHERE delivery_partner_id = ?', [delivery.delivery_earning, delivery.delivery_earning, req.delivery.id]);
    const [walletRow] = await pool.query('SELECT balance FROM delivery_wallets WHERE delivery_partner_id = ?', [req.delivery.id]);
    await pool.query("INSERT INTO delivery_wallet_transactions (delivery_partner_id, type, amount, description, reference_type, reference_id, balance_after) VALUES (?, 'credit', ?, ?, 'delivery_earning', ?, ?)", [req.delivery.id, delivery.delivery_earning, `Delivery ${delivery.request_id} completed. Distance: ${delivery.distance_km} km`, delivery.id, walletRow[0].balance]);

    // Credit pharmacy wallet (order amount - admin commission)
    const [pharmacy] = await pool.query('SELECT admin_commission_percent FROM pharmacies WHERE id = ?', [delivery.pharmacy_id]);
    const commissionPercent = pharmacy[0]?.admin_commission_percent || 10;
    const totalAmount = parseFloat(delivery.final_amount);
    const adminCommission = totalAmount * (commissionPercent / 100);
    const pharmacyEarning = totalAmount - adminCommission;

    const [phWalletExists] = await pool.query('SELECT id FROM pharmacy_wallets WHERE pharmacy_id = ?', [delivery.pharmacy_id]);
    if (!phWalletExists.length) await pool.query('INSERT INTO pharmacy_wallets (pharmacy_id) VALUES (?)', [delivery.pharmacy_id]);
    await pool.query('UPDATE pharmacy_wallets SET balance = balance + ?, total_earned = total_earned + ? WHERE pharmacy_id = ?', [pharmacyEarning, pharmacyEarning, delivery.pharmacy_id]);
    const [phWallet] = await pool.query('SELECT balance FROM pharmacy_wallets WHERE pharmacy_id = ?', [delivery.pharmacy_id]);
    await pool.query("INSERT INTO pharmacy_wallet_transactions (pharmacy_id, type, amount, description, reference_type, reference_id, admin_commission, balance_after) VALUES (?, 'credit', ?, ?, 'order_fee', ?, ?, ?)", [delivery.pharmacy_id, pharmacyEarning, `Order delivered. Commission: ₹${adminCommission.toFixed(2)}`, delivery.order_id, adminCommission, phWallet[0].balance]);

    // Notify user
    const [userRows] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [delivery.user_id]);
    if (userRows[0]?.fcm_token) await notificationService.sendToDevice(userRows[0].fcm_token, 'Order Delivered! 🎉', 'Your medicine has been delivered.', { type: 'delivery_completed' });

    return res.status(200).json({ message: 'Delivery completed!', data: { status: 'delivered', earning: delivery.delivery_earning } });
  } catch (error) {
    console.error('delivery markDelivered error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/delivery/history?status=&page=&limit=
 */
const getDeliveryHistory = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['dr.partner_id = ?']; let params = [req.delivery.id];
    if (status) { where.push('dr.status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM delivery_requests dr WHERE ${whereClause}`, params);
    const [rows] = await pool.query(`SELECT dr.*, p.name as pharmacy_name FROM delivery_requests dr JOIN pharmacies p ON dr.pharmacy_id = p.id WHERE ${whereClause} ORDER BY dr.created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);

    return res.status(200).json({
      message: 'Delivery history fetched.',
      data: rows.map(r => ({ id: r.id, request_id: r.request_id, pharmacy_name: r.pharmacy_name, pickup_address: r.pickup_address, drop_address: r.drop_address, distance_km: r.distance_km, delivery_earning: r.delivery_earning, status: r.status, assigned_at: r.assigned_at, delivered_at: r.delivered_at })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/delivery/earnings
 */
const getEarnings = async (req, res) => {
  try {
    const partnerId = req.delivery.id;
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = `${today.substring(0, 7)}-01`;

    const [partner] = await pool.query('SELECT total_earned, total_deliveries FROM delivery_partners WHERE id = ?', [partnerId]);
    const [todayEarnings] = await pool.query("SELECT COALESCE(SUM(delivery_earning), 0) as total, COUNT(*) as trips FROM delivery_requests WHERE partner_id = ? AND status = 'delivered' AND DATE(delivered_at) = ?", [partnerId, today]);
    const [monthEarnings] = await pool.query("SELECT COALESCE(SUM(delivery_earning), 0) as total, COUNT(*) as trips FROM delivery_requests WHERE partner_id = ? AND status = 'delivered' AND delivered_at >= ?", [partnerId, firstOfMonth]);

    return res.status(200).json({
      message: 'Earnings fetched.',
      data: {
        total_earned: partner[0].total_earned,
        total_deliveries: partner[0].total_deliveries,
        today: { earned: todayEarnings[0].total, trips: todayEarnings[0].trips },
        this_month: { earned: monthEarnings[0].total, trips: monthEarnings[0].trips },
      },
    });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = { sendOtp, verifyOtp, step1Personal, step2Vehicle, step3Documents, step4Bank, getProfile, getVehicleTypes, toggleOnline, updateLocation, getActiveDelivery, getDeliveryRequests, acceptDelivery, rejectDelivery, markPickedUp, markReached, markDelivered, getDeliveryHistory, getEarnings };
