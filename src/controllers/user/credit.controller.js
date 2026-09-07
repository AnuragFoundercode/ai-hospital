const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// USER CREDIT (credit limit + credit application/loan flow)
// ─────────────────────────────────────────────

const genApplicationId = () => `CR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

/**
 * GET /api/v1/user/credit/limit
 * User's sanctioned credit limit + latest application status.
 */
const getCreditLimit = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.query('SELECT credit_limit FROM users WHERE id = ?', [userId]);
    if (!rows.length) return res.status(404).json({ message: 'User not found.' });

    const [latest] = await pool.query(
      'SELECT application_id, amount, status, created_at FROM credit_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    return res.status(200).json({
      message: 'Credit limit fetched.',
      data: {
        credit_limit: parseFloat(rows[0].credit_limit),
        latest_application: latest[0] || null,
      },
    });
  } catch (error) {
    console.error('getCreditLimit error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/user/credit/apply
 * Body: { amount, purpose, employment_type, monthly_income, remark,
 *         aadhaar_card_url, pan_card_url, income_proof_url }
 * amount cannot exceed the user's credit_limit. Goes pending for admin review.
 */
const applyCreditLimit = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      amount, purpose, employment_type, monthly_income, remark,
      aadhaar_card_url, pan_card_url, income_proof_url,
    } = req.body;

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({ message: 'Valid amount is required.' });
    }
    if (!purpose) return res.status(400).json({ message: 'purpose is required.' });
    if (!employment_type) return res.status(400).json({ message: 'employment_type is required.' });
    if (!aadhaar_card_url || !pan_card_url || !income_proof_url) {
      return res.status(400).json({ message: 'aadhaar_card_url, pan_card_url and income_proof_url are required.' });
    }

    // Amount cannot exceed the user's sanctioned credit limit
    const [userRows] = await pool.query('SELECT credit_limit FROM users WHERE id = ?', [userId]);
    if (!userRows.length) return res.status(404).json({ message: 'User not found.' });
    const creditLimit = parseFloat(userRows[0].credit_limit);
    if (creditLimit <= 0) {
      return res.status(400).json({ message: 'No credit limit assigned to your account yet.' });
    }
    if (numAmount > creditLimit) {
      return res.status(400).json({ message: `Amount cannot exceed your credit limit of ₹${creditLimit}.`, data: { credit_limit: creditLimit } });
    }

    // Block a new application if one is already pending
    const [pending] = await pool.query(
      "SELECT id FROM credit_applications WHERE user_id = ? AND status = 'pending' LIMIT 1",
      [userId]
    );
    if (pending.length) {
      return res.status(409).json({ message: 'You already have a pending credit request. Please wait for it to be reviewed.' });
    }

    const applicationId = genApplicationId();
    await pool.query(
      `INSERT INTO credit_applications
       (application_id, user_id, amount, purpose, employment_type, monthly_income, remark, aadhaar_card_url, pan_card_url, income_proof_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [applicationId, userId, numAmount, purpose, employment_type, monthly_income || null, remark || null, aadhaar_card_url, pan_card_url, income_proof_url]
    );

    return res.status(201).json({
      message: 'Credit request submitted. It is pending admin review.',
      data: { application_id: applicationId, amount: numAmount, status: 'pending' },
    });
  } catch (error) {
    console.error('applyCreditLimit error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/credit/history?status=&page=&limit=
 * All of the user's credit applications (loan history).
 */
const getCreditHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = ['user_id = ?'];
    const params = [userId];
    if (status) { where.push('status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM credit_applications WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT application_id, amount, purpose, employment_type, monthly_income, remark,
              aadhaar_card_url, pan_card_url, income_proof_url, status, admin_remark, reviewed_at, created_at
       FROM credit_applications WHERE ${whereClause}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Credit history fetched.',
      data: rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countRows[0].total, total_pages: Math.ceil(countRows[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('getCreditHistory error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/credit/dashboard
 * credit_limit  : total sanctioned limit
 * outstanding   : credit already used (sum of APPROVED applications)
 * available_limit = credit_limit - outstanding
 */
const getCreditDashboard = async (req, res) => {
  try {
    const userId = req.user.id;

    const [userRows] = await pool.query('SELECT credit_limit FROM users WHERE id = ?', [userId]);
    if (!userRows.length) return res.status(404).json({ message: 'User not found.' });
    const creditLimit = parseFloat(userRows[0].credit_limit);

    // Outstanding = total approved credit currently drawn
    const [outRows] = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) AS outstanding FROM credit_applications WHERE user_id = ? AND status = 'approved'",
      [userId]
    );
    const outstanding = parseFloat(outRows[0].outstanding);
    const available = Math.max(0, +(creditLimit - outstanding).toFixed(2));

    // Counts for quick view
    const [counts] = await pool.query(
      `SELECT
         SUM(status = 'pending')  AS pending,
         SUM(status = 'approved') AS approved,
         SUM(status = 'rejected') AS rejected
       FROM credit_applications WHERE user_id = ?`,
      [userId]
    );

    return res.status(200).json({
      message: 'Credit dashboard fetched.',
      data: {
        credit_limit: creditLimit,
        outstanding,
        available_limit: available,
        applications: {
          pending: Number(counts[0].pending) || 0,
          approved: Number(counts[0].approved) || 0,
          rejected: Number(counts[0].rejected) || 0,
        },
      },
    });
  } catch (error) {
    console.error('getCreditDashboard error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = { getCreditLimit, applyCreditLimit, getCreditHistory, getCreditDashboard };
