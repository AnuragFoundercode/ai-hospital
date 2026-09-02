const doctorModel = require('../../models/user/doctor.model');
const doctorCategoryModel = require('../../models/user/doctorCategory.model');

// ─────────────────────────────────────────────
// DOCTOR CONTROLLER - For patient app (user side)
// ─────────────────────────────────────────────

/**
 * GET /api/v1/user/doctors
 * Query: page, limit, category_id, min_rating, search
 */
const getDoctorList = async (req, res) => {
  try {
    const { page = 1, limit = 10, category_id, min_rating, search } = req.query;

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

    const totalPages = Math.ceil(result.total / result.limit);

    return res.status(200).json({      message: 'Doctors fetched.',
      data: doctors,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        total_pages: totalPages,
      },
    });
  } catch (error) {
    console.error('getDoctorList error:', error.message);
    return res.status(500).json({      message: 'Something went wrong.',
    });
  }
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

module.exports = {
  getDoctorList,
  getDoctorCategories,
  getDoctorProfile,
};
