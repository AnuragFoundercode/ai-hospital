const express = require('express');
const router = express.Router();

// Panel-wise routes
const userRoutes = require('./user/user.routes');
const userSseRoutes = require('./user/sse.routes');
const doctorRoutes = require('./doctor/doctor.routes');
const labRoutes = require('./lab/lab.routes');
const diagnosticRoutes = require('./diagnostic/diagnostic.routes');
const bloodbankRoutes = require('./bloodbank/bloodbank.routes');
const adminRoutes = require('./admin/admin.routes');
const globalRoutes = require('./global.routes');

// Health check
router.get('/health', (req, res) => {
  res.json({
    message: 'AI Hospital API is running',
    timestamp: new Date().toISOString(),
  });
});

// User (Patient) panel
router.use('/user', userRoutes);
router.use('/user/events', userSseRoutes);

// Doctor panel
router.use('/doctor', doctorRoutes);

// Lab panel
router.use('/lab', labRoutes);

// Diagnostic center panel
router.use('/diagnostic', diagnosticRoutes);

// Blood bank panel
router.use('/bloodbank', bloodbankRoutes);

// Pharmacy panel
const pharmacyRoutes = require('./pharmacy/pharmacy.routes');
router.use('/pharmacy', pharmacyRoutes);

// Ambulance Partner panel
const partnerRoutes = require('./partner/partner.routes');
router.use('/partner', partnerRoutes);

// Admin panel
router.use('/admin', adminRoutes);

// Global (public - no token)
router.use('/global', globalRoutes);

// Future panels will be added here:
// router.use('/pharmacy', pharmacyRoutes);
// router.use('/admin', adminRoutes);

module.exports = router;
