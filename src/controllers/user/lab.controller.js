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
    const { page = 1, limit = 10, search, test_id, city } = req.query;

    const result = await labModel.getLabList({
      page: parseInt(page),
      limit: parseInt(limit),
      search: search || null,
      test_id: test_id ? parseInt(test_id) : null,
      city: city || null,
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

    return res.status(200).json({
      success: true,
      message: 'Labs fetched.',
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
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
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
      return res.status(404).json({ success: false, message: 'Lab not found.' });
    }

    const tests = await labModel.getLabTests(lab.id);
    const reviews = await labModel.getLabReviews(lab.id);

    // Group tests by category
    const testsByCategory = {};
    for (const test of tests) {
      const cat = test.category_name || 'Other';
      if (!testsByCategory[cat]) testsByCategory[cat] = [];
      testsByCategory[cat].push({
        id: test.id,
        name: test.name,
        test_code: test.test_code,
        sample_type: test.sample_type,
        price: test.price,
        discount_percent: test.discount_percent,
        report_hours: test.report_delivery_hours,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Lab profile fetched.',
      data: {
        id: lab.uuid,
        name: lab.name,
        profile_photo: lab.profile_photo,
        rating: lab.average_rating,
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
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/lab-test-categories
 * Test categories list
 */
const getTestCategories = async (req, res) => {
  try {
    const categories = await labModel.getTestCategories();
    return res.status(200).json({
      success: true,
      message: 'Test categories fetched.',
      data: categories,
    });
  } catch (error) {
    console.error('getTestCategories error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
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
      return res.status(400).json({ success: false, message: 'Search query (min 2 chars) required.' });
    }

    const tests = await labModel.searchTests(search);
    return res.status(200).json({
      success: true,
      message: 'Tests fetched.',
      data: tests,
    });
  } catch (error) {
    console.error('searchTests error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

module.exports = {
  getLabList,
  getLabDetail,
  getTestCategories,
  searchTests,
};
