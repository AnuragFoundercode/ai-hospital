const express = require('express');
const router = express.Router();
const doctorController = require('../../controllers/doctor/doctor.controller');
const appointmentController = require('../../controllers/doctor/appointment.controller');
const callController = require('../../controllers/doctor/call.controller');
const dashboardController = require('../../controllers/doctor/dashboard.controller');
const doctorAuth = require('../../middlewares/doctor/doctor.auth');
const { registerClient } = require('../../events/sse');

// ─────────────────────────────────────────────
// DOCTOR ROUTES - Doctor Panel APIs
// ─────────────────────────────────────────────

// Public routes
router.post('/send-otp', doctorController.sendOtp);
router.post('/verify-otp', doctorController.verifyOtp);

// Registration steps (token required)
router.put('/registration/step1', doctorAuth, doctorController.step1Personal);
router.put('/registration/step2', doctorAuth, doctorController.step2Professional);
router.put('/registration/step3', doctorAuth, doctorController.step3Clinic);
router.put('/registration/step4', doctorAuth, doctorController.step4Documents);
router.put('/registration/step5', doctorAuth, doctorController.step5Bank);

// Profile (token required)
router.get('/profile', doctorAuth, doctorController.getProfile);
router.put('/call-status', doctorAuth, doctorController.updateCallStatus);

// Video Calls (per-minute)
router.put('/call/:call_id/accept', doctorAuth, callController.acceptCall);
router.put('/call/:call_id/reject', doctorAuth, callController.rejectCall);
router.put('/call/:call_id/end', doctorAuth, callController.endCall);
router.post('/call/:call_id/prescription', doctorAuth, callController.uploadPrescription);
router.get('/call/:call_id', doctorAuth, callController.getCallDetail);
router.get('/calls', doctorAuth, callController.getDoctorCallHistory);

// Appointments / clinical notes (token required)
router.get('/appointments', doctorAuth, appointmentController.getAppointments);
router.get('/appointment/:booking_id', doctorAuth, appointmentController.getAppointmentDetail);
router.put('/appointment/:booking_id/notes', doctorAuth, appointmentController.updateAppointmentNotes);

// Dashboard (token required)
router.get('/dashboard', doctorAuth, dashboardController.getDashboard);

// Wallet (token required)
router.get('/wallet', doctorAuth, dashboardController.getWallet);
router.get('/wallet/transactions', doctorAuth, dashboardController.getTransactions);
router.post('/wallet/withdraw', doctorAuth, dashboardController.requestWithdrawal);
router.get('/wallet/withdrawals', doctorAuth, dashboardController.getWithdrawals);

// SSE (real-time incoming calls)
router.get('/events/stream', doctorAuth, (req, res) => {
  registerClient(req, res, `doctor_${req.doctor.id}`);
});

module.exports = router;
