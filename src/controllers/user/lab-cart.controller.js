const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// LAB CART CONTROLLER - User can add tests to cart
// Constraint: All tests in cart must be from same lab
// ─────────────────────────────────────────────

/**
 * POST /api/v1/user/lab-cart/add
 * Body: { pricing_id }
 */
const addToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { pricing_id } = req.body;

    if (!pricing_id) {
      return res.status(400).json({ message: 'pricing_id required.' });
    }

    // Get pricing details (test + lab)
    const [pricingRows] = await pool.query(
      `SELECT ltp.id, ltp.pathology_lab_id, ltp.test_id, ltp.price, ltp.discount_percent, lt.name as test_name, pl.name as lab_name
       FROM lab_test_pricing ltp
       JOIN lab_tests lt ON ltp.test_id = lt.id
       JOIN pathology_labs pl ON ltp.pathology_lab_id = pl.id
       WHERE ltp.id = ? AND ltp.is_available = 1`,
      [pricing_id]
    );

    if (!pricingRows.length) {
      return res.status(404).json({ message: 'Test not found or unavailable.' });
    }

    const pricing = pricingRows[0];

    // Check if cart already has items from a different lab
    const [cartItems] = await pool.query(
      'SELECT lab_id FROM lab_cart WHERE user_id = ? LIMIT 1',
      [userId]
    );

    if (cartItems.length && parseInt(cartItems[0].lab_id) !== parseInt(pricing.pathology_lab_id)) {
      return res.status(400).json({
        message: 'Cart mein sirf ek lab ke tests add ho sakte hain. Pehle cart clear karo ya same lab ka test add karo.',
      });
    }

    // Check if already in cart
    const [existing] = await pool.query(
      'SELECT id FROM lab_cart WHERE user_id = ? AND pricing_id = ?',
      [userId, pricing_id]
    );

    if (existing.length) {
      return res.status(409).json({ message: 'Test already in cart.' });
    }

    // Add to cart
    await pool.query(
      'INSERT INTO lab_cart (user_id, lab_id, test_id, pricing_id) VALUES (?, ?, ?, ?)',
      [userId, pricing.pathology_lab_id, pricing.test_id, pricing_id]
    );

    return res.status(201).json({
      message: 'Test added to cart.',
      data: {
        pricing_id: pricing.id,
        test_name: pricing.test_name,
        lab_name: pricing.lab_name,
        price: pricing.price,
        discount_percent: pricing.discount_percent,
      },
    });
  } catch (error) {
    console.error('addToCart error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * DELETE /api/v1/user/lab-cart/remove/:pricing_id
 */
const removeFromCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { pricing_id } = req.params;

    const [result] = await pool.query(
      'DELETE FROM lab_cart WHERE user_id = ? AND pricing_id = ?',
      [userId, pricing_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Item not found in cart.' });
    }

    return res.status(200).json({ message: 'Test removed from cart.' });
  } catch (error) {
    console.error('removeFromCart error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/lab-cart
 * Get cart items with pricing summary
 */
const getCart = async (req, res) => {
  try {
    const userId = req.user.id;

    const [items] = await pool.query(
      `SELECT lc.id, lc.pricing_id, lc.lab_id, lc.test_id,
              lt.name as test_name, lt.test_code, lt.sample_type,
              ltp.price, ltp.discount_percent, ltp.report_delivery_hours,
              pl.uuid as lab_uuid, pl.name as lab_name, pl.profile_photo as lab_photo, pl.address_line1 as lab_address, pl.city as lab_city
       FROM lab_cart lc
       JOIN lab_tests lt ON lc.test_id = lt.id
       JOIN lab_test_pricing ltp ON lc.pricing_id = ltp.id
       JOIN pathology_labs pl ON lc.lab_id = pl.id
       WHERE lc.user_id = ?
       ORDER BY lc.created_at DESC`,
      [userId]
    );

    if (!items.length) {
      return res.status(200).json({
        message: 'Cart is empty.',
        data: { lab: null, items: [], summary: { total_tests: 0, base_amount: 0, discount_amount: 0, final_amount: 0 } },
      });
    }

    // Calculate summary
    let baseAmount = 0;
    let discountAmount = 0;

    const cartItems = items.map((item) => {
      const price = parseFloat(item.price);
      const discount = price * (parseFloat(item.discount_percent) / 100);
      baseAmount += price;
      discountAmount += discount;

      return {
        id: item.id,
        pricing_id: item.pricing_id,
        test_id: item.test_id,
        test_name: item.test_name,
        test_code: item.test_code,
        sample_type: item.sample_type,
        price: item.price,
        discount_percent: item.discount_percent,
        discounted_price: (price - discount).toFixed(2),
        report_delivery_hours: item.report_delivery_hours,
      };
    });

    const finalAmount = baseAmount - discountAmount;

    return res.status(200).json({
      message: 'Cart fetched.',
      data: {
        lab: {
          id: items[0].lab_uuid,
          name: items[0].lab_name,
          profile_photo: items[0].lab_photo,
          address: items[0].lab_address,
          city: items[0].lab_city,
        },
        items: cartItems,
        summary: {
          total_tests: cartItems.length,
          base_amount: baseAmount.toFixed(2),
          discount_amount: discountAmount.toFixed(2),
          final_amount: finalAmount.toFixed(2),
        },
      },
    });
  } catch (error) {
    console.error('getCart error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * DELETE /api/v1/user/lab-cart/clear
 * Clear entire cart
 */
const clearCart = async (req, res) => {
  try {
    const userId = req.user.id;
    await pool.query('DELETE FROM lab_cart WHERE user_id = ?', [userId]);
    return res.status(200).json({ message: 'Cart cleared.' });
  } catch (error) {
    console.error('clearCart error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  addToCart,
  removeFromCart,
  getCart,
  clearCart,
};
