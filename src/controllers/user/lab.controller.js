const labModel = require('../../models/user/lab.model');

// ─────────────────────────────────────────────
// LAB CONTROLLER - For patient app
// ─────────────────────────────────────────────

/**
 * GET /api/v1/user/labs?search=&test_id=&city=&page=1&limit=10
 * Browse labs with filters
 */
const getLabList = async (req, res) => {
  try {
    const { pool } = require('../../config/database');
    const { page = 1, limit = 10, search, test_id, city, pincode } = req.query;

    // Find zone_id from pincode
    let zone_id = null;
    if (pincode) {
      const [zoneRows] = await pool.query("SELECT id FROM zones WHERE is_active = 1 AND JSON_CONTAINS(pincodes, ?)", [JSON.stringify(pincode)]);
      if (zoneRows.length) zone_id = zoneRows[0].id;
      else return res.status(200).json({ message: 'No service available in this pincode.', data: [], pagination: { page: 1, limit: parseInt(limit), total: 0, total_pages: 0 } });
    }

    const result = await labModel.getLabList({
      page: parseInt(page),
      limit: parseInt(limit),
      search: search || null,
      test_id: test_id ? parseInt(test_id) : null,
      city: city || null,
      zone_id,
    });

    const labs = result.labs.map((l) => ({
      id: l.uuid,
      name: l.name,
      profile_photo: l.profile_photo,
      address: l.address_line1,
      city: l.city,
      state: l.state,
      pincode: l.pincode,
      rating: l.average_rating,
      home_collection: l.home_collection_available,
      timing: `${l.opening_time || '07:00'} - ${l.closing_time || '21:00'}`,
    }));

    return res.status(200).json({      message: 'Labs fetched.',
      data: labs,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        total_pages: Math.ceil(result.total / result.limit),
      },
    });
  } catch (error) {
    console.error('getLabList error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/lab/:id
 * Full lab profile - about, location, timing, tests, reviews
 */
const getLabDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const lab = await labModel.findByUuid(id);
    if (!lab) {
      return res.status(404).json({ message: 'Lab not found.' });
    }

    const tests = await labModel.getLabTests(lab.id);
    const reviews = await labModel.getLabReviews(lab.id);

    // Group tests by category
    const testsByCategory = {};
    for (const test of tests) {
      const cat = test.category_name || 'Other';
      if (!testsByCategory[cat]) testsByCategory[cat] = [];
      testsByCategory[cat].push({
        id: test.pricing_id,
        test_id: test.test_id,
        name: test.name,
        test_code: test.test_code,
        sample_type: test.sample_type,
        price: test.price,
        discount_percent: test.discount_percent,
        report_hours: test.report_delivery_hours,
      });
    }

    return res.status(200).json({      message: 'Lab profile fetched.',
      data: {
        id: lab.uuid,
        name: lab.name,
        profile_photo: lab.profile_photo,
        rating: lab.average_rating,
        about_description: lab.about_description,
        about: {
          owner_name: lab.owner_name,
          nabl_accreditation: lab.nabl_accreditation_number,
          license_number: lab.lab_license_number,
        },
        location: {
          address: lab.address_line1,
          address_line2: lab.address_line2,
          city: lab.city,
          state: lab.state,
          pincode: lab.pincode,
          latitude: lab.latitude,
          longitude: lab.longitude,
        },
        timing: {
          opening_time: lab.opening_time,
          closing_time: lab.closing_time,
        },
        services: {
          home_collection: lab.home_collection_available,
          home_collection_radius_km: lab.home_collection_radius_km,
          total_tests: tests.length,
        },
        tests: testsByCategory,
        reviews: reviews.map((r) => ({
          user_name: r.full_name,
          user_photo: r.profile_photo,
          rating: r.user_rating,
          review: r.user_review,
          date: r.rated_at,
        })),
      },
    });
  } catch (error) {
    console.error('getLabDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/lab-test-categories
 * Test categories list
 */
const getTestCategories = async (req, res) => {
  try {
    const categories = await labModel.getTestCategories();
    return res.status(200).json({      message: 'Test categories fetched.',
      data: categories,
    });
  } catch (error) {
    console.error('getTestCategories error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/lab-tests?search=cbc
 * Search tests by name
 */
const searchTests = async (req, res) => {
  try {
    const { search } = req.query;

    if (!search || search.trim().length < 2) {
      return res.status(400).json({ message: 'Search query (min 2 chars) required.' });
    }

    const tests = await labModel.searchTests(search);
    return res.status(200).json({      message: 'Tests fetched.',
      data: tests,
    });
  } catch (error) {
    console.error('searchTests error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/lab-test/:id?lab_id=<lab_uuid>
 * Full test details with price of specific lab
 */
const getTestDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const { lab_id } = req.query;

    if (!lab_id) {
      return res.status(400).json({ message: 'lab_id query param required.' });
    }

    const test = await labModel.getTestDetail(parseInt(id));
    if (!test) {
      return res.status(404).json({ message: 'Test not found.' });
    }

    const pricing = await labModel.getTestPricing(parseInt(id), lab_id);

    return res.status(200).json({
      message: 'Test details fetched.',
      data: {
        id: test.id,
        name: test.name,
        test_code: test.test_code,
        category: test.category_name,
        sample_type: test.sample_type,
        description: test.description,
        preparation_instructions: test.preparation_instructions,
        includes: test.includes ? (typeof test.includes === 'string' ? JSON.parse(test.includes) : test.includes) : [],
        report_delivery_hours: pricing ? pricing.report_delivery_hours : test.report_delivery_hours,
        home_collection_available: test.home_collection_available,
        price: pricing ? pricing.price : null,
        discount_percent: pricing ? pricing.discount_percent : null,
      },
    });
  } catch (error) {
    console.error('getTestDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/lab-bookings?status=&page=&limit=
 * Lab test booking history for user
 */
const getLabBookings = async (req, res) => {
  try {
    const { pool } = require('../../config/database');
    const userId = req.user.id;
    const { status, page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ["b.user_id = ?", "b.service_type = 'pathology_test'"];
    let params = [userId];
    if (status) { where.push('b.status = ?'); params.push(status); }

    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM bookings b WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT b.booking_id, b.status, b.booking_date, b.base_amount, b.discount_amount, b.final_amount, b.payment_status, b.payment_method, b.metadata, b.user_rating, b.created_at,
              pl.uuid as lab_uuid, pl.name as lab_name, pl.profile_photo as lab_photo
       FROM bookings b
       JOIN pathology_labs pl ON b.provider_id = pl.id
       WHERE ${whereClause}
       ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Lab bookings fetched.',
      data: rows.map(b => {
        const metadata = b.metadata ? (typeof b.metadata === 'string' ? JSON.parse(b.metadata) : b.metadata) : {};
        return {
          booking_id: b.booking_id,
          status: b.status,
          booking_date: b.booking_date,
          lab: { id: b.lab_uuid, name: b.lab_name, photo: b.lab_photo },
          tests: metadata.tests || [],
          collection_type: metadata.collection_type || null,
          amount: { base: b.base_amount, discount: b.discount_amount, total: b.final_amount },
          payment_status: b.payment_status,
          user_rating: b.user_rating,
          created_at: b.created_at,
        };
      }),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('getLabBookings error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/lab-booking/:booking_id
 * Lab booking detail
 */
const getLabBookingDetail = async (req, res) => {
  try {
    const { pool } = require('../../config/database');
    const [rows] = await pool.query(
      `SELECT b.*, pl.uuid as lab_uuid, pl.name as lab_name, pl.profile_photo as lab_photo, pl.mobile as lab_mobile, pl.address_line1 as lab_address, pl.city as lab_city
       FROM bookings b
       JOIN pathology_labs pl ON b.provider_id = pl.id
       WHERE b.booking_id = ? AND b.user_id = ? AND b.service_type = 'pathology_test'`,
      [req.params.booking_id, req.user.id]
    );

    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });
    const b = rows[0];
    const metadata = b.metadata ? (typeof b.metadata === 'string' ? JSON.parse(b.metadata) : b.metadata) : {};

    return res.status(200).json({
      message: 'Lab booking detail fetched.',
      data: {
        booking_id: b.booking_id,
        status: b.status,
        booking_date: b.booking_date,
        slot_time: b.slot_start_time,
        lab: { id: b.lab_uuid, name: b.lab_name, photo: b.lab_photo, mobile: b.lab_mobile, address: b.lab_address, city: b.lab_city },
        tests: metadata.tests || [],
        collection_type: metadata.collection_type || null,
        attachments: metadata.attachments || [],
        amount: { base: b.base_amount, discount: b.discount_amount, tax: b.tax_amount, total: b.final_amount },
        payment: { method: b.payment_method, status: b.payment_status, transaction_id: b.transaction_id, paid_at: b.paid_at },
        user_notes: b.user_notes,
        provider_notes: b.provider_notes,
        rating: { user_rating: b.user_rating, user_review: b.user_review, rated_at: b.rated_at },
        timeline: { created_at: b.created_at, confirmed_at: b.confirmed_at, started_at: b.started_at, completed_at: b.completed_at, cancelled_at: b.cancelled_at },
        cancellation_reason: b.cancellation_reason,
      },
    });
  } catch (error) {
    console.error('getLabBookingDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getLabList,
  getLabDetail,
  getTestCategories,
  searchTests,
  getTestDetail,
  getLabBookings,
  getLabBookingDetail,
};
