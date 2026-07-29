const express = require('express');
const router = express.Router();
const { registerClient } = require('../../events/sse');
const userAuth = require('../../middlewares/user/user.auth');

// SSE endpoint - real-time updates for user app
router.get('/stream', userAuth, (req, res) => {
  const userId = req.user.id.toString();
  registerClient(req, res, userId);
});

module.exports = router;
