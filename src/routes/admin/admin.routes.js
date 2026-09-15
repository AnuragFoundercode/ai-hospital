const express = require('express');
const router = express.Router();
const adminController = require('../../controllers/admin/admin.controller');
const zoneController = require('../../controllers/admin/zone.controller');
const stateController = require('../../controllers/admin/state.controller');
const configController = require('../../controllers/admin/config.controller');
const supportController = require('../../controllers/admin/support.controller');
const policyController = require('../../controllers/admin/policy.controller');
const userController = require('../../controllers/admin/user.controller');
const vendorController = require('../../controllers/admin/vendor.controller');
const commissionController = require('../../controllers/admin/commission.controller');
const adminDoctorController = require('../../controllers/admin/doctor.controller');
const adminPharmacyController = require('../../controllers/admin/pharmacy.controller');
const adminLabController = require('../../controllers/admin/lab.controller');
const adminDiagnosticController = require('../../controllers/admin/diagnostic.controller');
const adminBloodBankController = require('../../controllers/admin/bloodbank.controller');
const adminDeliveryController = require('../../controllers/admin/delivery.controller');
const adminAuth = require('../../middlewares/admin/admin.auth');

// ─────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────

// Public
router.post('/login', adminController.login);

// Protected
router.get('/profile', adminAuth, adminController.getProfile);
router.put('/change-password', adminAuth, adminController.changePassword);

// Zone Management
router.get('/zones', adminAuth, zoneController.getZones);
router.get('/zones/:id', adminAuth, zoneController.getZoneById);
router.post('/zones', adminAuth, zoneController.createZone);
router.put('/zones/:id', adminAuth, zoneController.updateZone);
router.put('/zones/:id/toggle-status', adminAuth, zoneController.toggleZoneStatus);

// State Management
router.get('/states', adminAuth, stateController.getStates);
router.post('/states', adminAuth, stateController.createState);
router.put('/states/:id', adminAuth, stateController.updateState);

// App Config Management — admin can VIEW and UPDATE values only.
// Keys are created/removed by developers (via migrations) to avoid breaking
// code that depends on specific config keys.
router.get('/config', adminAuth, configController.getConfigs);
router.put('/config', adminAuth, configController.bulkUpdateConfig);
router.get('/config/:key', adminAuth, configController.getConfig);
router.put('/config/:key', adminAuth, configController.updateConfig);

// User Management
router.get('/users', adminAuth, userController.getUsers);
router.get('/users/:id/overview', adminAuth, userController.getUserOverview);
router.get('/users/:id/bookings', adminAuth, userController.getUserBookings);
router.get('/users/:id/addresses', adminAuth, userController.getUserAddresses);
router.get('/users/:id/credit-requests', adminAuth, userController.getUserCreditRequests);
router.get('/users/:id/wallet-transactions', adminAuth, userController.getUserWalletTransactions);
router.put('/credit-requests/:application_id/review', adminAuth, userController.reviewCreditRequest);
router.put('/users/:id/toggle-status', adminAuth, userController.toggleUserStatus);
router.put('/users/:id/credit-limit', adminAuth, userController.updateCreditLimit);

// Vendor Management (multi-step vendors: delivery | blood_delivery | collector | ambulance | doctor)
router.get('/vendors/:type', adminAuth, vendorController.getVendors);
router.get('/vendors/:type/:id', adminAuth, vendorController.getVendorDetail);
router.put('/vendors/:type/:id/approve', adminAuth, vendorController.approveVendor);
router.put('/vendors/:type/:id/reject', adminAuth, vendorController.rejectVendor);

// Doctor Management
router.get('/doctors', adminAuth, adminDoctorController.getDoctors);
router.get('/doctors/:id', adminAuth, adminDoctorController.getDoctorDetail);
router.put('/doctors/:id/toggle-status', adminAuth, adminDoctorController.toggleDoctorStatus);
router.get('/doctors/:id/appointments', adminAuth, adminDoctorController.getDoctorAppointments);
router.get('/doctors/:id/transactions', adminAuth, adminDoctorController.getDoctorTransactions);
router.get('/doctors/:id/withdrawals', adminAuth, adminDoctorController.getDoctorWithdrawals);

// Doctor Categories (specializations)
router.get('/doctor-categories', adminAuth, adminDoctorController.getCategories);
router.post('/doctor-categories', adminAuth, adminDoctorController.createCategory);
router.put('/doctor-categories/:id', adminAuth, adminDoctorController.updateCategory);
router.put('/doctor-categories/:id/toggle-status', adminAuth, adminDoctorController.toggleCategoryStatus);

// Pharmacy Management
router.get('/pharmacies', adminAuth, adminPharmacyController.getPharmacies);
router.get('/pharmacies/:id', adminAuth, adminPharmacyController.getPharmacyDetail);
router.put('/pharmacies/:id/toggle-status', adminAuth, adminPharmacyController.togglePharmacyStatus);
router.get('/pharmacies/:id/transactions', adminAuth, adminPharmacyController.getPharmacyTransactions);
router.get('/pharmacies/:id/withdrawals', adminAuth, adminPharmacyController.getPharmacyWithdrawals);
router.get('/pharmacies/:id/orders', adminAuth, adminPharmacyController.getPharmacyOrders);
router.get('/pharmacies/:id/products', adminAuth, adminPharmacyController.getPharmacyProducts);

// Pathology Lab Management
router.get('/labs', adminAuth, adminLabController.getLabs);
router.get('/labs/:id', adminAuth, adminLabController.getLabDetail);
router.put('/labs/:id/toggle-status', adminAuth, adminLabController.toggleLabStatus);
router.get('/labs/:id/bookings', adminAuth, adminLabController.getLabBookings);
router.get('/labs/:id/transactions', adminAuth, adminLabController.getLabTransactions);
router.get('/labs/:id/settlements', adminAuth, adminLabController.getLabSettlements);

// Diagnostic Center Management
router.get('/diagnostics', adminAuth, adminDiagnosticController.getDiagnostics);
router.get('/diagnostics/:id', adminAuth, adminDiagnosticController.getDiagnosticDetail);
router.put('/diagnostics/:id/toggle-status', adminAuth, adminDiagnosticController.toggleDiagnosticStatus);
router.get('/diagnostics/:id/transactions', adminAuth, adminDiagnosticController.getDiagnosticTransactions);
router.get('/diagnostics/:id/settlements', adminAuth, adminDiagnosticController.getDiagnosticSettlements);

// Blood Bank Management
router.get('/blood-banks', adminAuth, adminBloodBankController.getBloodBanks);
router.get('/blood-banks/:id', adminAuth, adminBloodBankController.getBloodBankDetail);
router.put('/blood-banks/:id/toggle-status', adminAuth, adminBloodBankController.toggleBloodBankStatus);
router.get('/blood-banks/:id/transactions', adminAuth, adminBloodBankController.getBloodBankTransactions);
router.get('/blood-banks/:id/settlements', adminAuth, adminBloodBankController.getBloodBankSettlements);
router.get('/blood-requests', adminAuth, adminBloodBankController.getAllRequests);
router.get('/blood-requests/:requestId', adminAuth, adminBloodBankController.getRequestDetail);

// Pharmacy Delivery Partner Management
router.get('/delivery-partners', adminAuth, adminDeliveryController.getPartners);
router.get('/delivery-partners/:id', adminAuth, adminDeliveryController.getPartnerDetail);
router.put('/delivery-partners/:id/toggle-status', adminAuth, adminDeliveryController.togglePartnerStatus);
router.get('/delivery-partners/:id/transactions', adminAuth, adminDeliveryController.getPartnerTransactions);
router.get('/delivery-partners/:id/settlements', adminAuth, adminDeliveryController.getPartnerSettlements);
router.get('/deliveries', adminAuth, adminDeliveryController.getDeliveries);
router.get('/deliveries/:requestId', adminAuth, adminDeliveryController.getDeliveryDetail);

// Diagnostic Bookings (global)
router.get('/diagnostic-bookings', adminAuth, adminDiagnosticController.getAllBookings);
router.get('/diagnostic-bookings/:booking_id', adminAuth, adminDiagnosticController.getBookingDetail);

// Pathology Bookings (global)
router.get('/lab-bookings', adminAuth, adminLabController.getAllBookings);
router.get('/lab-bookings/:booking_id', adminAuth, adminLabController.getBookingDetail);

// Pharmacy Orders (global)
router.get('/pharmacy-orders', adminAuth, adminPharmacyController.getAllOrders);
router.get('/pharmacy-orders/:order_id', adminAuth, adminPharmacyController.getOrderDetail);

// Commission / Profit reports (order-wise, user-wise, vendor-wise)
router.get('/commissions/summary', adminAuth, commissionController.getCommissionSummary);
router.get('/commissions/by-user', adminAuth, commissionController.getCommissionByUser);
router.get('/commissions/by-vendor', adminAuth, commissionController.getCommissionByVendor);
router.get('/commissions', adminAuth, commissionController.getCommissions);

// Help & Support — contact + FAQs
router.get('/support/contact', adminAuth, supportController.getContact);
router.put('/support/contact', adminAuth, supportController.updateContact);
router.get('/faqs', adminAuth, supportController.getFaqs);
router.post('/faqs', adminAuth, supportController.createFaq);
router.put('/faqs/:id', adminAuth, supportController.updateFaq);
router.delete('/faqs/:id', adminAuth, supportController.deleteFaq);

// Policy Management (privacy / terms / refund / custom)
router.get('/policies', adminAuth, policyController.getPolicies);
router.post('/policies', adminAuth, policyController.createPolicy);
router.get('/policies/:id', adminAuth, policyController.getPolicy);
router.put('/policies/:id', adminAuth, policyController.updatePolicy);
router.delete('/policies/:id', adminAuth, policyController.deletePolicy);

module.exports = router;
