const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const sseRoutes = require('./sse.routes');

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'AI Hospital API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Mount routes
router.use('/auth', authRoutes);
router.use('/events', sseRoutes);

module.exports = router;
