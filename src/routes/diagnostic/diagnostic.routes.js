const express = require('express');
const router = express.Router();
const diagnosticController = require('../../controllers/diagnostic/diagnostic.controller');
const serviceController = require('../../controllers/diagnostic/service.controller');
const diagnosticAuth = require('../../middlewares/diagnostic/diagnostic.auth');

// ─────────────────────────────────────────────
// DIAGNOSTIC CENTER ROUTES
// ─────────────────────────────────────────────

// Public
router.post('/register', diagnosticController.register);
router.post('/login', diagnosticController.login);
router.post('/forgot-password', diagnosticController.forgotPassword);
router.post('/reset-password', diagnosticController.resetPassword);

// Protected
router.get('/profile', diagnosticAuth, diagnosticController.getProfile);
router.put('/profile', diagnosticAuth, diagnosticController.updateProfile);
router.put('/change-password', diagnosticAuth, diagnosticController.changePassword);

// Bank details
router.get('/bank-details', diagnosticAuth, diagnosticController.getBankDetails);
router.put('/bank-details', diagnosticAuth, diagnosticController.updateBankDetails);

// Service Management
router.get('/services', diagnosticAuth, serviceController.getMyServices);
router.get('/services/categories', diagnosticAuth, serviceController.getCategories);
router.post('/services', diagnosticAuth, serviceController.addService);
router.put('/services/:id', diagnosticAuth, serviceController.updateService);
router.delete('/services/:id', diagnosticAuth, serviceController.removeService);

module.exports = router;
