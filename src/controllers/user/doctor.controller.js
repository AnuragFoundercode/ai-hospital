const doctorModel = require('../../models/user/doctor.model');
const doctorCategoryModel = require('../../models/user/doctorCategory.model');

// ─────────────────────────────────────────────
// DOCTOR CONTROLLER - For patient app (user side)
// ─────────────────────────────────────────────

/**
 * Shared: build the doctor-list payload (same shape used by REST + SSE).
 */
const buildDoctorList = async (query = {}) => {
  const { page = 1, limit = 10, category_id, min_rating, search } = query;

  const result = await doctorModel.getList({
    page: parseInt(page),
    limit: parseInt(limit),
    category_id: category_id ? parseInt(category_id) : null,
    min_rating: min_rating ? parseFloat(min_rating) : null,
    search: search || null,
  });

  const doctors = result.doctors.map((doc) => ({
    id: doc.uuid,
    name: doc.full_name,
    gender: doc.gender,
    profile_photo: doc.profile_photo,
    rating: doc.average_rating,
    per_minute_fee: doc.per_minute_fee,
    call_status: doc.call_status,
    is_online: doc.call_status === 'online',
    qualification: doc.qualification,
    experience_years: doc.experience_years,
    category: doc.category_name,
  }));

  return {
    data: doctors,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      total_pages: Math.ceil(result.total / result.limit),
    },
  };
};

/**
 * GET /api/v1/user/doctors
 * Query: page, limit, category_id, min_rating, search
 */
const getDoctorList = async (req, res) => {
  try {
    const payload = await buildDoctorList(req.query);
    return res.status(200).json({ message: 'Doctors fetched.', ...payload });
  } catch (error) {
    console.error('getDoctorList error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/doctors/stream
 * SSE: pushes the SAME doctor-list payload as GET /user/doctors, refreshed
 * periodically so the client always has live call_status without re-fetching.
 * Query: page, limit, category_id, min_rating, search (same as REST)
 */
const streamDoctorList = async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const query = { ...req.query };
  let lastSnapshot = null;
  let closed = false;

  const pushList = async () => {
    if (closed) return;
    try {
      const payload = await buildDoctorList(query);
      // Only send when something changed (avoids spamming identical frames)
      const snapshot = JSON.stringify(payload.data);
      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        res.write(`event: doctors\ndata: ${JSON.stringify(payload)}\n\n`);
      }
    } catch (e) {
      console.error('streamDoctorList error:', e.message);
    }
  };

  // Initial push immediately, then refresh every 5s
  await pushList();
  const interval = setInterval(pushList, 5000);
  const heartbeat = setInterval(() => { if (!closed) res.write(': hb\n\n'); }, 30000);

  req.on('close', () => {
    closed = true;
    clearInterval(interval);
    clearInterval(heartbeat);
  });
};

/**
 * GET /api/v1/user/doctor-categories
 */
const getDoctorCategories = async (req, res) => {
  try {
    const categories = await doctorCategoryModel.getAll();

    return res.status(200).json({      message: 'Doctor categories fetched.',
      data: categories,
    });
  } catch (error) {
    console.error('getDoctorCategories error:', error.message);
    return res.status(500).json({      message: 'Something went wrong.',
    });
  }
};

/**
 * GET /api/v1/user/doctor/:id
 * Full doctor profile
 */
const getDoctorProfile = async (req, res) => {
  try {
    const { id } = req.params;

    // Find doctor by uuid
    const doctor = await doctorModel.findByUuid(id);

    if (!doctor) {
      return res.status(404).json({        message: 'Doctor not found.',
      });
    }

    // Get reviews
    const reviews = await doctorModel.getReviews(doctor.id, 10);

    // Format reviews
    const formattedReviews = reviews.map((r) => ({
      user_name: r.full_name,
      user_photo: r.profile_photo,
      rating: r.user_rating,
      review: r.user_review,
      date: r.rated_at,
    }));

    return res.status(200).json({      message: 'Doctor profile fetched.',
      data: {
        id: doctor.uuid,
        name: doctor.full_name,
        gender: doctor.gender,
        profile_photo: doctor.profile_photo,
        category: doctor.category_name,
        rating: doctor.average_rating,
        total_consultations: doctor.total_consultations,
        about: doctor.bio,
        qualification: doctor.qualification,
        specialization: doctor.specialization,
        experience_years: doctor.experience_years,
        registration_number: doctor.registration_number,
        registration_council: doctor.registration_council,
        languages: doctor.languages,
        per_minute_fee: doctor.per_minute_fee,
        call_status: doctor.call_status,
        is_online: doctor.call_status === 'online',
        reviews: formattedReviews,
      },
    });
  } catch (error) {
    console.error('getDoctorProfile error:', error.message);
    return res.status(500).json({      message: 'Something went wrong.',
    });
  }
};

/**
 * GET /api/v1/user/emergency-doctors?page=&limit=&search=
 * Browse doctors available for emergency video calls + admin emergency config.
 */
const getEmergencyDoctors = async (req, res) => {
  try {
    const { pool } = require('../../config/database');
    const { page = 1, limit = 10, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = ['d.is_active = 1', 'd.is_verified = 1', 'd.is_emergency_available = 1'];
    const params = [];
    if (search) { where.push('d.full_name LIKE ?'); params.push(`%${search}%`); }
    const whereClause = where.join(' AND ');

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM doctors d WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT d.uuid, d.full_name, d.gender, d.profile_photo, d.average_rating, d.per_minute_fee,
              d.call_status, d.qualification, d.experience_years, dc.name AS category_name
       FROM doctors d
       LEFT JOIN doctor_categories dc ON d.category_id = dc.id
       WHERE ${whereClause}
       ORDER BY FIELD(d.call_status,'online','busy','offline'), d.average_rating DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const [cfg] = await pool.query(
      "SELECT config_key, config_value FROM admin_config WHERE config_key IN ('emergency_call_is_free','emergency_call_fee','emergency_call_duration_minutes')"
    );
    const cfgMap = {};
    cfg.forEach((c) => { cfgMap[c.config_key] = c.config_value; });
    const isFree = String(cfgMap.emergency_call_is_free) === 'true';

    return res.status(200).json({
      message: 'Emergency doctors fetched.',
      config: {
        is_free: isFree,
        fee: isFree ? 0 : parseFloat(cfgMap.emergency_call_fee || 0),
        duration_minutes: parseInt(cfgMap.emergency_call_duration_minutes || 10),
      },
      data: rows.map((d) => ({
        id: d.uuid,
        name: d.full_name,
        gender: d.gender,
        profile_photo: d.profile_photo,
        rating: d.average_rating,
        call_status: d.call_status,
        is_online: d.call_status === 'online',
        qualification: d.qualification,
        experience_years: d.experience_years,
        category: d.category_name,
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countRows[0].total, total_pages: Math.ceil(countRows[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('getEmergencyDoctors error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getDoctorList,
  streamDoctorList,
  getEmergencyDoctors,
  getDoctorCategories,
  getDoctorProfile,
};
