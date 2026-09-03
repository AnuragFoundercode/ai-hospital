const jwt = require('jsonwebtoken');
const doctorModel = require('../../models/doctor/doctor.model');

// ─────────────────────────────────────────────
// DOCTOR CONTROLLER - vendor-style 4-step registration
// step1 personal | step2 professional | step3 documents | step4 bank
// ─────────────────────────────────────────────

const STATIC_OTP = '111111';

/**
 * POST /api/v1/doctor/send-otp
 */
const sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({ message: 'Valid 10-digit mobile number required.' });
    }

    let doctor = await doctorModel.findByMobile(mobile);
    if (!doctor) {
      await doctorModel.create(mobile);
    }

    console.log(`📱 Doctor OTP for ${mobile}: ${STATIC_OTP}`);
    return res.status(200).json({ message: 'OTP sent successfully.', data: { mobile } });
  } catch (error) {
    console.error('doctor sendOtp error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/doctor/verify-otp
 */
const verifyOtp = async (req, res) => {
  try {
    const { mobile, otp, fcm_token } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({ message: 'Mobile and OTP required.' });
    }

    if (otp !== STATIC_OTP) {
      return res.status(400).json({ message: 'Invalid OTP.' });
    }

    const doctor = await doctorModel.findByMobile(mobile);
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found. Please send OTP first.' });
    }

    if (fcm_token) {
      await doctorModel.updateFcmToken(doctor.id, fcm_token);
    }

    const is_new_user = !doctor.full_name || doctor.full_name.trim() === '';

    const token = jwt.sign(
      { id: doctor.id, uuid: doctor.uuid, role: 'doctor' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(200).json({
      message: is_new_user ? 'OTP verified. Please complete registration.' : 'Login successful.',
      data: {
        token,
        is_new_user,
        registration_step: doctor.registration_step || 0,
        verification_status: doctor.verification_status,
        doctor: {
          id: doctor.uuid,
          full_name: doctor.full_name,
          mobile: doctor.mobile,
          profile_photo: doctor.profile_photo,
          verification_status: doctor.verification_status,
        },
      },
    });
  } catch (error) {
    console.error('doctor verifyOtp error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/doctor/categories
 * Specialization dropdown list (from doctor_categories)
 */
const getCategories = async (req, res) => {
  try {
    const categories = await doctorModel.getCategories();
    return res.status(200).json({ message: 'Categories fetched.', data: categories });
  } catch (error) {
    console.error('doctor getCategories error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/doctor/registration/step1
 * Personal: full_name, email, date_of_birth, gender
 */
const step1Personal = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { full_name, email, date_of_birth, gender } = req.body;

    if (!full_name || full_name.trim() === '') {
      return res.status(400).json({ message: 'Full name is required.' });
    }
    if (gender && !['male', 'female', 'other'].includes(gender)) {
      return res.status(400).json({ message: 'gender must be male, female or other.' });
    }

    await doctorModel.updatePersonalDetails(doctorId, { full_name: full_name.trim(), email, date_of_birth, gender });

    return res.status(200).json({ message: 'Personal details saved.', data: { registration_step: 1 } });
  } catch (error) {
    console.error('doctor step1 error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/doctor/registration/step2
 * Professional: category_id (specialization), qualification, experience_years, registration_number, per_minute_fee
 */
const step2Professional = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { category_id, qualification, experience_years, registration_number, per_minute_fee } = req.body;

    if (!category_id) {
      return res.status(400).json({ message: 'category_id (specialization) is required.' });
    }
    if (!qualification || !registration_number) {
      return res.status(400).json({ message: 'Qualification and registration number required.' });
    }
    if (per_minute_fee === undefined || per_minute_fee === null || parseFloat(per_minute_fee) < 0) {
      return res.status(400).json({ message: 'Valid per_minute_fee required.' });
    }

    await doctorModel.updateProfessionalDetails(doctorId, {
      category_id,
      qualification,
      experience_years,
      registration_number,
      per_minute_fee,
    });

    return res.status(200).json({ message: 'Professional details saved.', data: { registration_step: 2 } });
  } catch (error) {
    console.error('doctor step2 error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/doctor/registration/step3
 * Documents: medical_registration_url, degree_certificate_url, aadhaar_card_url, pan_card_url, profile_photo
 */
const step3Documents = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { medical_registration_url, degree_certificate_url, aadhaar_card_url, pan_card_url, profile_photo } = req.body;

    if (!medical_registration_url || !degree_certificate_url) {
      return res.status(400).json({ message: 'Medical registration and degree certificate URLs are required.' });
    }

    await doctorModel.updateDocuments(doctorId, {
      medical_registration_url,
      degree_certificate_url,
      aadhaar_card_url,
      pan_card_url,
      profile_photo,
    });

    return res.status(200).json({ message: 'Documents uploaded.', data: { registration_step: 3 } });
  } catch (error) {
    console.error('doctor step3 error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/doctor/registration/step4
 * Bank: account_number, bank_name, account_holder_name, ifsc_code
 * → submit → verification_status = 'pending' (admin verifies)
 */
const step4Bank = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { account_number, bank_name, account_holder_name, ifsc_code } = req.body;

    if (!account_number || !bank_name || !account_holder_name || !ifsc_code) {
      return res.status(400).json({ message: 'All bank fields are required.' });
    }

    await doctorModel.upsertBankDetails(doctorId, { account_holder_name, bank_name, account_number, ifsc_code });

    return res.status(200).json({
      message: 'Registration complete! Your account is under review. Admin will verify and approve.',
      data: { registration_step: 4, verification_status: 'pending' },
    });
  } catch (error) {
    console.error('doctor step4 error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/doctor/profile
 */
const getProfile = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const doctor = await doctorModel.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found.' });
    }
    const bank = await doctorModel.getBankDetails(doctorId);

    return res.status(200).json({
      message: 'Profile fetched.',
      data: {
        id: doctor.uuid,
        registration_step: doctor.registration_step,
        verification_status: doctor.verification_status,
        call_status: doctor.call_status,
        admin_commission_percent: doctor.admin_commission_percent,
        personal: {
          full_name: doctor.full_name,
          mobile: doctor.mobile,
          email: doctor.email,
          gender: doctor.gender,
          date_of_birth: doctor.date_of_birth,
          profile_photo: doctor.profile_photo,
        },
        professional: {
          category: doctor.category_name,
          category_id: doctor.category_id,
          qualification: doctor.qualification,
          registration_number: doctor.registration_number,
          experience_years: doctor.experience_years,
          per_minute_fee: doctor.per_minute_fee,
        },
        documents: {
          medical_registration_url: doctor.medical_license_url,
          degree_certificate_url: doctor.degree_certificate_url,
          aadhaar_card_url: doctor.aadhaar_url,
          pan_card_url: doctor.pan_card_url,
          profile_photo: doctor.profile_photo,
        },
        bank: bank ? {
          account_holder_name: bank.account_holder_name,
          bank_name: bank.bank_name,
          account_number: bank.account_number,
          ifsc_code: bank.ifsc_code,
        } : null,
        stats: {
          average_rating: doctor.average_rating,
          total_consultations: doctor.total_consultations,
        },
      },
    });
  } catch (error) {
    console.error('doctor getProfile error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/doctor/call-status
 * 3-state: online | offline | busy (online requires approved account)
 */
const updateCallStatus = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { status } = req.body;

    if (!['online', 'offline', 'busy'].includes(status)) {
      return res.status(400).json({ message: 'status must be online, offline or busy.' });
    }

    const doctor = await doctorModel.findById(doctorId);
    if (status === 'online' && doctor.verification_status !== 'approved') {
      return res.status(400).json({ message: 'Account not verified yet. Cannot go online.' });
    }

    await doctorModel.updateProfile(doctorId, { call_status: status });

    const msg = { online: 'You are now online.', offline: 'You are now offline.', busy: 'You are now busy.' }[status];
    return res.status(200).json({ message: msg, data: { call_status: status } });
  } catch (error) {
    console.error('doctor updateCallStatus error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  sendOtp,
  verifyOtp,
  getCategories,
  step1Personal,
  step2Professional,
  step3Documents,
  step4Bank,
  getProfile,
  updateCallStatus,
};
