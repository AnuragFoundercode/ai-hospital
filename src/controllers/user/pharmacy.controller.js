const { pool } = require('../../config/database');
const paytmService = require('../../services/paytm.service');
const paytmConfig = require('../../config/paytm');
const distanceService = require('../../services/distance.service');

// ─────────────────────────────────────────────
// USER PHARMACY CONTROLLER
// ─────────────────────────────────────────────

// Global per-km delivery rate (admin_config.delivery_per_km_charge), cached lightly
const getPerKmCharge = async () => {
  const [rows] = await pool.query("SELECT config_value FROM admin_config WHERE config_key = 'delivery_per_km_charge'");
  return rows.length ? parseFloat(rows[0].config_value) : 12;
};

/**
 * Distance-based delivery fee = per_km_rate * distance_km (pharmacy -> drop).
 * Returns { fee, distance_km, per_km }. If coords missing, distance 0 -> fee 0.
 */
const computeDeliveryFee = async (pharmacy, dropLat, dropLng) => {
  const perKm = await getPerKmCharge();
  const pLat = parseFloat(pharmacy.latitude);
  const pLng = parseFloat(pharmacy.longitude);
  const dLat = parseFloat(dropLat);
  const dLng = parseFloat(dropLng);

  if (!pLat || !pLng || !dLat || !dLng) {
    return { fee: 0, distance_km: 0, per_km: perKm };
  }

  const { distance_km } = await distanceService.getDistance(pLat, pLng, dLat, dLng);
  const fee = parseFloat((distance_km * perKm).toFixed(2));
  return { fee, distance_km, per_km: perKm };
};

const getCategories = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, icon_url FROM medicine_categories WHERE is_active = 1 ORDER BY sort_order');
    return res.status(200).json({ message: 'Categories fetched.', data: rows });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/user/pharmacies?search=&category_id=&pincode=&page=&limit=
 */
const getPharmacyList = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, category_id, pincode } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['p.is_active = 1', 'p.is_verified = 1']; let params = []; let join = '';

    if (search) { where.push('p.name LIKE ?'); params.push(`%${search}%`); }
    if (pincode) {
      const [zoneRows] = await pool.query("SELECT id FROM zones WHERE is_active = 1 AND JSON_CONTAINS(pincodes, ?)", [JSON.stringify(pincode)]);
      if (zoneRows.length) { where.push('p.zone_id = ?'); params.push(zoneRows[0].id); }
      else { return res.status(200).json({ message: 'No service available in this pincode.', data: [], pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, total_pages: 0 } }); }
    }
    if (category_id) { join = 'JOIN pharmacy_medicines pm2 ON p.id = pm2.pharmacy_id AND pm2.category_id = ? AND pm2.is_active = 1 AND pm2.quantity > 0'; params.unshift(parseInt(category_id)); }

    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(DISTINCT p.id) as total FROM pharmacies p ${join} WHERE ${whereClause}`, params);
    const [rows] = await pool.query(`SELECT DISTINCT p.id, p.uuid, p.name, p.profile_photo, p.address_line1, p.city, p.pincode, p.average_rating, p.delivery_available, p.delivery_charge, p.free_delivery_above, p.is_24hours, p.opening_time, p.closing_time FROM pharmacies p ${join} WHERE ${whereClause} ORDER BY p.average_rating DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);

    return res.status(200).json({
      message: 'Pharmacies fetched.',
      data: rows.map(r => ({ id: r.uuid, name: r.name, profile_photo: r.profile_photo, address: r.address_line1, city: r.city, pincode: r.pincode, rating: r.average_rating, delivery_available: r.delivery_available, delivery_charge: r.delivery_charge, free_delivery_above: r.free_delivery_above, is_24hours: r.is_24hours, opening_time: r.opening_time, closing_time: r.closing_time })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) { console.error('getPharmacyList error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/user/pharmacy/:id
 */
const getPharmacyDetail = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM pharmacies WHERE uuid = ? AND is_active = 1 AND is_verified = 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Pharmacy not found.' });
    const p = rows[0];
    return res.status(200).json({ message: 'Pharmacy detail fetched.', data: { id: p.uuid, name: p.name, profile_photo: p.profile_photo, rating: p.average_rating, about_description: p.about_description, location: { address: p.address_line1, address_line2: p.address_line2, landmark: p.landmark, city: p.city, state: p.state, pincode: p.pincode, latitude: p.latitude, longitude: p.longitude }, timing: { is_24hours: p.is_24hours, opening_time: p.opening_time, closing_time: p.closing_time }, delivery: { available: p.delivery_available, charge: p.delivery_charge, free_above: p.free_delivery_above, radius_km: p.delivery_radius_km } } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/user/pharmacy/:id/medicines?category_id=&search=&page=&limit=
 */
const getPharmacyMedicines = async (req, res) => {
  try {
    const [pRows] = await pool.query('SELECT id FROM pharmacies WHERE uuid = ? AND is_active = 1', [req.params.id]);
    if (!pRows.length) return res.status(404).json({ message: 'Pharmacy not found.' });
    const pharmacyId = pRows[0].id;
    const { category_id, search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['pm.pharmacy_id = ?', 'pm.is_active = 1', 'pm.quantity > 0']; let params = [pharmacyId];
    if (category_id) { where.push('pm.category_id = ?'); params.push(parseInt(category_id)); }
    if (search) { where.push('pm.name LIKE ?'); params.push(`%${search}%`); }

    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM pharmacy_medicines pm WHERE ${whereClause}`, params);
    const [rows] = await pool.query(`SELECT pm.id, pm.name, pm.generic_name, pm.mrp, pm.selling_price, pm.medicine_image_url, pm.prescription_required, mc.name as category_name FROM pharmacy_medicines pm LEFT JOIN medicine_categories mc ON pm.category_id = mc.id WHERE ${whereClause} ORDER BY pm.name LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);

    return res.status(200).json({ message: 'Medicines fetched.', data: rows.map(m => ({ id: m.id, name: m.name, generic_name: m.generic_name, category: m.category_name, mrp: m.mrp, selling_price: m.selling_price, image: m.medicine_image_url, prescription_required: m.prescription_required })), pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) } });
  } catch (error) { console.error('getPharmacyMedicines error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/user/medicine/:id
 */
const getMedicineDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT pm.*, mc.name as category_name, mb.name as brand_name, p.uuid as pharmacy_uuid, p.name as pharmacy_name FROM pharmacy_medicines pm LEFT JOIN medicine_categories mc ON pm.category_id = mc.id LEFT JOIN medicine_brands mb ON pm.brand_id = mb.id JOIN pharmacies p ON pm.pharmacy_id = p.id WHERE pm.id = ? AND pm.is_active = 1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Medicine not found.' });
    const m = rows[0];
    return res.status(200).json({ message: 'Medicine detail fetched.', data: { id: m.id, name: m.name, generic_name: m.generic_name, category: m.category_name, brand: m.brand_name, manufacturer: m.manufacturer, mrp: m.mrp, selling_price: m.selling_price, discount_percent: m.mrp > 0 ? (((m.mrp - m.selling_price) / m.mrp) * 100).toFixed(1) : 0, description: m.short_description, uses: m.uses, how_to_use: m.how_to_use, side_effects: m.side_effects, salt_composition: m.salt_composition, dosage: m.dosage, storage_instructions: m.storage_instructions, prescription_required: m.prescription_required, images: { medicine_image_url: m.medicine_image_url, strip_image_url: m.strip_image_url, additional: m.additional_images ? (typeof m.additional_images === 'string' ? JSON.parse(m.additional_images) : m.additional_images) : [] }, pharmacy: { id: m.pharmacy_uuid, name: m.pharmacy_name }, in_stock: m.quantity > 0 } });
  } catch (error) { console.error('getMedicineDetail error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── CART ───
const addToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { medicine_id, quantity } = req.body;
    if (!medicine_id) return res.status(400).json({ message: 'medicine_id required.' });

    const [medRows] = await pool.query('SELECT id, pharmacy_id, name, selling_price, quantity as stock FROM pharmacy_medicines WHERE id = ? AND is_active = 1', [medicine_id]);
    if (!medRows.length) return res.status(404).json({ message: 'Medicine not found.' });
    const med = medRows[0];
    if (med.stock <= 0) return res.status(400).json({ message: 'Medicine out of stock.' });

    // Same pharmacy check
    const [cartItems] = await pool.query('SELECT pharmacy_id FROM pharmacy_cart WHERE user_id = ? LIMIT 1', [userId]);
    if (cartItems.length && parseInt(cartItems[0].pharmacy_id) !== parseInt(med.pharmacy_id)) {
      return res.status(400).json({ message: 'Cart mein sirf ek pharmacy ki medicines add ho sakti hain. Pehle cart clear karo.' });
    }

    const [existing] = await pool.query('SELECT id FROM pharmacy_cart WHERE user_id = ? AND medicine_id = ?', [userId, medicine_id]);
    if (existing.length) {
      await pool.query('UPDATE pharmacy_cart SET quantity = ? WHERE user_id = ? AND medicine_id = ?', [quantity || 1, userId, medicine_id]);
      return res.status(200).json({ message: 'Cart updated.' });
    }

    await pool.query('INSERT INTO pharmacy_cart (user_id, pharmacy_id, medicine_id, quantity) VALUES (?, ?, ?, ?)', [userId, med.pharmacy_id, medicine_id, quantity || 1]);
    return res.status(201).json({ message: 'Added to cart.', data: { medicine_id, name: med.name, price: med.selling_price } });
  } catch (error) { console.error('pharmacy addToCart error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

const getCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const [items] = await pool.query(`SELECT pc.id, pc.medicine_id, pc.quantity, pm.name, pm.mrp, pm.selling_price, pm.medicine_image_url, pm.prescription_required, p.uuid as pharmacy_uuid, p.name as pharmacy_name, p.delivery_charge, p.free_delivery_above FROM pharmacy_cart pc JOIN pharmacy_medicines pm ON pc.medicine_id = pm.id JOIN pharmacies p ON pc.pharmacy_id = p.id WHERE pc.user_id = ?`, [userId]);

    if (!items.length) return res.status(200).json({ message: 'Cart is empty.', data: { pharmacy: null, items: [], summary: { total_items: 0, base_amount: 0, discount_amount: 0, delivery_charge: 0, final_amount: 0 } } });

    let baseAmount = 0; let mrpTotal = 0; let prescriptionRequired = false;
    const cartItems = items.map(i => {
      const itemTotal = parseFloat(i.selling_price) * i.quantity;
      const mrpItemTotal = parseFloat(i.mrp) * i.quantity;
      baseAmount += itemTotal; mrpTotal += mrpItemTotal;
      if (i.prescription_required) prescriptionRequired = true;
      return { id: i.id, medicine_id: i.medicine_id, name: i.name, mrp: i.mrp, selling_price: i.selling_price, quantity: i.quantity, item_total: itemTotal, image: i.medicine_image_url, prescription_required: i.prescription_required };
    });

    const discountAmount = mrpTotal - baseAmount;

    // Distance-based delivery preview.
    // Use the address_id passed in query; else fall back to the user's default address
    // so the cart shows an estimated delivery fee even before the user picks an address.
    let deliveryCharge = 0;
    let deliveryDistanceKm = 0;
    const { address_id } = req.query;

    let addrRows;
    if (address_id) {
      [addrRows] = await pool.query('SELECT latitude, longitude FROM user_addresses WHERE id = ? AND user_id = ?', [address_id, userId]);
    } else {
      [addrRows] = await pool.query('SELECT latitude, longitude FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, id ASC LIMIT 1', [userId]);
    }

    if (addrRows.length && addrRows[0].latitude && addrRows[0].longitude) {
      const [pharmacyRows] = await pool.query('SELECT latitude, longitude FROM pharmacies WHERE id = (SELECT pharmacy_id FROM pharmacy_cart WHERE user_id = ? LIMIT 1)', [userId]);
      if (pharmacyRows.length) {
        const calc = await computeDeliveryFee(pharmacyRows[0], addrRows[0].latitude, addrRows[0].longitude);
        deliveryCharge = calc.fee;
        deliveryDistanceKm = calc.distance_km;
      }
    }
    const finalAmount = baseAmount + deliveryCharge;

    return res.status(200).json({ message: 'Cart fetched.', data: { pharmacy: { id: items[0].pharmacy_uuid, name: items[0].pharmacy_name }, items: cartItems, prescription_required: prescriptionRequired, summary: { total_items: cartItems.length, mrp_total: mrpTotal.toFixed(2), base_amount: baseAmount.toFixed(2), discount_amount: discountAmount.toFixed(2), delivery_charge: deliveryCharge.toFixed(2), delivery_distance_km: deliveryDistanceKm, final_amount: finalAmount.toFixed(2) } } });
  } catch (error) { console.error('pharmacy getCart error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

const updateCartItem = async (req, res) => {
  try {
    const { quantity } = req.body;
    if (!quantity || quantity < 1) return res.status(400).json({ message: 'quantity (min 1) required.' });
    const [existing] = await pool.query('SELECT id FROM pharmacy_cart WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!existing.length) return res.status(404).json({ message: 'Cart item not found.' });
    await pool.query('UPDATE pharmacy_cart SET quantity = ? WHERE id = ? AND user_id = ?', [quantity, req.params.id, req.user.id]);
    return res.status(200).json({ message: 'Cart updated.' });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const removeFromCart = async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM pharmacy_cart WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Cart item not found.' });
    return res.status(200).json({ message: 'Removed from cart.' });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const clearCart = async (req, res) => {
  try { await pool.query('DELETE FROM pharmacy_cart WHERE user_id = ?', [req.user.id]); return res.status(200).json({ message: 'Cart cleared.' }); }
  catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── ORDER ───
const createOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { prescription_url, remark, payment_method, address_id } = req.body;

    if (!payment_method || !['online', 'cod'].includes(payment_method)) return res.status(400).json({ message: 'payment_method (online/cod) required.' });
    if (!address_id) return res.status(400).json({ message: 'address_id required.' });

    // Fetch address from user_addresses
    const [addrRows] = await pool.query('SELECT * FROM user_addresses WHERE id = ? AND user_id = ?', [address_id, userId]);
    if (!addrRows.length) return res.status(404).json({ message: 'Address not found.' });
    const delivery_address = { name: addrRows[0].name, mobile: addrRows[0].mobile, address_line1: addrRows[0].address_line1, address_line2: addrRows[0].address_line2, landmark: addrRows[0].landmark, city: addrRows[0].city, state: addrRows[0].state, pincode: addrRows[0].pincode, latitude: addrRows[0].latitude, longitude: addrRows[0].longitude };

    // Get cart
    const [cartItems] = await pool.query(`SELECT pc.*, pm.name, pm.selling_price, pm.mrp, pm.prescription_required, pm.quantity as stock FROM pharmacy_cart pc JOIN pharmacy_medicines pm ON pc.medicine_id = pm.id WHERE pc.user_id = ?`, [userId]);
    if (!cartItems.length) return res.status(400).json({ message: 'Cart is empty.' });

    const pharmacyId = cartItems[0].pharmacy_id;
    let baseAmount = 0; let mrpTotal = 0; let prescriptionRequired = false;
    const items = cartItems.map(i => {
      const itemTotal = parseFloat(i.selling_price) * i.quantity;
      baseAmount += itemTotal; mrpTotal += parseFloat(i.mrp) * i.quantity;
      if (i.prescription_required) prescriptionRequired = true;
      return { medicine_id: i.medicine_id, name: i.name, quantity: i.quantity, price: i.selling_price, total: itemTotal };
    });

    if (prescriptionRequired && !prescription_url) return res.status(400).json({ message: 'Prescription required for one or more medicines. Upload prescription_url.' });

    // Zone check: the chosen delivery address must fall within the pharmacy's serviceable zone.
    // (User may have browsed with one address but picked a different-zone address at checkout.)
    const [pharmacyZone] = await pool.query('SELECT zone_id FROM pharmacies WHERE id = ?', [pharmacyId]);
    const pharmacyZoneId = pharmacyZone[0]?.zone_id;
    if (pharmacyZoneId) {
      const [zoneRows] = await pool.query('SELECT pincodes FROM zones WHERE id = ? AND is_active = 1', [pharmacyZoneId]);
      if (!zoneRows.length) {
        return res.status(400).json({ message: 'This pharmacy is not serviceable right now.' });
      }
      const pincodes = typeof zoneRows[0].pincodes === 'string' ? JSON.parse(zoneRows[0].pincodes) : zoneRows[0].pincodes;
      const addressPincode = String(delivery_address.pincode || '');
      if (!Array.isArray(pincodes) || !pincodes.map(String).includes(addressPincode)) {
        return res.status(400).json({ message: 'This pharmacy does not deliver to the selected address. Please choose an address within the serviceable area.' });
      }
    }

    // Delivery charge = distance-based (per_km_rate * distance from pharmacy to drop)
    const [pharmacy] = await pool.query('SELECT latitude, longitude FROM pharmacies WHERE id = ?', [pharmacyId]);
    const { fee: deliveryCharge, distance_km: deliveryDistanceKm } = await computeDeliveryFee(
      pharmacy[0], delivery_address.latitude, delivery_address.longitude
    );
    const finalAmount = baseAmount + deliveryCharge;
    const discountAmount = mrpTotal - baseAmount;

    const orderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await pool.query(
      `INSERT INTO pharmacy_orders (order_id, user_id, pharmacy_id, status, items, total_items, prescription_url, prescription_required, base_amount, discount_amount, delivery_charge, delivery_distance_km, final_amount, payment_method, payment_status, delivery_address, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)`,
      [orderId, userId, pharmacyId, payment_method === 'cod' ? 'pending' : 'pending', JSON.stringify(items), items.length, prescription_url || null, prescriptionRequired ? 1 : 0, baseAmount, discountAmount, deliveryCharge, deliveryDistanceKm, finalAmount, payment_method, JSON.stringify(delivery_address), remark || null]
    );

    // Clear cart
    await pool.query('DELETE FROM pharmacy_cart WHERE user_id = ?', [userId]);

    if (payment_method === 'cod') {
      // COD → order is confirmed immediately, notify pharmacy now (like a paid order)
      const { sendToClient } = require('../../events/sse');
      sendToClient(`pharmacy_${pharmacyId}`, 'new_order', { order_id: orderId, total_items: items.length, amount: finalAmount, payment_method: 'cod' });
      return res.status(201).json({ message: 'Order placed! Pay on delivery.', data: { order_id: orderId, total_items: items.length, amount: { base: baseAmount, discount: discountAmount, delivery: deliveryCharge, delivery_distance_km: deliveryDistanceKm, total: finalAmount }, payment_method: 'cod', status: 'pending', payment: null } });
    }
    // Online → SSE goes only after payment is confirmed (Paytm callback / confirm-payment)

    // Online → Paytm
    let paytmData = null;
    try {
      const paytmResponse = await paytmService.initiateTransaction(orderId, finalAmount, userId);
      if (paytmResponse.body?.txnToken) { paytmData = { txn_token: paytmResponse.body.txnToken, order_id: orderId, mid: paytmConfig.mid, amount: finalAmount.toFixed(2), callback_url: paytmConfig.callbackUrl, website: paytmConfig.website, base_url: paytmConfig.baseUrl }; }
      else { paytmData = { txn_token: null, order_id: orderId, mid: paytmConfig.mid, amount: finalAmount.toFixed(2), error: paytmResponse.body?.resultInfo?.resultMsg || 'Failed' }; }
    } catch (e) { paytmData = { txn_token: null, order_id: orderId, error: e.message }; }

    return res.status(201).json({ message: 'Order created. Complete payment.', data: { order_id: orderId, total_items: items.length, amount: { base: baseAmount, discount: discountAmount, delivery: deliveryCharge, delivery_distance_km: deliveryDistanceKm, total: finalAmount }, payment_method: 'online', status: 'pending', payment: paytmData } });
  } catch (error) { console.error('pharmacy createOrder error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * POST /api/v1/user/pharmacy-order/:order_id/pay
 * Body: { transaction_id }
 * Manual payment confirmation (same behaviour as lab /pay) — marks order paid
 * and sends real-time SSE to the pharmacy. Idempotent.
 */
const confirmOrderPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { order_id } = req.params;
    const { transaction_id } = req.body;
    if (!transaction_id) return res.status(400).json({ message: 'transaction_id required.' });

    const [rows] = await pool.query('SELECT id, pharmacy_id, total_items, final_amount, payment_status FROM pharmacy_orders WHERE order_id = ? AND user_id = ?', [order_id, userId]);
    if (!rows.length) return res.status(404).json({ message: 'Order not found.' });
    const order = rows[0];

    if (order.payment_status === 'paid') {
      return res.status(200).json({ message: 'Already paid.', data: { order_id, payment_status: 'paid' } });
    }

    await pool.query("UPDATE pharmacy_orders SET payment_status = 'paid', transaction_id = ?, paid_at = NOW() WHERE id = ?", [transaction_id, order.id]);

    // Real-time SSE to pharmacy (order is now paid)
    const { sendToClient } = require('../../events/sse');
    sendToClient(`pharmacy_${order.pharmacy_id}`, 'new_order', { order_id, total_items: order.total_items, amount: order.final_amount, payment_method: 'online' });

    return res.status(200).json({ message: 'Payment successful.', data: { order_id, payment_status: 'paid', transaction_id } });
  } catch (error) { console.error('pharmacy confirmOrderPayment error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/user/pharmacy-orders?status=
 */
const getOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['po.user_id = ?']; let params = [req.user.id];
    if (status) { where.push('po.status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM pharmacy_orders po WHERE ${whereClause}`, params);
    const [rows] = await pool.query(`SELECT po.order_id, po.status, po.total_items, po.final_amount, po.payment_method, po.payment_status, po.created_at, p.uuid as pharmacy_uuid, p.name as pharmacy_name FROM pharmacy_orders po JOIN pharmacies p ON po.pharmacy_id = p.id WHERE ${whereClause} ORDER BY po.created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);
    return res.status(200).json({ message: 'Orders fetched.', data: rows.map(o => ({ order_id: o.order_id, status: o.status, total_items: o.total_items, final_amount: o.final_amount, payment_method: o.payment_method, payment_status: o.payment_status, pharmacy: { id: o.pharmacy_uuid, name: o.pharmacy_name }, created_at: o.created_at })), pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/user/pharmacy-order/:order_id
 */
const getOrderDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT po.*, p.uuid as pharmacy_uuid, p.name as pharmacy_name, p.mobile as pharmacy_mobile FROM pharmacy_orders po JOIN pharmacies p ON po.pharmacy_id = p.id WHERE po.order_id = ? AND po.user_id = ?`, [req.params.order_id, req.user.id]);
    if (!rows.length) return res.status(404).json({ message: 'Order not found.' });
    const o = rows[0];

    // Get delivery OTP if order is out_for_delivery or delivery partner reached
    let deliveryOtp = null;
    let deliveryStatus = null;
    if (o.delivery_request_id) {
      const [drRows] = await pool.query('SELECT delivery_otp, status as delivery_status FROM delivery_requests WHERE id = ?', [o.delivery_request_id]);
      if (drRows.length) {
        deliveryOtp = drRows[0].delivery_otp;
        deliveryStatus = drRows[0].delivery_status;
      }
    }

    return res.status(200).json({ message: 'Order detail fetched.', data: { order_id: o.order_id, status: o.status, delivery_otp: deliveryOtp, delivery_status: deliveryStatus, items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items, total_items: o.total_items, prescription: { required: o.prescription_required, url: o.prescription_url }, pricing: { base_amount: o.base_amount, discount_amount: o.discount_amount, delivery_charge: o.delivery_charge, final_amount: o.final_amount }, payment: { method: o.payment_method, status: o.payment_status, transaction_id: o.transaction_id, paid_at: o.paid_at }, delivery_address: typeof o.delivery_address === 'string' ? JSON.parse(o.delivery_address) : o.delivery_address, remark: o.remark, pharmacy: { id: o.pharmacy_uuid, name: o.pharmacy_name, mobile: o.pharmacy_mobile }, timeline: { created_at: o.created_at, accepted_at: o.accepted_at, packed_at: o.packed_at, ready_at: o.ready_at, dispatched_at: o.dispatched_at, delivered_at: o.delivered_at, cancelled_at: o.cancelled_at }, rejection_reason: o.rejection_reason } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── REVIEWS ───
const getMedicineReviews = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM medicine_reviews WHERE medicine_id = ?', [id]);
    const [avgResult] = await pool.query('SELECT AVG(rating) as avg_rating FROM medicine_reviews WHERE medicine_id = ?', [id]);
    const [rows] = await pool.query(
      `SELECT mr.id, mr.rating, mr.review, mr.created_at, u.full_name, u.profile_photo
       FROM medicine_reviews mr
       JOIN users u ON mr.user_id = u.id
       WHERE mr.medicine_id = ?
       ORDER BY mr.created_at DESC LIMIT ? OFFSET ?`,
      [id, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Reviews fetched.',
      data: {
        average_rating: avgResult[0].avg_rating ? parseFloat(avgResult[0].avg_rating).toFixed(1) : null,
        total_reviews: countResult[0].total,
        reviews: rows.map(r => ({ id: r.id, rating: r.rating, review: r.review, user_name: r.full_name, user_photo: r.profile_photo, date: r.created_at })),
      },
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) { console.error('getMedicineReviews error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

const addMedicineReview = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { rating, review } = req.body;

    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ message: 'rating (1-5) required.' });

    // Check if already reviewed
    const [existing] = await pool.query('SELECT id FROM medicine_reviews WHERE medicine_id = ? AND user_id = ?', [id, userId]);
    if (existing.length) return res.status(409).json({ message: 'You have already reviewed this medicine.' });

    await pool.query('INSERT INTO medicine_reviews (medicine_id, user_id, rating, review) VALUES (?, ?, ?, ?)', [id, userId, rating, review || null]);

    return res.status(201).json({ message: 'Review added.' });
  } catch (error) { console.error('addMedicineReview error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ─── PHARMACY REVIEWS ───
const getPharmacyReviews = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [pRows] = await pool.query('SELECT id FROM pharmacies WHERE uuid = ?', [id]);
    if (!pRows.length) return res.status(404).json({ message: 'Pharmacy not found.' });
    const pharmacyId = pRows[0].id;

    const [countResult] = await pool.query("SELECT COUNT(*) as total FROM pharmacy_orders WHERE pharmacy_id = ? AND user_rating IS NOT NULL", [pharmacyId]);
    const [avgResult] = await pool.query("SELECT AVG(user_rating) as avg_rating FROM pharmacy_orders WHERE pharmacy_id = ? AND user_rating IS NOT NULL", [pharmacyId]);
    const [rows] = await pool.query(
      `SELECT po.user_rating, po.user_review, po.rated_at, u.full_name, u.profile_photo
       FROM pharmacy_orders po
       JOIN users u ON po.user_id = u.id
       WHERE po.pharmacy_id = ? AND po.user_rating IS NOT NULL
       ORDER BY po.rated_at DESC LIMIT ? OFFSET ?`,
      [pharmacyId, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Pharmacy reviews fetched.',
      data: {
        average_rating: avgResult[0].avg_rating ? parseFloat(avgResult[0].avg_rating).toFixed(1) : null,
        total_reviews: countResult[0].total,
        reviews: rows.map(r => ({ rating: r.user_rating, review: r.user_review, user_name: r.full_name, user_photo: r.profile_photo, date: r.rated_at })),
      },
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) { console.error('getPharmacyReviews error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

const addPharmacyReview = async (req, res) => {
  try {
    const userId = req.user.id;
    const { order_id, rating, review } = req.body;

    if (!order_id || !rating || rating < 1 || rating > 5) return res.status(400).json({ message: 'order_id and rating (1-5) required.' });

    const [orderRows] = await pool.query("SELECT id, pharmacy_id, user_rating FROM pharmacy_orders WHERE order_id = ? AND user_id = ? AND status = 'delivered'", [order_id, userId]);
    if (!orderRows.length) return res.status(404).json({ message: 'Delivered order not found.' });
    if (orderRows[0].user_rating) return res.status(409).json({ message: 'Already rated this order.' });

    await pool.query('UPDATE pharmacy_orders SET user_rating = ?, user_review = ?, rated_at = NOW() WHERE id = ?', [rating, review || null, orderRows[0].id]);

    // Update pharmacy average rating
    const [avg] = await pool.query("SELECT AVG(user_rating) as avg FROM pharmacy_orders WHERE pharmacy_id = ? AND user_rating IS NOT NULL", [orderRows[0].pharmacy_id]);
    await pool.query('UPDATE pharmacies SET average_rating = ? WHERE id = ?', [avg[0].avg || 0, orderRows[0].pharmacy_id]);

    return res.status(201).json({ message: 'Review submitted.' });
  } catch (error) { console.error('addPharmacyReview error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/user/search-medicines?search=dolo&pincode=226001
 * Search medicines by name, return which pharmacies have it (filtered by user pincode/zone)
 */
const searchMedicines = async (req, res) => {
  try {
    const { search, pincode, category_id } = req.query;
    if (!search || search.trim().length < 2) return res.status(400).json({ message: 'search (min 2 chars) required.' });

    let zoneFilter = '';
    let zoneParams = [];
    let categoryFilter = '';
    let categoryParams = [];

    // If pincode provided, find zone and filter pharmacies by same zone
    if (pincode) {
      const [zoneRows] = await pool.query("SELECT id FROM zones WHERE is_active = 1 AND JSON_CONTAINS(pincodes, ?)", [JSON.stringify(pincode)]);
      if (zoneRows.length) {
        zoneFilter = 'AND p.zone_id = ?';
        zoneParams = [zoneRows[0].id];
      }
    }

    if (category_id) {
      categoryFilter = 'AND pm.category_id = ?';
      categoryParams = [parseInt(category_id)];
    }

    const [rows] = await pool.query(
      `SELECT pm.id as medicine_id, pm.name, pm.generic_name, pm.mrp, pm.selling_price, pm.medicine_image_url, pm.prescription_required, mc.name as category_name,
              p.uuid as pharmacy_uuid, p.name as pharmacy_name, p.profile_photo as pharmacy_photo, p.pincode as pharmacy_pincode, p.delivery_charge, p.free_delivery_above
       FROM pharmacy_medicines pm
       JOIN pharmacies p ON pm.pharmacy_id = p.id
       LEFT JOIN medicine_categories mc ON pm.category_id = mc.id
       WHERE pm.name LIKE ? AND pm.is_active = 1 AND pm.quantity > 0 AND p.is_active = 1 AND p.is_verified = 1 ${zoneFilter} ${categoryFilter}
       ORDER BY pm.selling_price ASC
       LIMIT 50`,
      [`%${search}%`, ...zoneParams, ...categoryParams]
    );

    // Group by medicine name
    const medicineMap = {};
    for (const r of rows) {
      const key = `${r.name}_${r.generic_name}`;
      if (!medicineMap[key]) {
        medicineMap[key] = {
          name: r.name,
          generic_name: r.generic_name,
          category: r.category_name,
          image: r.medicine_image_url,
          prescription_required: r.prescription_required,
          available_at: [],
        };
      }
      medicineMap[key].available_at.push({
        medicine_id: r.medicine_id,
        pharmacy_id: r.pharmacy_uuid,
        pharmacy_name: r.pharmacy_name,
        pharmacy_photo: r.pharmacy_photo,
        mrp: r.mrp,
        selling_price: r.selling_price,
        delivery_charge: r.delivery_charge,
        free_delivery_above: r.free_delivery_above,
      });
    }

    return res.status(200).json({
      message: 'Medicines found.',
      data: Object.values(medicineMap),
    });
  } catch (error) {
    console.error('searchMedicines error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/browse-medicines?pincode=226001&category_id=1&search=&page=&limit=
 * Browse all medicines in a zone (no pharmacy id needed)
 */
const browseMedicines = async (req, res) => {
  try {
    const { pincode, category_id, search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['pm.is_active = 1', 'pm.quantity > 0', 'p.is_active = 1', 'p.is_verified = 1'];
    let params = [];

    // Zone filter
    if (pincode) {
      const [zoneRows] = await pool.query("SELECT id FROM zones WHERE is_active = 1 AND JSON_CONTAINS(pincodes, ?)", [JSON.stringify(pincode)]);
      if (zoneRows.length) { where.push('p.zone_id = ?'); params.push(zoneRows[0].id); }
      else { return res.status(200).json({ message: 'No medicines available in this pincode.', data: [], pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, total_pages: 0 } }); }
    }

    if (category_id) { where.push('pm.category_id = ?'); params.push(parseInt(category_id)); }
    if (search) { where.push('pm.name LIKE ?'); params.push(`%${search}%`); }

    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM pharmacy_medicines pm JOIN pharmacies p ON pm.pharmacy_id = p.id WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT pm.id, pm.name, pm.generic_name, pm.mrp, pm.selling_price, pm.medicine_image_url, pm.prescription_required, mc.name as category_name, p.uuid as pharmacy_uuid, p.name as pharmacy_name
       FROM pharmacy_medicines pm
       JOIN pharmacies p ON pm.pharmacy_id = p.id
       LEFT JOIN medicine_categories mc ON pm.category_id = mc.id
       WHERE ${whereClause}
       ORDER BY pm.name ASC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Medicines fetched.',
      data: rows.map(m => ({ id: m.id, name: m.name, generic_name: m.generic_name, category: m.category_name, mrp: m.mrp, selling_price: m.selling_price, image: m.medicine_image_url, prescription_required: m.prescription_required, pharmacy: { id: m.pharmacy_uuid, name: m.pharmacy_name } })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) { console.error('browseMedicines error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = { getCategories, getPharmacyList, getPharmacyDetail, getPharmacyMedicines, getMedicineDetail, addToCart, getCart, updateCartItem, removeFromCart, clearCart, createOrder, confirmOrderPayment, getOrders, getOrderDetail, getMedicineReviews, addMedicineReview, getPharmacyReviews, addPharmacyReview, searchMedicines, browseMedicines };
