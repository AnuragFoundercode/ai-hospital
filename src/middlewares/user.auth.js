const jwt = require('jsonwebtoken');

// ─────────────────────────────────────────────
// USER AUTH MIDDLEWARE - Verify patient token
// ─────────────────────────────────────────────

const userAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Token required. Please login.',
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if token is for user (patient)
    if (decoded.role !== 'user') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. User token required.',
      });
    }

    req.user = decoded; // { id, uuid, role }
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.',
    });
  }
};

module.exports = userAuth;
