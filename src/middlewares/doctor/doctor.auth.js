const jwt = require('jsonwebtoken');

// ─────────────────────────────────────────────
// DOCTOR AUTH MIDDLEWARE - Verify doctor token
// ─────────────────────────────────────────────

const doctorAuth = (req, res, next) => {
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

    if (decoded.role !== 'doctor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Doctor token required.',
      });
    }

    req.doctor = decoded; // { id, uuid, role }
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.',
    });
  }
};

module.exports = doctorAuth;
