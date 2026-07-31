const express = require('express');
const router = express.Router();
const doctorController = require('../../controllers/doctor/doctor.controller');
const appointmentController = require('../../controllers/doctor/appointment.controller');
const slotController = require('../../controllers/doctor/slot.controller');
const dashboardController = require('../../controllers/doctor/dashboard.controller');
const doctorAuth = require('../../middlewares/doctor/doctor.auth');

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
router.put('/toggle-availability', doctorAuth, doctorController.toggleAvailability);

// Appointments (token required)
router.get('/appointments', doctorAuth, appointmentController.getAppointments);
router.get('/appointment/:booking_id', doctorAuth, appointmentController.getAppointmentDetail);
router.put('/appointment/:booking_id/notes', doctorAuth, appointmentController.updateAppointmentNotes);
router.put('/appointment/:booking_id/complete', doctorAuth, appointmentController.completeAppointment);

// Slot Management (token required)
router.get('/slots', doctorAuth, slotController.getSlots);
router.post('/slots', doctorAuth, slotController.createSlot);
router.put('/slots/:id', doctorAuth, slotController.updateSlot);
router.delete('/slots/:id', doctorAuth, slotController.deleteSlot);

// Dashboard (token required)
router.get('/dashboard', doctorAuth, dashboardController.getDashboard);

// Wallet (token required)
router.get('/wallet', doctorAuth, dashboardController.getWallet);
router.get('/wallet/transactions', doctorAuth, dashboardController.getTransactions);
router.post('/wallet/withdraw', doctorAuth, dashboardController.requestWithdrawal);
router.get('/wallet/withdrawals', doctorAuth, dashboardController.getWithdrawals);

module.exports = router;
