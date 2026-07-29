const express = require('express');
const router = express.Router();

// Panel-wise routes
const userRoutes = require('./user/user.routes');
const userSseRoutes = require('./user/sse.routes');

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'AI Hospital API is running',
    timestamp: new Date().toISOString(),
  });
});

// User (Patient) panel
router.use('/user', userRoutes);
router.use('/user/events', userSseRoutes);

// Future panels will be added here:
// router.use('/doctor', doctorRoutes);
// router.use('/pharmacy', pharmacyRoutes);
// router.use('/admin', adminRoutes);

module.exports = router;
