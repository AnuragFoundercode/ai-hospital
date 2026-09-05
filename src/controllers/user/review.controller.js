const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// UNIFIED VENDOR REVIEWS (user side)
// One review per user per vendor; user can update star + text later.
// ─────────────────────────────────────────────

// vendor_type -> its DB table (must have id + average_rating columns)
const VENDOR_TABLE = {
  doctor: 'doctors',
  pharmacy: 'pharmacies',
  pathology_lab: 'pathology_labs',
  diagnostic_center: 'diagnostic_centers',
  blood_bank: 'blood_banks',
  ambulance_service: 'ambulance_services',
};

const VALID_TYPES = Object.keys(VENDOR_TABLE);

/**
 * Resolve a vendor's internal numeric id from its public uuid.
 * Returns null if not found.
 */
const resolveVendorId = async (vendorType, vendorUuid) => {
  const table = VENDOR_TABLE[vendorType];
  if (!table || !vendorUuid) return null;
  const [rows] = await pool.query(`SELECT id FROM ${table} WHERE uuid = ?`, [vendorUuid]);
  return rows.length ? rows[0].id : null;
};

/**
 * Verified-purchase check: has this user completed at least one real service
 * with this vendor? Returns true/false. Query differs per vendor type.
 */
const hasCompletedService = async (vendorType, vendorId, userId) => {
  let sql;
  let params;
  switch (vendorType) {
    case 'doctor':
      sql = "SELECT 1 FROM doctor_calls WHERE user_id = ? AND doctor_id = ? AND status = 'completed' LIMIT 1";
      params = [userId, vendorId];
      break;
    case 'pharmacy':
      sql = "SELECT 1 FROM pharmacy_orders WHERE user_id = ? AND pharmacy_id = ? AND status = 'delivered' LIMIT 1";
      params = [userId, vendorId];
      break;
    case 'pathology_lab':
      sql = "SELECT 1 FROM bookings WHERE user_id = ? AND provider_id = ? AND service_type = 'pathology_test' AND status = 'completed' LIMIT 1";
      params = [userId, vendorId];
      break;
    case 'diagnostic_center':
      sql = "SELECT 1 FROM bookings WHERE user_id = ? AND provider_id = ? AND service_type = 'diagnostic_scan' AND status = 'completed' LIMIT 1";
      params = [userId, vendorId];
      break;
    case 'blood_bank':
      sql = "SELECT 1 FROM blood_requests WHERE user_id = ? AND blood_bank_id = ? AND status = 'completed' LIMIT 1";
      params = [userId, vendorId];
      break;
    case 'ambulance_service':
      sql = "SELECT 1 FROM ambulance_bookings WHERE user_id = ? AND partner_id = ? AND status = 'completed' LIMIT 1";
      params = [userId, vendorId];
      break;
    default:
      return false;
  }
  const [rows] = await pool.query(sql, params);
  return rows.length > 0;
};

// Recompute + store a vendor's average_rating from vendor_reviews
const recomputeAverage = async (vendorType, vendorId) => {
  const table = VENDOR_TABLE[vendorType];
  if (!table) return;
  const [avgRows] = await pool.query(
    'SELECT AVG(rating) AS avg_rating FROM vendor_reviews WHERE vendor_type = ? AND vendor_id = ?',
    [vendorType, vendorId]
  );
  const avg = avgRows[0].avg_rating ? parseFloat(parseFloat(avgRows[0].avg_rating).toFixed(2)) : 0;
  await pool.query(`UPDATE ${table} SET average_rating = ? WHERE id = ?`, [avg, vendorId]);
  return avg;
};

/**
 * POST /api/v1/user/vendor-review
 * Body: { vendor_type, vendor_id (uuid), rating (1-5), review }
 * Adds a new review, or updates the user's existing review for that vendor.
 */
const upsertReview = async (req, res) => {
  try {
    const userId = req.user.id;
    const { vendor_type, vendor_id, rating, review } = req.body;

    if (!VALID_TYPES.includes(vendor_type)) {
      return res.status(400).json({ message: `vendor_type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (!vendor_id) return res.status(400).json({ message: 'vendor_id (uuid) is required.' });
    const numRating = parseFloat(rating);
    if (!numRating || numRating < 1 || numRating > 5) {
      return res.status(400).json({ message: 'rating (1-5) is required.' });
    }

    // Resolve vendor uuid -> internal id
    const vendorInternalId = await resolveVendorId(vendor_type, vendor_id);
    if (!vendorInternalId) return res.status(404).json({ message: 'Vendor not found.' });

    // Verified purchase: only users who actually completed a service can review.
    const verified = await hasCompletedService(vendor_type, vendorInternalId, userId);
    if (!verified) {
      return res.status(403).json({ message: 'You can only review a vendor after completing a service with them.' });
    }

    // Upsert (UNIQUE user+vendor). One review per user per vendor.
    const [existing] = await pool.query(
      'SELECT id FROM vendor_reviews WHERE user_id = ? AND vendor_type = ? AND vendor_id = ?',
      [userId, vendor_type, vendorInternalId]
    );

    let isUpdate = false;
    if (existing.length) {
      isUpdate = true;
      await pool.query(
        'UPDATE vendor_reviews SET rating = ?, review = ? WHERE id = ?',
        [numRating, review || null, existing[0].id]
      );
    } else {
      await pool.query(
        'INSERT INTO vendor_reviews (vendor_type, vendor_id, user_id, rating, review) VALUES (?, ?, ?, ?, ?)',
        [vendor_type, vendorInternalId, userId, numRating, review || null]
      );
    }

    const average = await recomputeAverage(vendor_type, vendorInternalId);

    return res.status(isUpdate ? 200 : 201).json({
      message: isUpdate ? 'Review updated.' : 'Review submitted.',
      data: { vendor_type, vendor_id, rating: numRating, review: review || null, vendor_average_rating: average },
    });
  } catch (error) {
    console.error('upsertReview error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/vendor/:type/:id/reviews?page=&limit=
 * Public list of a vendor's reviews + average + count.
 */
const getVendorReviews = async (req, res) => {
  try {
    const { type, id } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ message: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }

    const vendorInternalId = await resolveVendorId(type, id);
    if (!vendorInternalId) return res.status(404).json({ message: 'Vendor not found.' });

    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS total, AVG(rating) AS avg_rating FROM vendor_reviews WHERE vendor_type = ? AND vendor_id = ?',
      [type, vendorInternalId]
    );
    const [rows] = await pool.query(
      `SELECT vr.id, vr.rating, vr.review, vr.created_at, vr.updated_at, u.full_name, u.profile_photo
       FROM vendor_reviews vr JOIN users u ON vr.user_id = u.id
       WHERE vr.vendor_type = ? AND vr.vendor_id = ?
       ORDER BY vr.updated_at DESC LIMIT ? OFFSET ?`,
      [type, vendorInternalId, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Reviews fetched.',
      data: {
        average_rating: countRows[0].avg_rating ? parseFloat(parseFloat(countRows[0].avg_rating).toFixed(2)) : 0,
        total_reviews: countRows[0].total,
        reviews: rows.map(r => ({
          id: r.id, rating: r.rating, review: r.review,
          user_name: r.full_name, user_photo: r.profile_photo,
          created_at: r.created_at, updated_at: r.updated_at,
        })),
      },
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countRows[0].total, total_pages: Math.ceil(countRows[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('getVendorReviews error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/vendor/:type/:id/my-review
 * The logged-in user's own review for this vendor (for prefilling the edit form).
 */
const getMyReview = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, id } = req.params;

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ message: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }

    const vendorInternalId = await resolveVendorId(type, id);
    if (!vendorInternalId) return res.status(404).json({ message: 'Vendor not found.' });

    const [rows] = await pool.query(
      'SELECT id, rating, review, created_at, updated_at FROM vendor_reviews WHERE user_id = ? AND vendor_type = ? AND vendor_id = ?',
      [userId, type, vendorInternalId]
    );

    return res.status(200).json({
      message: rows.length ? 'Review fetched.' : 'No review yet.',
      data: rows[0] || null,
    });
  } catch (error) {
    console.error('getMyReview error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = { upsertReview, getVendorReviews, getMyReview };
