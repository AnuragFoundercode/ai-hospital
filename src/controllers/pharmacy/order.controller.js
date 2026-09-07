const { pool } = require('../../config/database');
const notificationService = require('../../services/notification.service');
const { notify } = require('../../services/notify');

// ─────────────────────────────────────────────
// PHARMACY ORDER MANAGEMENT (Vendor side)
// ─────────────────────────────────────────────

/**
 * GET /api/v1/pharmacy/orders?status=&page=&limit=
 */
const getOrders = async (req, res) => {
  try {
    const pharmacyId = req.pharmacy.id;
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['po.pharmacy_id = ?'];
    let params = [pharmacyId];
    if (status) { where.push('po.status = ?'); params.push(status); }

    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM pharmacy_orders po WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT po.order_id, po.status, po.total_items, po.final_amount, po.payment_method, po.payment_status, po.prescription_required, po.created_at, u.full_name as customer_name, u.mobile as customer_mobile
       FROM pharmacy_orders po JOIN users u ON po.user_id = u.id WHERE ${whereClause} ORDER BY po.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Orders fetched.',
      data: rows.map(o => ({ order_id: o.order_id, customer_name: o.customer_name, customer_mobile: o.customer_mobile, status: o.status, total_items: o.total_items, final_amount: o.final_amount, payment_method: o.payment_method, payment_status: o.payment_status, prescription_required: o.prescription_required, created_at: o.created_at })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('pharmacy getOrders error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/pharmacy/order/:order_id
 */
const getOrderDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT po.*, u.full_name as customer_name, u.mobile as customer_mobile, u.email as customer_email
       FROM pharmacy_orders po JOIN users u ON po.user_id = u.id WHERE po.order_id = ? AND po.pharmacy_id = ?`,
      [req.params.order_id, req.pharmacy.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Order not found.' });
    const o = rows[0];

    return res.status(200).json({
      message: 'Order detail fetched.',
      data: {
        order_id: o.order_id, status: o.status,
        customer: { name: o.customer_name, mobile: o.customer_mobile, email: o.customer_email },
        items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items,
        total_items: o.total_items,
        prescription: { required: o.prescription_required, url: o.prescription_url },
        pricing: { base_amount: o.base_amount, discount_amount: o.discount_amount, delivery_charge: o.delivery_charge, tax_amount: o.tax_amount, final_amount: o.final_amount },
        payment: { method: o.payment_method, status: o.payment_status, transaction_id: o.transaction_id, paid_at: o.paid_at },
        delivery_address: typeof o.delivery_address === 'string' ? JSON.parse(o.delivery_address) : o.delivery_address,
        remark: o.remark,
        rating: { user_rating: o.user_rating, user_review: o.user_review, rated_at: o.rated_at },
        timeline: { created_at: o.created_at, accepted_at: o.accepted_at, packed_at: o.packed_at, ready_at: o.ready_at, dispatched_at: o.dispatched_at, delivered_at: o.delivered_at, cancelled_at: o.cancelled_at },
        rejection_reason: o.rejection_reason,
      },
    });
  } catch (error) {
    console.error('pharmacy getOrderDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/pharmacy/order/:order_id/accept
 */
const acceptOrder = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, status, user_id FROM pharmacy_orders WHERE order_id = ? AND pharmacy_id = ?', [req.params.order_id, req.pharmacy.id]);
    if (!rows.length) return res.status(404).json({ message: 'Order not found.' });
    if (rows[0].status !== 'pending') return res.status(400).json({ message: `Cannot accept. Current status: ${rows[0].status}` });

    await pool.query('UPDATE pharmacy_orders SET status = ?, accepted_at = NOW() WHERE id = ?', ['accepted', rows[0].id]);

    await notify('user', rows[0].user_id, {
      title: 'Order Accepted ✅', body: 'Your medicine order has been accepted.',
      type: 'order', reference_type: 'order', reference_id: rows[0].id,
      data: { event: 'order_accepted', order_id: req.params.order_id },
    });

    return res.status(200).json({ message: 'Order accepted.', data: { status: 'accepted' } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * PUT /api/v1/pharmacy/order/:order_id/reject
 * Body: { reason }
 */
const rejectOrder = async (req, res) => {
  try {
    const { reason } = req.body;
    const [rows] = await pool.query('SELECT id, status, user_id FROM pharmacy_orders WHERE order_id = ? AND pharmacy_id = ?', [req.params.order_id, req.pharmacy.id]);
    if (!rows.length) return res.status(404).json({ message: 'Order not found.' });
    if (!['pending', 'accepted'].includes(rows[0].status)) return res.status(400).json({ message: `Cannot reject. Current status: ${rows[0].status}` });

    await pool.query('UPDATE pharmacy_orders SET status = ?, rejection_reason = ?, cancelled_at = NOW() WHERE id = ?', ['rejected', reason || null, rows[0].id]);

    await notify('user', rows[0].user_id, {
      title: 'Order Rejected ❌', body: reason || 'Your order was rejected by the pharmacy.',
      type: 'order', reference_type: 'order', reference_id: rows[0].id,
      data: { event: 'order_rejected', order_id: req.params.order_id },
    });

    return res.status(200).json({ message: 'Order rejected.', data: { status: 'rejected' } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * PUT /api/v1/pharmacy/order/:order_id/status
 * Body: { status } → packing, ready, out_for_delivery, delivered
 */
const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validTransitions = { accepted: ['packing'], packing: ['ready'], ready: ['out_for_delivery'], out_for_delivery: ['delivered'] };

    const [rows] = await pool.query('SELECT id, status as current_status, user_id, pharmacy_id, final_amount, delivery_charge, delivery_distance_km, payment_method FROM pharmacy_orders WHERE order_id = ? AND pharmacy_id = ?', [req.params.order_id, req.pharmacy.id]);
    if (!rows.length) return res.status(404).json({ message: 'Order not found.' });

    const order = rows[0];
    const allowed = validTransitions[order.current_status] || [];
    if (!allowed.includes(status)) return res.status(400).json({ message: `Cannot change from "${order.current_status}" to "${status}". Allowed: ${allowed.join(', ')}` });

    const timestampField = { packing: 'packed_at', ready: 'ready_at', out_for_delivery: 'dispatched_at', delivered: 'delivered_at' };
    await pool.query(`UPDATE pharmacy_orders SET status = ?, ${timestampField[status]} = NOW() WHERE id = ?`, [status, order.id]);

    // When order is ready → create delivery request for nearby partners
    if (status === 'ready') {
      try {
        const [pharmacyRows] = await pool.query('SELECT latitude, longitude, address_line1, city FROM pharmacies WHERE id = ?', [order.pharmacy_id]);
        const [orderRows] = await pool.query('SELECT delivery_address FROM pharmacy_orders WHERE id = ?', [order.id]);
        const deliveryAddress = typeof orderRows[0].delivery_address === 'string' ? JSON.parse(orderRows[0].delivery_address) : orderRows[0].delivery_address;

        if (pharmacyRows[0] && deliveryAddress) {
          const pickupLat = parseFloat(pharmacyRows[0].latitude);
          const pickupLng = parseFloat(pharmacyRows[0].longitude);
          const dropLat = parseFloat(deliveryAddress.latitude || 0);
          const dropLng = parseFloat(deliveryAddress.longitude || 0);

          const [configRows] = await pool.query("SELECT config_value FROM admin_config WHERE config_key = 'delivery_per_km_charge'");
          const perKmCharge = configRows.length ? parseFloat(configRows[0].config_value) : 12;

          // Delivery fee = what the user actually paid (stored on the order, distance-based).
          // Fallback to distance*rate only if the order has no stored fee.
          let distanceKm = parseFloat(order.delivery_distance_km) || 0;
          let deliveryFee = parseFloat(order.delivery_charge) || 0;
          if (deliveryFee <= 0) {
            const R = 6371;
            const dLat = (dropLat - pickupLat) * Math.PI / 180;
            const dLon = (dropLng - pickupLng) * Math.PI / 180;
            const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(pickupLat*Math.PI/180)*Math.cos(dropLat*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
            distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            deliveryFee = parseFloat((distanceKm * perKmCharge).toFixed(2));
          }

          // Commission is deducted per delivery-partner at ACCEPT time (each partner has
          // their own admin_commission_percent). At 'ready' we only know the gross fee.
          // Show the full fee as the estimated earning until a partner accepts.
          const deliveryEarning = deliveryFee;

          const requestId = `DEL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

          await pool.query(
            "INSERT INTO delivery_requests (request_id, order_id, pharmacy_id, pickup_address, pickup_latitude, pickup_longitude, drop_address, drop_latitude, drop_longitude, distance_km, per_km_charge, delivery_fee, delivery_earning, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'searching')",
            [requestId, order.id, order.pharmacy_id, `${pharmacyRows[0].address_line1}, ${pharmacyRows[0].city}`, pickupLat, pickupLng, `${deliveryAddress.address_line1 || ''}, ${deliveryAddress.city || ''}`, dropLat, dropLng, distanceKm.toFixed(2), perKmCharge, deliveryFee, deliveryEarning]
          );

          // Notify nearby delivery partners
          const { sendToClient } = require('../../events/sse');
          const [radiusConfig] = await pool.query("SELECT config_value FROM admin_config WHERE config_key = 'delivery_search_radius_km'");
          const searchRadius = radiusConfig.length ? parseFloat(radiusConfig[0].config_value) : 5;
          const [nearbyPartners] = await pool.query(
            "SELECT id, fcm_token FROM delivery_partners WHERE is_online = 1 AND is_active = 1 AND verification_status = 'approved' AND latitude IS NOT NULL AND (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude)))) <= ?",
            [pickupLat, pickupLng, pickupLat, searchRadius]
          );

          for (const dp of nearbyPartners) {
            sendToClient(`delivery_${dp.id}`, 'new_delivery_request', { request_id: requestId, pickup_address: pharmacyRows[0].address_line1, distance_km: distanceKm.toFixed(2), earning: deliveryEarning });
            await notify('delivery_partner', dp.id, {
              title: 'New Delivery 🛵',
              body: `₹${deliveryEarning} | ${distanceKm.toFixed(1)} km`,
              type: 'order', reference_type: 'delivery_request', reference_id: null, reference_code: requestId,
              data: { event: 'new_delivery', request_id: requestId },
              fcmToken: dp.fcm_token,
            });
          }
        }
      } catch (delErr) { console.error('Delivery request creation error:', delErr.message); }
    }

    // On delivered → credit wallet (minus admin commission), mark COD as paid
    if (status === 'delivered') {
      const [pharmacy] = await pool.query('SELECT admin_commission_percent FROM pharmacies WHERE id = ?', [order.pharmacy_id]);
      const commissionPercent = pharmacy[0]?.admin_commission_percent || 10;
      const totalAmount = parseFloat(order.final_amount);
      const adminCommission = totalAmount * (commissionPercent / 100);
      const earning = totalAmount - adminCommission;

      // Ensure wallet
      const [walletExists] = await pool.query('SELECT id FROM pharmacy_wallets WHERE pharmacy_id = ?', [order.pharmacy_id]);
      if (!walletExists.length) await pool.query('INSERT INTO pharmacy_wallets (pharmacy_id) VALUES (?)', [order.pharmacy_id]);

      await pool.query('UPDATE pharmacy_wallets SET balance = balance + ?, total_earned = total_earned + ? WHERE pharmacy_id = ?', [earning, earning, order.pharmacy_id]);
      const [wallet] = await pool.query('SELECT balance FROM pharmacy_wallets WHERE pharmacy_id = ?', [order.pharmacy_id]);
      await pool.query(`INSERT INTO pharmacy_wallet_transactions (pharmacy_id, type, amount, description, reference_type, reference_id, admin_commission, balance_after) VALUES (?, 'credit', ?, ?, 'order_fee', ?, ?, ?)`, [order.pharmacy_id, earning, `Order ${req.params.order_id} delivered. Commission: ₹${adminCommission.toFixed(2)}`, order.id, adminCommission, wallet[0].balance]);

      // COD → mark paid
      if (order.payment_method === 'cod') {
        await pool.query('UPDATE pharmacy_orders SET payment_status = ?, paid_at = NOW() WHERE id = ?', ['paid', order.id]);
      }
    }

    // Notify user
    const statusMessages = { packing: 'Your order is being packed.', ready: 'Your order is ready for pickup/delivery.', out_for_delivery: 'Your order is out for delivery!', delivered: 'Your order has been delivered! 🎉' };
    await notify('user', order.user_id, {
      title: `Order ${status.replace(/_/g, ' ')}`, body: statusMessages[status] || `Order ${status}.`,
      type: 'order', reference_type: 'order', reference_id: order.id,
      data: { event: 'order_status', order_id: req.params.order_id, status },
    });

    return res.status(200).json({ message: `Order marked as ${status}.`, data: { status } });
  } catch (error) {
    console.error('pharmacy updateOrderStatus error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = { getOrders, getOrderDetail, acceptOrder, rejectOrder, updateOrderStatus };
