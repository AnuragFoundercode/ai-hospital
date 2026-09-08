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
const ambulanceController = require('../../controllers/user/ambulance.controller');
const callController = require('../../controllers/doctor/call.controller');
const walletController = require('../../controllers/user/wallet.controller');
const notificationController = require('../../controllers/notification.controller');
const reviewController = require('../../controllers/user/review.controller');
const creditController = require('../../controllers/user/credit.controller');
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
router.get('/doctors/stream', userAuth, doctorController.streamDoctorList);
router.get('/emergency-doctors', userAuth, doctorController.getEmergencyDoctors);
router.get('/doctor/:id', userAuth, doctorController.getDoctorProfile);

// Wallet APIs
router.get('/wallet', userAuth, walletController.getWallet);
router.post('/wallet/add', userAuth, walletController.addMoney);
router.post('/wallet/verify', userAuth, walletController.verifyRecharge);
router.get('/wallet/transactions', userAuth, walletController.getTransactions);

// Doctor Video Call (per-minute) APIs
router.post('/doctor/:id/call', userAuth, callController.startCall);
router.post('/emergency-doctor/:id/call', userAuth, callController.startEmergencyCall);
router.post('/call/:call_id/tick', userAuth, callController.tickCall);
router.post('/call/:call_id/end', userAuth, callController.endCall);
router.post('/call/:call_id/reports', userAuth, callController.uploadUserReports);
router.get('/call/:call_id', userAuth, callController.getCallDetail);
router.get('/calls', userAuth, callController.getUserCallHistory);
router.get('/doctor/:id/calls', userAuth, callController.getUserDoctorCallHistory);

// Credit (credit limit + credit application/loan)
router.get('/credit/dashboard', userAuth, creditController.getCreditDashboard);
router.get('/credit/limit', userAuth, creditController.getCreditLimit);
router.post('/credit/apply', userAuth, creditController.applyCreditLimit);
router.get('/credit/history', userAuth, creditController.getCreditHistory);

// Vendor reviews (any vendor: doctor|pharmacy|pathology_lab|diagnostic_center|blood_bank|ambulance_service)
router.post('/vendor-review', userAuth, reviewController.upsertReview);
router.get('/vendor/:type/:id/reviews', userAuth, reviewController.getVendorReviews);
router.get('/vendor/:type/:id/my-review', userAuth, reviewController.getMyReview);

// Notifications
router.get('/notifications', userAuth, notificationController.list('user'));
router.put('/notifications/read-all', userAuth, notificationController.markAllRead('user'));
router.put('/notifications/:id/read', userAuth, notificationController.markRead('user'));

// Booking APIs (token required)
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
router.get('/search-lab-tests', userAuth, labController.searchLabTests);
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
router.get('/diagnostic-history', userAuth, diagnosticController.getDiagnosticHistory);

// Blood Bank APIs (token required)
router.get('/blood-banks', userAuth, bloodbankController.getBloodBankList);
router.get('/blood-bank/:id', userAuth, bloodbankController.getBloodBankDetail);
router.get('/blood-bank/:id/availability', userAuth, bloodbankController.getBloodAvailability);
router.get('/blood-delivery-quote', userAuth, bloodbankController.getBloodDeliveryQuote);
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
router.get('/browse-medicines', userAuth, pharmacyController.browseMedicines);
router.post('/pharmacy-cart/add', userAuth, pharmacyController.addToCart);
router.get('/pharmacy-cart', userAuth, pharmacyController.getCart);
router.delete('/pharmacy-cart/clear', userAuth, pharmacyController.clearCart);
router.put('/pharmacy-cart/:id', userAuth, pharmacyController.updateCartItem);
router.delete('/pharmacy-cart/:id', userAuth, pharmacyController.removeFromCart);
router.post('/pharmacy-order', userAuth, pharmacyController.createOrder);
router.post('/pharmacy-order/:order_id/pay', userAuth, pharmacyController.confirmOrderPayment);
router.get('/pharmacy-orders', userAuth, pharmacyController.getOrders);
router.get('/pharmacy-order/:order_id', userAuth, pharmacyController.getOrderDetail);
router.post('/pharmacy-review', userAuth, pharmacyController.addPharmacyReview);

// Ambulance APIs (token required)
router.get('/ambulance/categories', userAuth, ambulanceController.getCategories);
router.get('/ambulances', userAuth, ambulanceController.getAmbulanceList);
router.get('/ambulance/:id', userAuth, ambulanceController.getAmbulanceDetail);
router.post('/ambulance/book', userAuth, ambulanceController.bookAmbulance);
router.get('/ambulance-bookings', userAuth, ambulanceController.getAmbulanceBookings);
router.get('/ambulance-booking/:booking_id', userAuth, ambulanceController.getAmbulanceBookingDetail);

module.exports = router;
