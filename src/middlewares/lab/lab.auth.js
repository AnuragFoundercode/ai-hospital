const jwt = require('jsonwebtoken');

// ─────────────────────────────────────────────
// LAB AUTH MIDDLEWARE
// ─────────────────────────────────────────────

const labAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Token required. Please login.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== 'lab') {
      return res.status(403).json({ message: 'Access denied. Lab token required.' });
    }

    req.lab = decoded; // { id, uuid, role }
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

module.exports = labAuth;
