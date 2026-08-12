const express = require('express');
const router = express.Router();
const adminController = require('../../controllers/admin/admin.controller');
const zoneController = require('../../controllers/admin/zone.controller');
const stateController = require('../../controllers/admin/state.controller');
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

module.exports = router;
