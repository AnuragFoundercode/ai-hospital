const { pool } = require('../../config/database');

const getDashboard = async (req, res) => {
  try {
    const pharmacyId = req.pharmacy.id;
    const today = new Date().toISOString().split('T')[0];

    const [totalOrders] = await pool.query('SELECT COUNT(*) as count FROM pharmacy_orders WHERE pharmacy_id = ?', [pharmacyId]);
    const [pendingOrders] = await pool.query("SELECT COUNT(*) as count FROM pharmacy_orders WHERE pharmacy_id = ? AND status = 'pending'", [pharmacyId]);
    const [prescriptionPending] = await pool.query("SELECT COUNT(*) as count FROM pharmacy_orders WHERE pharmacy_id = ? AND status = 'prescription_pending'", [pharmacyId]);
    const [packingOrders] = await pool.query("SELECT COUNT(*) as count FROM pharmacy_orders WHERE pharmacy_id = ? AND status = 'packing'", [pharmacyId]);
    const [readyOrders] = await pool.query("SELECT COUNT(*) as count FROM pharmacy_orders WHERE pharmacy_id = ? AND status = 'ready'", [pharmacyId]);
    const [deliveredToday] = await pool.query("SELECT COUNT(*) as count FROM pharmacy_orders WHERE pharmacy_id = ? AND status = 'delivered' AND DATE(delivered_at) = ?", [pharmacyId, today]);
    const [cancelledOrders] = await pool.query("SELECT COUNT(*) as count FROM pharmacy_orders WHERE pharmacy_id = ? AND status IN ('cancelled', 'rejected')", [pharmacyId]);
    const [todayRevenue] = await pool.query("SELECT COALESCE(SUM(final_amount), 0) as total FROM pharmacy_orders WHERE pharmacy_id = ? AND status = 'delivered' AND DATE(delivered_at) = ?", [pharmacyId, today]);

    // Low stock alerts
    const [lowStock] = await pool.query(
      'SELECT id, name, quantity, medicine_image_url FROM pharmacy_medicines WHERE pharmacy_id = ? AND quantity <= low_stock_alert AND quantity > 0 AND is_active = 1 ORDER BY quantity ASC LIMIT 5',
      [pharmacyId]
    );

    // Recent orders
    const [recentOrders] = await pool.query(
      `SELECT po.order_id, po.final_amount, po.status, po.created_at, u.full_name as customer_name
       FROM pharmacy_orders po JOIN users u ON po.user_id = u.id WHERE po.pharmacy_id = ? ORDER BY po.created_at DESC LIMIT 5`,
      [pharmacyId]
    );

    return res.status(200).json({
      message: 'Dashboard fetched.',
      data: {
        stats: {
          total_orders: totalOrders[0].count,
          pending_orders: pendingOrders[0].count,
          prescription_pending: prescriptionPending[0].count,
          packing_orders: packingOrders[0].count,
          ready_for_delivery: readyOrders[0].count,
          delivered_today: deliveredToday[0].count,
          cancelled_orders: cancelledOrders[0].count,
          today_revenue: todayRevenue[0].total,
        },
        low_stock_alerts: lowStock.map(m => ({ id: m.id, name: m.name, quantity: m.quantity, image: m.medicine_image_url })),
        recent_orders: recentOrders.map(o => ({ order_id: o.order_id, customer_name: o.customer_name, amount: o.final_amount, status: o.status, created_at: o.created_at })),
      },
    });
  } catch (error) {
    console.error('pharmacy dashboard error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = { getDashboard };
