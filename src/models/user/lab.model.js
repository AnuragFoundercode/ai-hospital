const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// LAB MODEL - For patient app
// ─────────────────────────────────────────────

// Get labs list with search & pagination
const getLabList = async ({ page = 1, limit = 10, search, test_id, city }) => {
  const offset = (page - 1) * limit;
  let where = ['l.is_active = 1', 'l.is_verified = 1'];
  let params = [];
  let join = '';

  // Search by lab name
  if (search) {
    where.push('l.name LIKE ?');
    params.push(`%${search}%`);
  }

  // Filter by city
  if (city) {
    where.push('l.city = ?');
    params.push(city);
  }

  // Filter by test availability
  if (test_id) {
    join = 'JOIN lab_test_pricing ltp ON l.id = ltp.pathology_lab_id AND ltp.test_id = ? AND ltp.is_available = 1';
    params.unshift(test_id); // prepend for JOIN
  }

  const whereClause = where.join(' AND ');

  // Count
  const [countResult] = await pool.query(
    `SELECT COUNT(DISTINCT l.id) as total FROM pathology_labs l ${join} WHERE ${whereClause}`,
    params
  );
  const total = countResult[0].total;

  // Get labs
  const [rows] = await pool.query(
    `SELECT DISTINCT l.id, l.uuid, l.name, l.profile_photo, l.address_line1, l.city, l.state, l.pincode, l.average_rating, l.home_collection_available, l.opening_time, l.closing_time
     FROM pathology_labs l ${join}
     WHERE ${whereClause}
     ORDER BY l.average_rating DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { labs: rows, total, page, limit };
};

// Get lab detail by uuid
const findByUuid = async (uuid) => {
  const [rows] = await pool.query(
    `SELECT * FROM pathology_labs WHERE uuid = ? AND is_active = 1 AND is_verified = 1`,
    [uuid]
  );
  return rows[0] || null;
};

// Get tests offered by a lab
const getLabTests = async (labId) => {
  const [rows] = await pool.query(
    `SELECT lt.id, lt.name, lt.test_code, lt.sample_type, ltc.name as category_name,
            ltp.price, ltp.discount_percent, ltp.report_delivery_hours
     FROM lab_test_pricing ltp
     JOIN lab_tests lt ON ltp.test_id = lt.id
     LEFT JOIN lab_test_categories ltc ON lt.category_id = ltc.id
     WHERE ltp.pathology_lab_id = ? AND ltp.is_available = 1 AND lt.is_active = 1
     ORDER BY ltc.sort_order, lt.name`,
    [labId]
  );
  return rows;
};

// Get test categories
const getTestCategories = async () => {
  const [rows] = await pool.query(
    'SELECT id, name, icon_url FROM lab_test_categories WHERE is_active = 1 ORDER BY sort_order'
  );
  return rows;
};

// Search tests by name
const searchTests = async (search) => {
  const [rows] = await pool.query(
    `SELECT lt.id, lt.name, lt.test_code, lt.sample_type, ltc.name as category_name
     FROM lab_tests lt
     LEFT JOIN lab_test_categories ltc ON lt.category_id = ltc.id
     WHERE lt.is_active = 1 AND lt.name LIKE ?
     ORDER BY lt.name
     LIMIT 20`,
    [`%${search}%`]
  );
  return rows;
};

// Get reviews for a lab (from bookings)
const getLabReviews = async (labId, limit = 10) => {
  const [rows] = await pool.query(
    `SELECT b.user_rating, b.user_review, b.rated_at, u.full_name, u.profile_photo
     FROM bookings b
     JOIN users u ON b.user_id = u.id
     WHERE b.service_type = 'pathology_test' AND b.provider_id = ? AND b.user_rating IS NOT NULL
     ORDER BY b.rated_at DESC
     LIMIT ?`,
    [labId, limit]
  );
  return rows;
};

// Get test detail by id
const getTestDetail = async (testId) => {
  const [rows] = await pool.query(
    `SELECT lt.id, lt.name, lt.test_code, lt.sample_type, lt.description, lt.preparation_instructions, lt.includes, lt.report_delivery_hours, lt.home_collection_available, ltc.name as category_name
     FROM lab_tests lt
     LEFT JOIN lab_test_categories ltc ON lt.category_id = ltc.id
     WHERE lt.id = ? AND lt.is_active = 1`,
    [testId]
  );
  return rows[0] || null;
};

// Get price of a test for a specific lab
const getTestPricing = async (testId, labUuid) => {
  const [rows] = await pool.query(
    `SELECT ltp.price, ltp.discount_percent, ltp.report_delivery_hours
     FROM lab_test_pricing ltp
     JOIN pathology_labs pl ON ltp.pathology_lab_id = pl.id
     WHERE ltp.test_id = ? AND pl.uuid = ? AND ltp.is_available = 1`,
    [testId, labUuid]
  );
  return rows[0] || null;
};

module.exports = {
  getLabList,
  findByUuid,
  getLabTests,
  getTestCategories,
  searchTests,
  getLabReviews,
  getTestDetail,
  getTestPricing,
};
