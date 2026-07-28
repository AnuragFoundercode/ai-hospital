const express = require('express');
const router = express.Router();

const userRoutes = require('./user.routes');
const sseRoutes = require('./sse.routes');

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'AI Hospital API is running',
    timestamp: new Date().toISOString(),
  });
});

// Module routes
router.use('/user', userRoutes);
router.use('/events', sseRoutes);

module.exports = router;
