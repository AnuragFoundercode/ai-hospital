const express = require('express');
const router = express.Router();
const { registerClient } = require('../events/sse');
const { authenticate } = require('../middlewares/auth');

/**
 * SSE endpoint - client subscribes for real-time updates
 * GET /api/v1/events/stream
 */
router.get('/stream', authenticate, (req, res) => {
  const userId = req.user.id.toString();
  registerClient(req, res, userId);
});

module.exports = router;
