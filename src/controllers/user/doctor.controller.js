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

    const doctorIds = result.doctors.map((d) => d.id);
    const availability = await doctorModel.getTodayAvailability(doctorIds);

    const doctors = result.doctors.map((doc) => ({
      id: doc.uuid,
      name: doc.full_name,
      gender: doc.gender,
      profile_photo: doc.profile_photo,
      rating: doc.average_rating,
      consultation_fee: doc.consultation_fee,
      qualification: doc.qualification,
      experience_years: doc.experience_years,
      category: doc.category_name,
      today_available: availability[doc.id] ? true : false,
      today_slots: availability[doc.id] || [],
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

    // Get weekly availability
    const availability = await doctorModel.getWeeklyAvailability(doctor.id);

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

    // Format availability by day
    const weeklySchedule = {};
    for (const slot of availability) {
      if (!weeklySchedule[slot.day_of_week]) {
        weeklySchedule[slot.day_of_week] = [];
      }
      weeklySchedule[slot.day_of_week].push({
        start_time: slot.start_time,
        end_time: slot.end_time,
        slot_duration_minutes: slot.slot_duration_minutes,
        consultation_type: slot.consultation_type,
      });
    }

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
        consultation_fee: doctor.consultation_fee,
        follow_up_fee: doctor.follow_up_fee,
        is_available_online: doctor.is_available_online,
        availability: weeklySchedule,
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
 * GET /api/v1/user/doctor/:id/slots?date=2026-07-28
 * Get available time slots for a doctor on a specific date
 */
const getDoctorSlots = async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({        message: 'Date is required. Format: YYYY-MM-DD',
      });
    }

    // Find doctor
    const doctor = await doctorModel.findByUuid(id);
    if (!doctor) {
      return res.status(404).json({        message: 'Doctor not found.',
      });
    }

    // Get slots
    const slots = await doctorModel.getSlotsByDate(doctor.id, date);

    // Separate available & booked
    const available_slots = slots.filter((s) => !s.is_booked);
    const booked_slots = slots.filter((s) => s.is_booked);

    return res.status(200).json({      message: 'Slots fetched.',
      data: {
        doctor_id: doctor.uuid,
        doctor_name: doctor.full_name,
        date,
        total_slots: slots.length,
        available_count: available_slots.length,
        booked_count: booked_slots.length,
        slots,
      },
    });
  } catch (error) {
    console.error('getDoctorSlots error:', error.message);
    return res.status(500).json({      message: 'Something went wrong.',
    });
  }
};

module.exports = {
  getDoctorList,
  getDoctorCategories,
  getDoctorProfile,
  getDoctorSlots,
};
