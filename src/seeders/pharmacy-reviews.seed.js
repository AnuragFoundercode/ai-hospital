const { pool } = require('../config/database');

const seed = async () => {
  try {
    const [pRows] = await pool.query("SELECT id FROM pharmacies WHERE uuid = 'ph-uuid-001'");
    if (!pRows.length) { console.log('Pharmacy ph-uuid-001 not found'); process.exit(1); }
    const pharmacyId = pRows[0].id;

    const [users] = await pool.query('SELECT id FROM users LIMIT 5');
    if (!users.length) { console.log('No users found'); process.exit(1); }

    const reviews = [
      { rating: 5.0, review: 'Excellent pharmacy! Medicines delivered within 20 minutes. Very well packed.' },
      { rating: 4.5, review: 'Good service and genuine medicines. Slightly delayed but acceptable.' },
      { rating: 4.0, review: 'Nice pharmacy, affordable prices. Delivery boy was polite.' },
      { rating: 5.0, review: 'Best pharmacy in the area. Always have all medicines in stock.' },
      { rating: 3.5, review: 'Average experience. One medicine was out of stock but they informed early.' },
      { rating: 4.5, review: 'Fast delivery and proper billing. Will order again!' },
      { rating: 4.0, review: 'Prescription medicines handled well. Verified before dispatching.' },
    ];

    for (let i = 0; i < reviews.length; i++) {
      const userId = users[i % users.length].id;
      const r = reviews[i];
      const daysAgo = (i + 1) * 4;
      const orderId = 'ORD-REV-' + Date.now() + '-' + i;
      const createdAt = new Date(Date.now() - daysAgo * 86400000);
      const items = JSON.stringify([{ name: 'Dolo 650', quantity: 1, price: 16.5 }, { name: 'Pan-D', quantity: 1, price: 58 }]);

      await pool.query(
        "INSERT INTO pharmacy_orders (order_id, user_id, pharmacy_id, status, items, total_items, base_amount, discount_amount, delivery_charge, final_amount, payment_method, payment_status, paid_at, user_rating, user_review, rated_at, delivered_at, created_at) VALUES (?, ?, ?, 'delivered', ?, 2, 200, 20, 30, 210, 'cod', 'paid', ?, ?, ?, ?, ?, ?)",
        [orderId, userId, pharmacyId, items, createdAt, r.rating, r.review, createdAt, createdAt, createdAt]
      );
    }

    const [avg] = await pool.query('SELECT AVG(user_rating) as avg FROM pharmacy_orders WHERE pharmacy_id = ? AND user_rating IS NOT NULL', [pharmacyId]);
    await pool.query('UPDATE pharmacies SET average_rating = ? WHERE id = ?', [avg[0].avg || 0, pharmacyId]);

    console.log('✅ ' + reviews.length + ' reviews added. Avg rating: ' + parseFloat(avg[0].avg).toFixed(2));
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
};

seed();
