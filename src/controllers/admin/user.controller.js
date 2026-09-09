const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN USER MANAGEMENT
// ─────────────────────────────────────────────

/**
 * GET /api/v1/admin/users
 * Query:
 *   page, limit
 *   search       - matches full_name / mobile / email
 *   is_active    - 0 | 1
 *   is_verified  - 0 | 1
 *   gender       - male | female | other
 *   blood_group  - e.g. O+
 *   sort         - newest (default) | oldest | name
 */
const getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, is_active, is_verified, gender, blood_group, sort = 'newest' } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1'];
    const params = [];

    if (search) {
      where.push('(u.full_name LIKE ? OR u.mobile LIKE ? OR u.email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (is_active !== undefined) { where.push('u.is_active = ?'); params.push(parseInt(is_active)); }
    if (is_verified !== undefined) { where.push('u.is_verified = ?'); params.push(parseInt(is_verified)); }
    if (gender) { where.push('u.gender = ?'); params.push(gender); }
    if (blood_group) { where.push('u.blood_group = ?'); params.push(blood_group); }

    const whereClause = where.join(' AND ');

    let orderBy = 'u.created_at DESC';
    if (sort === 'oldest') orderBy = 'u.created_at ASC';
    else if (sort === 'name') orderBy = 'u.full_name ASC';

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM users u WHERE ${whereClause}`, params);
    const total = countRows[0].total;

    const [rows] = await pool.query(
      `SELECT u.id, u.uuid, u.full_name, u.mobile, u.email, u.gender, u.date_of_birth, u.blood_group, u.is_verified, u.is_active, u.profile_photo, u.aadhaar_number, u.abha_number, u.credit_limit, u.created_at, u.updated_at,
              COALESCE(w.balance, 0.00) AS wallet_balance
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE ${whereClause}
       ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.status(200).json({
      message: 'Users fetched.',
      data: rows.map((u) => ({
        id: u.uuid,
        db_id: u.id,
        full_name: u.full_name,
        mobile: u.mobile,
        email: u.email,
        gender: u.gender,
        date_of_birth: u.date_of_birth,
        blood_group: u.blood_group,
        is_verified: !!u.is_verified,
        is_active: !!u.is_active,
        profile_photo: u.profile_photo,
        aadhaar_number: u.aadhaar_number,
        abha_number: u.abha_number,
        credit_limit: u.credit_limit,
        wallet_balance: u.wallet_balance,
        created_at: u.created_at,
        updated_at: u.updated_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total, total_pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('admin getUsers error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/users/:id/toggle-status
 * Flips is_active for the user (activate <-> deactivate). :id = user uuid.
 */
const toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query('SELECT id, is_active FROM users WHERE uuid = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'User not found.' });

    const newStatus = rows[0].is_active ? 0 : 1;
    await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, rows[0].id]);

    return res.status(200).json({
      message: newStatus ? 'User activated.' : 'User deactivated.',
      data: { id, is_active: !!newStatus },
    });
  } catch (error) {
    console.error('admin toggleUserStatus error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/users/:id/credit-limit
 * Body: { action: 'set' | 'increase' | 'decrease', amount }
 *   set      -> credit_limit = amount
 *   increase -> credit_limit = credit_limit + amount
 *   decrease -> credit_limit = credit_limit - amount (cannot go below outstanding or 0)
 * :id = user uuid.
 */
const updateCreditLimit = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, amount } = req.body;

    const numAmount = parseFloat(amount);
    if (!['set', 'increase', 'decrease'].includes(action)) {
      return res.status(400).json({ message: "action must be 'set', 'increase', or 'decrease'." });
    }
    if (isNaN(numAmount) || numAmount < 0) {
      return res.status(400).json({ message: 'Valid non-negative amount required.' });
    }

    const [rows] = await pool.query('SELECT id, credit_limit FROM users WHERE uuid = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'User not found.' });
    const userDbId = rows[0].id;
    const current = parseFloat(rows[0].credit_limit) || 0;

    let newLimit;
    if (action === 'set') newLimit = numAmount;
    else if (action === 'increase') newLimit = current + numAmount;
    else newLimit = current - numAmount;

    newLimit = parseFloat(newLimit.toFixed(2));
    if (newLimit < 0) return res.status(400).json({ message: 'Credit limit cannot be negative.', data: { current_limit: current } });

    // Don't drop the limit below what the user has already drawn (approved credit)
    const [outRows] = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) AS outstanding FROM credit_applications WHERE user_id = ? AND status = 'approved'",
      [userDbId]
    );
    const outstanding = parseFloat(outRows[0].outstanding) || 0;
    if (newLimit < outstanding) {
      return res.status(400).json({
        message: `Credit limit cannot be less than the amount already drawn (₹${outstanding}).`,
        data: { current_limit: current, outstanding, attempted_limit: newLimit },
      });
    }

    await pool.query('UPDATE users SET credit_limit = ? WHERE id = ?', [newLimit, userDbId]);

    return res.status(200).json({
      message: 'Credit limit updated.',
      data: { id, previous_limit: current, credit_limit: newLimit, outstanding, available_limit: parseFloat((newLimit - outstanding).toFixed(2)) },
    });
  } catch (error) {
    console.error('admin updateCreditLimit error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getUsers,
  toggleUserStatus,
  updateCreditLimit,
};
