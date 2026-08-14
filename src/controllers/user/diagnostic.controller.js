const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// DIAGNOSTIC CONTROLLER - User Panel
// ─────────────────────────────────────────────

/**
 * GET /api/v1/user/diagnostic-categories
 */
const getCategories = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, icon_url FROM diagnostic_categories WHERE is_active = 1 ORDER BY sort_order');
    return res.status(200).json({ message: 'Categories fetched.', data: rows });
  } catch (error) {
    console.error('user diagnostic getCategories error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/diagnostics?search=&category_id=&city=&page=1&limit=10
 * Diagnostic centers list
 */
const getDiagnosticList = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, category_id, city } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['dc.is_active = 1', 'dc.is_verified = 1'];
    let params = [];
    let join = '';

    if (search) {
      where.push('dc.name LIKE ?');
      params.push(`%${search}%`);
    }

    if (city) {
      where.push('dc.city = ?');
      params.push(city);
    }

    if (category_id) {
      join = 'JOIN diagnostic_service_pricing dsp ON dc.id = dsp.diagnostic_center_id JOIN diagnostic_services ds ON dsp.service_id = ds.id AND ds.category_id = ?';
      params.unshift(parseInt(category_id));
    }

    const whereClause = where.join(' AND ');

    const [countResult] = await pool.query(
      `SELECT COUNT(DISTINCT dc.id) as total FROM diagnostic_centers dc ${join} WHERE ${whereClause}`, params
    );

    const [rows] = await pool.query(
      `SELECT DISTINCT dc.id, dc.uuid, dc.name, dc.profile_photo, dc.address_line1, dc.city, dc.state, dc.average_rating, dc.opening_time, dc.closing_time
       FROM diagnostic_centers dc ${join}
       WHERE ${whereClause}
       ORDER BY dc.average_rating DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Diagnostic centers fetched.',
      data: rows.map((r) => ({
        id: r.uuid,
        name: r.name,
        profile_photo: r.profile_photo,
        address: r.address_line1,
        city: r.city,
        state: r.state,
        rating: r.average_rating,
        opening_time: r.opening_time,
        closing_time: r.closing_time,
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        total_pages: Math.ceil(countResult[0].total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('user getDiagnosticList error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/diagnostic/:id
 * Full diagnostic center profile
 */
const getDiagnosticDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      'SELECT * FROM diagnostic_centers WHERE uuid = ? AND is_active = 1 AND is_verified = 1', [id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Diagnostic center not found.' });
    }

    const center = rows[0];

    // Get services
    const [services] = await pool.query(
      `SELECT dsp.id as pricing_id, ds.name, dc.name as category_name, dsp.price, dsp.discount_percent, dsp.duration_minutes
       FROM diagnostic_service_pricing dsp
       JOIN diagnostic_services ds ON dsp.service_id = ds.id
       LEFT JOIN diagnostic_categories dc ON ds.category_id = dc.id
       WHERE dsp.diagnostic_center_id = ? AND dsp.is_available = 1
       ORDER BY dc.sort_order, ds.name`,
      [center.id]
    );

    // Get reviews
    const [reviews] = await pool.query(
      `SELECT b.user_rating, b.user_review, b.rated_at, u.full_name, u.profile_photo
       FROM bookings b JOIN users u ON b.user_id = u.id
       WHERE b.service_type = 'diagnostic_scan' AND b.provider_id = ? AND b.user_rating IS NOT NULL
       ORDER BY b.rated_at DESC LIMIT 10`,
      [center.id]
    );

    // Available services grouped by category
    const servicesByCategory = {};
    for (const s of services) {
      const cat = s.category_name || 'Other';
      if (!servicesByCategory[cat]) servicesByCategory[cat] = [];
      servicesByCategory[cat].push({
        id: s.pricing_id,
        name: s.name,
        price: s.price,
        discount_percent: s.discount_percent,
        duration_minutes: s.duration_minutes,
      });
    }

    return res.status(200).json({
      message: 'Diagnostic center detail fetched.',
      data: {
        id: center.uuid,
        name: center.name,
        profile_photo: center.profile_photo,
        rating: center.average_rating,
        about: {
          owner_name: center.owner_name,
          nabh_accreditation: center.nabh_accreditation_number,
          registration_number: center.registration_number,
        },
        contact: {
          mobile: center.mobile,
          email: center.email,
        },
        location: {
          address: center.address_line1,
          address_line2: center.address_line2,
          city: center.city,
          state: center.state,
          pincode: center.pincode,
          latitude: center.latitude,
          longitude: center.longitude,
        },
        timing: {
          opening_time: center.opening_time,
          closing_time: center.closing_time,
        },
        services: servicesByCategory,
        total_services: services.length,
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
    console.error('user getDiagnosticDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/diagnostic/:id/services?category_id=
 * Services of a specific diagnostic center
 */
const getDiagnosticServices = async (req, res) => {
  try {
    const { id } = req.params;
    const { category_id } = req.query;

    const [centerRows] = await pool.query('SELECT id FROM diagnostic_centers WHERE uuid = ? AND is_active = 1', [id]);
    if (!centerRows.length) {
      return res.status(404).json({ message: 'Diagnostic center not found.' });
    }

    const centerId = centerRows[0].id;
    let where = ['dsp.diagnostic_center_id = ?', 'dsp.is_available = 1'];
    let params = [centerId];

    if (category_id) {
      where.push('ds.category_id = ?');
      params.push(parseInt(category_id));
    }

    const [rows] = await pool.query(
      `SELECT dsp.id as pricing_id, dsp.service_id, ds.name, ds.description, ds.preparation_instructions, ds.is_fasting_required, ds.is_contrast_required, ds.report_delivery_hours, ds.patient_instructions, dc.name as category_name, dsp.price, dsp.discount_percent, dsp.duration_minutes, dsp.booking_type, dsp.slot_duration_minutes_config, dsp.working_days, dsp.working_hours_from, dsp.working_hours_to, dsp.break_from, dsp.break_to
       FROM diagnostic_service_pricing dsp
       JOIN diagnostic_services ds ON dsp.service_id = ds.id
       LEFT JOIN diagnostic_categories dc ON ds.category_id = dc.id
       WHERE ${where.join(' AND ')}
       ORDER BY dc.sort_order, ds.name`,
      params
    );

    return res.status(200).json({
      message: 'Services fetched.',
      data: rows.map((r) => ({
        id: r.pricing_id,
        service_id: r.service_id,
        name: r.name,
        category: r.category_name,
        price: r.price,
        discount_percent: r.discount_percent,
        duration_minutes: r.duration_minutes,
        description: r.description,
        preparation_instructions: r.preparation_instructions,
        is_fasting_required: r.is_fasting_required,
        is_contrast_required: r.is_contrast_required,
        report_delivery_hours: r.report_delivery_hours,
        patient_instructions: r.patient_instructions,
        booking_type: r.booking_type,
        slot_config: r.booking_type === 'appointment' ? {
          slot_duration: r.slot_duration_minutes_config,
          working_days: r.working_days ? r.working_days.split(',') : [],
          working_hours_from: r.working_hours_from,
          working_hours_to: r.working_hours_to,
          break_from: r.break_from,
          break_to: r.break_to,
        } : null,
      })),
    });
  } catch (error) {
    console.error('user getDiagnosticServices error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/diagnostic-service/:id
 * Single service detail
 */
const getServiceDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      `SELECT dsp.*, ds.name, ds.description, ds.preparation_instructions, ds.is_fasting_required, ds.is_contrast_required, ds.report_delivery_hours, ds.patient_instructions, ds.duration_minutes as default_duration, dc2.name as category_name, dc.name as center_name, dc.uuid as center_uuid
       FROM diagnostic_service_pricing dsp
       JOIN diagnostic_services ds ON dsp.service_id = ds.id
       JOIN diagnostic_centers dc ON dsp.diagnostic_center_id = dc.id
       LEFT JOIN diagnostic_categories dc2 ON ds.category_id = dc2.id
       WHERE dsp.id = ? AND dsp.is_available = 1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Service not found.' });
    }

    const s = rows[0];

    return res.status(200).json({
      message: 'Service detail fetched.',
      data: {
        id: s.id,
        name: s.name,
        category: s.category_name,
        center: { id: s.center_uuid, name: s.center_name },
        price: s.price,
        discount_percent: s.discount_percent,
        final_price: (parseFloat(s.price) - (parseFloat(s.price) * parseFloat(s.discount_percent) / 100)).toFixed(2),
        duration_minutes: s.duration_minutes,
        description: s.description,
        preparation_instructions: s.preparation_instructions,
        is_fasting_required: s.is_fasting_required,
        is_contrast_required: s.is_contrast_required,
        report_delivery_hours: s.report_delivery_hours,
        patient_instructions: s.patient_instructions,
        booking_type: s.booking_type,
        slot_config: s.booking_type === 'appointment' ? {
          slot_duration: s.slot_duration_minutes_config,
          working_days: s.working_days ? s.working_days.split(',') : [],
          working_hours_from: s.working_hours_from,
          working_hours_to: s.working_hours_to,
          break_from: s.break_from,
          break_to: s.break_to,
        } : null,
      },
    });
  } catch (error) {
    console.error('user getServiceDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/diagnostic-service/:id/slots?date=2026-08-16
 * Generate available time slots for a service on a specific date
 * Uses config from diagnostic_service_pricing (working_days, hours, slot_duration, break)
 * Excludes already booked slots
 */
const getServiceSlots = async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: 'date query param required (YYYY-MM-DD).' });
    }

    // Get service pricing with slot config
    const [rows] = await pool.query(
      `SELECT dsp.*, ds.name as service_name
       FROM diagnostic_service_pricing dsp
       JOIN diagnostic_services ds ON dsp.service_id = ds.id
       WHERE dsp.id = ? AND dsp.is_available = 1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Service not found.' });
    }

    const service = rows[0];

    if (service.booking_type === 'walk_in') {
      return res.status(200).json({
        message: 'Walk-in service. No slot selection needed.',
        data: { booking_type: 'walk_in', slots: [] },
      });
    }

    // Check if requested date's day is in working_days
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dateParts = date.split('-');
    const requestedDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
    const dayOfWeek = dayNames[requestedDate.getDay()];
    const workingDays = service.working_days ? service.working_days.split(',').map(d => d.trim().toLowerCase()) : [];

    if (!workingDays.includes(dayOfWeek)) {
      return res.status(200).json({
        message: 'Center is closed on this day.',
        data: { booking_type: 'appointment', date, day: dayOfWeek, is_working_day: false, slots: [] },
      });
    }

    // Generate time slots
    const slotDuration = service.slot_duration_minutes_config || 30;
    const startTime = service.working_hours_from || '08:00:00';
    const endTime = service.working_hours_to || '20:00:00';
    const breakFrom = service.break_from || null;
    const breakTo = service.break_to || null;

    const toMinutes = (timeStr) => {
      const parts = timeStr.split(':');
      return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    };

    const startMinutes = toMinutes(startTime);
    const endMinutes = toMinutes(endTime);
    const breakStartMin = breakFrom ? toMinutes(breakFrom) : null;
    const breakEndMin = breakTo ? toMinutes(breakTo) : null;

    const allSlots = [];
    let current = startMinutes;

    while (current + slotDuration <= endMinutes) {
      // Skip break time
      if (breakStartMin !== null && breakEndMin !== null) {
        if (current >= breakStartMin && current < breakEndMin) {
          current = breakEndMin;
          continue;
        }
      }

      const hours = Math.floor(current / 60).toString().padStart(2, '0');
      const mins = (current % 60).toString().padStart(2, '0');
      const endHours = Math.floor((current + slotDuration) / 60).toString().padStart(2, '0');
      const endMins = ((current + slotDuration) % 60).toString().padStart(2, '0');

      allSlots.push({
        slot_id: `${date.replace(/-/g, '')}_${hours}${mins}`,
        start_time: `${hours}:${mins}`,
        end_time: `${endHours}:${endMins}`,
      });

      current += slotDuration;
    }

    // Get already booked slots for this date + service
    const [bookedRows] = await pool.query(
      `SELECT slot_start_time FROM bookings 
       WHERE service_type = 'diagnostic_scan' AND provider_id = ? AND booking_date = ? 
       AND status NOT IN ('cancelled', 'failed')
       AND JSON_EXTRACT(metadata, '$.service_pricing_id') = ?`,
      [service.diagnostic_center_id, date, service.id]
    );

    const bookedTimes = bookedRows.map(b => {
      if (!b.slot_start_time) return null;
      const parts = b.slot_start_time.split(':');
      return `${parts[0]}:${parts[1]}`;
    }).filter(Boolean);

    // Mark availability
    const slots = allSlots.map(slot => ({
      ...slot,
      is_available: !bookedTimes.includes(slot.start_time),
    }));

    return res.status(200).json({
      message: 'Slots fetched.',
      data: {
        booking_type: 'appointment',
        date,
        day: dayOfWeek,
        is_working_day: true,
        service_name: service.service_name,
        slot_duration_minutes: slotDuration,
        total_slots: slots.length,
        available_slots: slots.filter(s => s.is_available).length,
        slots,
      },
    });
  } catch (error) {
    console.error('user getServiceSlots error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getCategories,
  getDiagnosticList,
  getDiagnosticDetail,
  getDiagnosticServices,
  getServiceDetail,
  getServiceSlots,
};
