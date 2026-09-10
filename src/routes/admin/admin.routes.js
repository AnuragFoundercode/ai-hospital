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
router.put('/users/:id/toggle-status', adminAuth, userController.toggleUserStatus);
router.put('/users/:id/credit-limit', adminAuth, userController.updateCreditLimit);

// Vendor Management (multi-step vendors: delivery | blood_delivery | collector | ambulance | doctor)
router.get('/vendors/:type', adminAuth, vendorController.getVendors);
router.get('/vendors/:type/:id', adminAuth, vendorController.getVendorDetail);
router.put('/vendors/:type/:id/approve', adminAuth, vendorController.approveVendor);
router.put('/vendors/:type/:id/reject', adminAuth, vendorController.rejectVendor);

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
