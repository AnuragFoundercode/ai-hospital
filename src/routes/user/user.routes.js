const express = require('express');
const router = express.Router();
const userController = require('../../controllers/user/user.controller');
const doctorController = require('../../controllers/user/doctor.controller');
const bookingController = require('../../controllers/user/booking.controller');
const labController = require('../../controllers/user/lab.controller');
const labCartController = require('../../controllers/user/lab-cart.controller');
const diagnosticController = require('../../controllers/user/diagnostic.controller');
const bloodbankController = require('../../controllers/user/bloodbank.controller');
const pharmacyController = require('../../controllers/user/pharmacy.controller');
const userAuth = require('../../middlewares/user/user.auth');

// ─────────────────────────────────────────────
// USER ROUTES - Patient App APIs
// ─────────────────────────────────────────────

// Public routes (no token needed)
router.post('/send-otp', userController.sendOtp);
router.post('/verify-otp', userController.verifyOtp);

// Protected routes (token required)
router.get('/profile', userAuth, userController.getProfile);
router.put('/profile', userAuth, userController.updateProfile);

// Address APIs
router.get('/addresses', userAuth, userController.getAddresses);
router.post('/address', userAuth, userController.addAddress);
router.put('/address/:id', userAuth, userController.updateAddress);
router.delete('/address/:id', userAuth, userController.deleteAddress);

// Doctor APIs (token required)
router.get('/doctor-categories', userAuth, doctorController.getDoctorCategories);
router.get('/doctors', userAuth, doctorController.getDoctorList);
router.get('/doctor/:id', userAuth, doctorController.getDoctorProfile);
router.get('/doctor/:id/slots', userAuth, doctorController.getDoctorSlots);

// Booking APIs (token required)
router.post('/booking/doctor', userAuth, bookingController.createDoctorBooking);
router.post('/booking/lab', userAuth, bookingController.createLabBooking);
router.post('/booking/diagnostic', userAuth, bookingController.createDiagnosticBooking);
router.post('/booking/:booking_id/pay', userAuth, bookingController.confirmPayment);
router.post('/booking/:booking_id/verify-payment', userAuth, bookingController.verifyPayment);
router.get('/bookings', userAuth, bookingController.getMyBookings);
router.get('/booking/:booking_id', userAuth, bookingController.getBookingDetail);

// Appointment APIs (token required)
router.get('/appointments', userAuth, bookingController.getAppointments);
router.get('/appointment/:booking_id', userAuth, bookingController.getAppointmentDetail);

// Paytm callback (no auth - Paytm calls this)
router.post('/booking/paytm/callback', bookingController.paytmCallback);

// Lab APIs (token required)
router.get('/lab-test-categories', userAuth, labController.getTestCategories);
router.get('/lab-tests', userAuth, labController.searchTests);
router.get('/lab-test/:id', userAuth, labController.getTestDetail);
router.get('/labs', userAuth, labController.getLabList);
router.get('/lab/:id', userAuth, labController.getLabDetail);

// Lab Booking History
router.get('/lab-bookings', userAuth, labController.getLabBookings);
router.get('/lab-booking/:booking_id', userAuth, labController.getLabBookingDetail);

// Lab Cart APIs (token required)
router.post('/lab-cart/add', userAuth, labCartController.addToCart);
router.delete('/lab-cart/remove/:pricing_id', userAuth, labCartController.removeFromCart);
router.get('/lab-cart', userAuth, labCartController.getCart);
router.delete('/lab-cart/clear', userAuth, labCartController.clearCart);

// Diagnostic APIs (token required)
router.get('/diagnostic-categories', userAuth, diagnosticController.getCategories);
router.get('/diagnostics', userAuth, diagnosticController.getDiagnosticList);
router.get('/diagnostic/:id', userAuth, diagnosticController.getDiagnosticDetail);
router.get('/diagnostic/:id/services', userAuth, diagnosticController.getDiagnosticServices);
router.get('/diagnostic-service/:id', userAuth, diagnosticController.getServiceDetail);
router.get('/diagnostic-service/:id/slots', userAuth, diagnosticController.getServiceSlots);

// Blood Bank APIs (token required)
router.get('/blood-banks', userAuth, bloodbankController.getBloodBankList);
router.get('/blood-bank/:id', userAuth, bloodbankController.getBloodBankDetail);
router.get('/blood-bank/:id/availability', userAuth, bloodbankController.getBloodAvailability);
router.post('/blood-request', userAuth, bloodbankController.requestBlood);
router.get('/blood-requests', userAuth, bloodbankController.getBloodRequests);
router.get('/blood-request/:request_id', userAuth, bloodbankController.getBloodRequestDetail);

// Pharmacy APIs (token required)
router.get('/medicine-categories', userAuth, pharmacyController.getCategories);
router.get('/pharmacies', userAuth, pharmacyController.getPharmacyList);
router.get('/pharmacy/:id', userAuth, pharmacyController.getPharmacyDetail);
router.get('/pharmacy/:id/reviews', userAuth, pharmacyController.getPharmacyReviews);
router.get('/pharmacy/:id/medicines', userAuth, pharmacyController.getPharmacyMedicines);
router.get('/medicine/:id', userAuth, pharmacyController.getMedicineDetail);
router.get('/medicine/:id/reviews', userAuth, pharmacyController.getMedicineReviews);
router.post('/medicine/:id/review', userAuth, pharmacyController.addMedicineReview);
router.get('/search-medicines', userAuth, pharmacyController.searchMedicines);
router.post('/pharmacy-cart/add', userAuth, pharmacyController.addToCart);
router.get('/pharmacy-cart', userAuth, pharmacyController.getCart);
router.delete('/pharmacy-cart/clear', userAuth, pharmacyController.clearCart);
router.put('/pharmacy-cart/:id', userAuth, pharmacyController.updateCartItem);
router.delete('/pharmacy-cart/:id', userAuth, pharmacyController.removeFromCart);
router.post('/pharmacy-order', userAuth, pharmacyController.createOrder);
router.get('/pharmacy-orders', userAuth, pharmacyController.getOrders);
router.get('/pharmacy-order/:order_id', userAuth, pharmacyController.getOrderDetail);
router.post('/pharmacy-review', userAuth, pharmacyController.addPharmacyReview);

module.exports = router;
