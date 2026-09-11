const { pool } = require('../../config/database');
const { parseQualifications } = require('../../utils/qualifications');
const { notify } = require('../../services/notify');

// ─────────────────────────────────────────────
// ADMIN DOCTOR MANAGEMENT
// ─────────────────────────────────────────────

/**
 * GET /api/v1/admin/doctors
 * Query: page, limit, search (name/mobile), verification_status, category_id
 * Header summary (NOT affected by filters): total / verified / pending / active / inactive
 */
const getDoctors = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, verification_status, category_id } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1'];
    const params = [];
    if (search) { where.push('(d.full_name LIKE ? OR d.mobile LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    if (verification_status) { where.push('d.verification_status = ?'); params.push(verification_status); }
    if (category_id) { where.push('d.category_id = ?'); params.push(parseInt(category_id)); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM doctors d WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT d.id, d.uuid, d.full_name, d.mobile, d.email, d.profile_photo, d.category_id, dc.name AS category_name,
              d.experience_years, d.per_minute_fee, d.average_rating, d.total_consultations,
              d.verification_status, d.is_active, d.is_emergency_available, d.call_status, d.created_at
       FROM doctors d LEFT JOIN doctor_categories dc ON d.category_id = dc.id
       WHERE ${whereClause} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    // Summary (global, ignores filters)
    const [[summary]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(verification_status = 'approved') AS verified,
              SUM(verification_status = 'pending') AS pending,
              SUM(is_active = 1) AS active,
              SUM(is_active = 0) AS inactive
       FROM doctors`
    );

    return res.status(200).json({
      message: 'Doctors fetched.',
      summary: {
        total_doctors: summary.total,
        verified_doctors: Number(summary.verified) || 0,
        pending_doctors: Number(summary.pending) || 0,
        active_doctors: Number(summary.active) || 0,
        inactive_doctors: Number(summary.inactive) || 0,
      },
      data: rows.map((d) => ({
        id: d.uuid,
        db_id: d.id,
        full_name: d.full_name,
        mobile: d.mobile,
        email: d.email,
        profile_photo: d.profile_photo,
        category: d.category_name,
        category_id: d.category_id,
        experience_years: d.experience_years,
        per_minute_fee: d.per_minute_fee,
        average_rating: d.average_rating,
        total_consultations: d.total_consultations,
        verification_status: d.verification_status,
        is_active: !!d.is_active,
        is_emergency_available: !!d.is_emergency_available,
        call_status: d.call_status,
        created_at: d.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getDoctors error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/doctors/:id/toggle-status
 */
const toggleDoctorStatus = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, is_active FROM doctors WHERE uuid = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Doctor not found.' });
    const next = rows[0].is_active ? 0 : 1;
    await pool.query('UPDATE doctors SET is_active = ? WHERE id = ?', [next, rows[0].id]);
    return res.status(200).json({ message: next ? 'Doctor activated.' : 'Doctor deactivated.', data: { id: req.params.id, is_active: !!next } });
  } catch (error) {
    console.error('admin toggleDoctorStatus error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/doctors/:id
 * Full profile + stats (appointments, today, earnings, rating, wallet balance).
 */
const getDoctorDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT d.*, dc.name AS category_name FROM doctors d LEFT JOIN doctor_categories dc ON d.category_id = dc.id WHERE d.uuid = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Doctor not found.' });
    const d = rows[0];

    const [bankRows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM doctor_bank_details WHERE doctor_id = ?', [d.id]);
    const [walletRows] = await pool.query('SELECT balance, total_earned, total_withdrawn FROM doctor_wallets WHERE doctor_id = ?', [d.id]);
    const wallet = walletRows[0] || { balance: 0, total_earned: 0, total_withdrawn: 0 };

    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().split('T')[0];
    const [[appts]] = await pool.query('SELECT COUNT(*) AS total FROM doctor_calls WHERE doctor_id = ?', [d.id]);
    const [[todayAppts]] = await pool.query('SELECT COUNT(*) AS total FROM doctor_calls WHERE doctor_id = ? AND DATE(created_at) = ?', [d.id, today]);

    return res.status(200).json({
      message: 'Doctor detail fetched.',
      data: {
        id: d.uuid,
        verification_status: d.verification_status,
        rejection_reason: d.rejection_reason,
        rejected_steps: d.rejected_steps ? d.rejected_steps.split(',').map(Number) : [],
        is_active: !!d.is_active,
        is_emergency_available: !!d.is_emergency_available,
        call_status: d.call_status,
        admin_commission_percent: d.admin_commission_percent,
        personal: {
          full_name: d.full_name, mobile: d.mobile, email: d.email, gender: d.gender,
          date_of_birth: d.date_of_birth, profile_photo: d.profile_photo,
        },
        professional: {
          category: d.category_name, category_id: d.category_id, specialization: d.specialization,
          qualification: d.qualification, registration_number: d.registration_number,
          registration_council: d.registration_council, experience_years: d.experience_years,
          per_minute_fee: d.per_minute_fee, spoken_languages: d.spoken_languages, bio: d.bio,
        },
        documents: {
          medical_license_url: d.medical_license_url, degree_certificate_url: d.degree_certificate_url,
          aadhaar_url: d.aadhaar_url, pan_card_url: d.pan_card_url, profile_photo: d.profile_photo,
        },
        qualifications: parseQualifications(d.qualifications),
        bank: bankRows[0] || null,
        stats: {
          total_appointments: appts.total,
          todays_appointments: todayAppts.total,
          total_earnings: wallet.total_earned,
          average_rating: d.average_rating,
          wallet_balance: wallet.balance,
        },
        created_at: d.created_at,
      },
    });
  } catch (error) {
    console.error('admin getDoctorDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const resolveDoctorId = async (uuid) => {
  const [rows] = await pool.query('SELECT id FROM doctors WHERE uuid = ?', [uuid]);
  return rows.length ? rows[0].id : null;
};

/**
 * GET /api/v1/admin/doctors/:id/appointments?page=&limit=&status=
 * Appointment (call) history + user details.
 */
const getDoctorAppointments = async (req, res) => {
  try {
    const docId = await resolveDoctorId(req.params.id);
    if (!docId) return res.status(404).json({ message: 'Doctor not found.' });

    const { status, page = 1, limit = 20 } = req.query;
    const where = ['dcl.doctor_id = ?']; const params = [docId];
    if (status) { where.push('dcl.status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM doctor_calls dcl WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT dcl.call_id, dcl.call_type, dcl.status, dcl.total_minutes, dcl.total_charged, dcl.doctor_earning, dcl.admin_commission, dcl.created_at, dcl.ended_at,
              u.uuid AS user_uuid, u.full_name AS user_name, u.profile_photo AS user_photo, u.mobile AS user_mobile
       FROM doctor_calls dcl JOIN users u ON dcl.user_id = u.id
       WHERE ${whereClause} ORDER BY dcl.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.status(200).json({
      message: 'Appointments fetched.',
      data: rows.map((r) => ({
        call_id: r.call_id, call_type: r.call_type, status: r.status,
        total_minutes: r.total_minutes, total_charged: r.total_charged,
        doctor_earning: r.doctor_earning, admin_commission: r.admin_commission,
        user: { id: r.user_uuid, name: r.user_name, profile_photo: r.user_photo, mobile: r.user_mobile },
        created_at: r.created_at, ended_at: r.ended_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getDoctorAppointments error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/doctors/:id/transactions?page=&limit=&type=
 */
const getDoctorTransactions = async (req, res) => {
  try {
    const docId = await resolveDoctorId(req.params.id);
    if (!docId) return res.status(404).json({ message: 'Doctor not found.' });

    const { type, page = 1, limit = 20 } = req.query;
    const where = ['doctor_id = ?']; const params = [docId];
    if (type) { where.push('type = ?'); params.push(type); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM doctor_wallet_transactions WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, type, amount, description, reference_type, reference_id, balance_after, created_at
       FROM doctor_wallet_transactions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Transactions fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getDoctorTransactions error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/doctors/:id/withdrawals?page=&limit=&status=
 */
const getDoctorWithdrawals = async (req, res) => {
  try {
    const docId = await resolveDoctorId(req.params.id);
    if (!docId) return res.status(404).json({ message: 'Doctor not found.' });

    const { status, page = 1, limit = 20 } = req.query;
    const where = ['doctor_id = ?']; const params = [docId];
    if (status) { where.push('status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM doctor_withdrawals WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, amount, status, remarks, admin_remarks, processed_at, created_at
       FROM doctor_withdrawals WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Withdrawals fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getDoctorWithdrawals error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getDoctors,
  toggleDoctorStatus,
  getDoctorDetail,
  getDoctorAppointments,
  getDoctorTransactions,
  getDoctorWithdrawals,
};
