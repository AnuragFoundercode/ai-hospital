const jwt = require('jsonwebtoken');
const doctorModel = require('../../models/doctor/doctor.model');

// ─────────────────────────────────────────────
// DOCTOR CONTROLLER - Doctor Panel APIs
// ─────────────────────────────────────────────

const STATIC_OTP = '111111';

/**
 * POST /api/v1/doctor/send-otp
 */
const sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number required.' });
    }

    let doctor = await doctorModel.findByMobile(mobile);
    if (!doctor) {
      await doctorModel.create(mobile);
    }

    console.log(`📱 Doctor OTP for ${mobile}: ${STATIC_OTP}`);
    return res.status(200).json({ success: true, message: 'OTP sent successfully.', data: { mobile } });
  } catch (error) {
    console.error('doctor sendOtp error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/doctor/verify-otp
 */
const verifyOtp = async (req, res) => {
  try {
    const { mobile, otp, fcm_token } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({ success: false, message: 'Mobile and OTP required.' });
    }

    if (otp !== STATIC_OTP) {
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    const doctor = await doctorModel.findByMobile(mobile);
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found. Please send OTP first.' });
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
      success: true,
      message: is_new_user ? 'OTP verified. Please complete registration.' : 'Login successful.',
      data: {
        token,
        is_new_user,
        registration_step: doctor.registration_step || 0,
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
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/doctor/registration/step1
 * Personal Details: name, email, dob, gender
 */
const step1Personal = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { full_name, email, date_of_birth, gender } = req.body;

    if (!full_name || full_name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Full name is required.' });
    }

    await doctorModel.updatePersonalDetails(doctorId, { full_name: full_name.trim(), email, date_of_birth, gender });

    return res.status(200).json({
      success: true,
      message: 'Personal details saved.',
      data: { registration_step: 1 },
    });
  } catch (error) {
    console.error('step1 error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/doctor/registration/step2
 * Professional: category_id, qualification, experience, registration_number, fees, languages
 */
const step2Professional = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { category_id, qualification, experience_years, registration_number, consultation_fee, follow_up_fee, spoken_languages } = req.body;

    if (!qualification || !registration_number) {
      return res.status(400).json({ success: false, message: 'Qualification and registration number required.' });
    }

    await doctorModel.updateProfessionalDetails(doctorId, {
      category_id,
      qualification,
      experience_years,
      registration_number,
      consultation_fee,
      follow_up_fee,
      spoken_languages: Array.isArray(spoken_languages) ? spoken_languages.join(', ') : spoken_languages,
    });

    return res.status(200).json({
      success: true,
      message: 'Professional details saved.',
      data: { registration_step: 2 },
    });
  } catch (error) {
    console.error('step2 error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/doctor/registration/step3
 * Clinic: clinic_name, address, city, state, pincode, zone
 */
const step3Clinic = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { clinic_name, address, city, state, pincode, zone } = req.body;

    if (!clinic_name || !address || !city || !state || !pincode) {
      return res.status(400).json({ success: false, message: 'All clinic fields are required.' });
    }

    await doctorModel.upsertClinicDetails(doctorId, { clinic_name, address, city, state, pincode, zone });

    return res.status(200).json({
      success: true,
      message: 'Clinic details saved.',
      data: { registration_step: 3 },
    });
  } catch (error) {
    console.error('step3 error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/doctor/registration/step4
 * Documents: medical_registration_certificate, degree_certificate, aadhaar_card, pan_card, profile_photo
 * All are Cloudinary URLs
 */
const step4Documents = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { medical_registration_certificate, degree_certificate, aadhaar_card, pan_card, profile_photo } = req.body;

    if (!medical_registration_certificate || !degree_certificate) {
      return res.status(400).json({ success: false, message: 'Medical registration certificate and degree certificate are required.' });
    }

    await doctorModel.updateDocuments(doctorId, {
      medical_registration_certificate,
      degree_certificate,
      aadhaar_card,
      pan_card,
      profile_photo,
    });

    return res.status(200).json({
      success: true,
      message: 'Documents uploaded.',
      data: { registration_step: 4 },
    });
  } catch (error) {
    console.error('step4 error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/doctor/registration/step5
 * Bank: account_holder_name, bank_name, account_number, ifsc_code
 * After this → account goes to "pending" verification by admin
 */
const step5Bank = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { account_holder_name, bank_name, account_number, ifsc_code } = req.body;

    if (!account_holder_name || !bank_name || !account_number || !ifsc_code) {
      return res.status(400).json({ success: false, message: 'All bank fields are required.' });
    }

    await doctorModel.upsertBankDetails(doctorId, { account_holder_name, bank_name, account_number, ifsc_code });

    return res.status(200).json({
      success: true,
      message: 'Registration complete! Your account is under review. Admin will verify and approve.',
      data: { registration_step: 5, verification_status: 'pending' },
    });
  } catch (error) {
    console.error('step5 error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/doctor/profile
 */
const getProfile = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const doctor = await doctorModel.findById(doctorId);
    const clinic = await doctorModel.getClinicDetails(doctorId);
    const bank = await doctorModel.getBankDetails(doctorId);

    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile fetched.',
      data: {
        id: doctor.uuid,
        registration_step: doctor.registration_step,
        verification_status: doctor.verification_status,
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
          specialization: doctor.specialization,
          registration_number: doctor.registration_number,
          registration_council: doctor.registration_council,
          experience_years: doctor.experience_years,
          consultation_fee: doctor.consultation_fee,
          follow_up_fee: doctor.follow_up_fee,
          spoken_languages: doctor.spoken_languages,
          is_available_online: doctor.is_available_online,
        },
        clinic: clinic ? {
          clinic_name: clinic.clinic_name,
          address: clinic.address,
          city: clinic.city,
          state: clinic.state,
          pincode: clinic.pincode,
          zone: clinic.zone,
        } : null,
        documents: {
          medical_registration_certificate: doctor.medical_license_url,
          degree_certificate: doctor.degree_certificate_url,
          aadhaar_card: doctor.aadhaar_url,
          pan_card: doctor.pan_card_url,
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
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/doctor/toggle-availability
 * Toggle online/offline status
 */
const toggleAvailability = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const doctor = await doctorModel.findById(doctorId);

    const newStatus = doctor.is_available_online ? 0 : 1;
    await doctorModel.updateProfile(doctorId, { is_available_online: newStatus });

    return res.status(200).json({
      success: true,
      message: newStatus ? 'You are now online.' : 'You are now offline.',
      data: { is_available_online: newStatus },
    });
  } catch (error) {
    console.error('toggleAvailability error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

module.exports = {
  sendOtp,
  verifyOtp,
  step1Personal,
  step2Professional,
  step3Clinic,
  step4Documents,
  step5Bank,
  getProfile,
  toggleAvailability,
};
