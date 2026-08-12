const express = require('express');
const router = express.Router();
const globalController = require('../controllers/global.controller');

// ─────────────────────────────────────────────
// GLOBAL ROUTES - Public (no token required)
// ─────────────────────────────────────────────

router.get('/states', globalController.getStates);
router.get('/zones', globalController.getZonesByState);
router.post('/validate-pincode', globalController.validatePincode);

module.exports = router;
