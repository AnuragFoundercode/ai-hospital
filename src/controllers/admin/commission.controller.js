const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN COMMISSION / PROFIT REPORTS (admin_commissions ledger)
// ─────────────────────────────────────────────

const buildFilters = (q) => {
  const where = ['1=1'];
  const params = [];
  if (q.module) { where.push('module = ?'); params.push(q.module); }
  if (q.vendor_type) { where.push('vendor_type = ?'); params.push(q.vendor_type); }
  if (q.vendor_id) { where.push('vendor_id = ?'); params.push(parseInt(q.vendor_id)); }
  if (q.user_id) { where.push('user_id = ?'); params.push(parseInt(q.user_id)); }
  if (q.from) { where.push('created_at >= ?'); params.push(q.from); }
  if (q.to) { where.push('created_at <= ?'); params.push(`${q.to} 23:59:59`); }
  return { whereClause: where.join(' AND '), params };
};

/**
 * GET /api/v1/admin/commissions
 * Order-wise ledger list. Filters: module, vendor_type, vendor_id, user_id, from, to. Pagination.
 */
const getCommissions = async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);
    const pageNum = Math.max(1, parseInt(req.query.page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(commission_amount),0) AS total_commission FROM admin_commissions WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT ac.*, u.full_name AS user_name, u.mobile AS user_mobile
       FROM admin_commissions ac LEFT JOIN users u ON ac.user_id = u.id
       WHERE ${whereClause.replace(/module|vendor_type|vendor_id|user_id|created_at/g, (m) => 'ac.' + m)}
       ORDER BY ac.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.status(200).json({
      message: 'Commissions fetched.',
      total_commission: parseFloat(cnt.total_commission),
      data: rows.map((r) => ({
        id: r.id,
        module: r.module,
        reference_type: r.reference_type,
        reference_id: r.reference_id,
        reference_code: r.reference_code,
        user: r.user_id ? { id: r.user_id, name: r.user_name, mobile: r.user_mobile } : null,
        vendor_type: r.vendor_type,
        vendor_id: r.vendor_id,
        gross_amount: r.gross_amount,
        commission_percent: r.commission_percent,
        commission_amount: r.commission_amount,
        created_at: r.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getCommissions error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/commissions/summary
 * Totals + module-wise breakdown (respects from/to filters).
 */
const getСommissionSummary = async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);
    const [[totals]] = await pool.query(
      `SELECT COUNT(*) AS transactions, COALESCE(SUM(commission_amount),0) AS total_commission, COALESCE(SUM(gross_amount),0) AS total_gross
       FROM admin_commissions WHERE ${whereClause}`, params
    );
    const [byModule] = await pool.query(
      `SELECT module, COUNT(*) AS transactions, COALESCE(SUM(commission_amount),0) AS commission, COALESCE(SUM(gross_amount),0) AS gross
       FROM admin_commissions WHERE ${whereClause} GROUP BY module ORDER BY commission DESC`, params
    );
    return res.status(200).json({
      message: 'Commission summary fetched.',
      data: {
        total_commission: parseFloat(totals.total_commission),
        total_gross: parseFloat(totals.total_gross),
        transactions: totals.transactions,
        by_module: byModule.map((m) => ({ module: m.module, transactions: m.transactions, commission: parseFloat(m.commission), gross: parseFloat(m.gross) })),
      },
    });
  } catch (error) {
    console.error('admin commission summary error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/commissions/by-user
 * Total profit generated per user.
 */
const getCommissionByUser = async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);
    const pageNum = Math.max(1, parseInt(req.query.page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(DISTINCT user_id) AS total FROM admin_commissions WHERE ${whereClause} AND user_id IS NOT NULL`, params);
    const [rows] = await pool.query(
      `SELECT ac.user_id, u.full_name AS user_name, u.mobile AS user_mobile,
              COUNT(*) AS transactions, COALESCE(SUM(ac.commission_amount),0) AS total_commission
       FROM admin_commissions ac LEFT JOIN users u ON ac.user_id = u.id
       WHERE ${whereClause.replace(/module|vendor_type|vendor_id|user_id|created_at/g, (m) => 'ac.' + m)} AND ac.user_id IS NOT NULL
       GROUP BY ac.user_id ORDER BY total_commission DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Commission by user fetched.',
      data: rows.map((r) => ({ user_id: r.user_id, name: r.user_name, mobile: r.user_mobile, transactions: r.transactions, total_commission: parseFloat(r.total_commission) })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin commission by-user error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/commissions/by-vendor
 * Total profit generated per vendor.
 */
const getCommissionByVendor = async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);
    const pageNum = Math.max(1, parseInt(req.query.page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(DISTINCT CONCAT(vendor_type,'-',vendor_id)) AS total FROM admin_commissions WHERE ${whereClause} AND vendor_id IS NOT NULL`, params);
    const [rows] = await pool.query(
      `SELECT vendor_type, vendor_id, COUNT(*) AS transactions, COALESCE(SUM(commission_amount),0) AS total_commission, COALESCE(SUM(gross_amount),0) AS total_gross
       FROM admin_commissions WHERE ${whereClause} AND vendor_id IS NOT NULL
       GROUP BY vendor_type, vendor_id ORDER BY total_commission DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Commission by vendor fetched.',
      data: rows.map((r) => ({ vendor_type: r.vendor_type, vendor_id: r.vendor_id, transactions: r.transactions, total_commission: parseFloat(r.total_commission), total_gross: parseFloat(r.total_gross) })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin commission by-vendor error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getCommissions,
  getCommissionSummary: getСommissionSummary,
  getCommissionByUser,
  getCommissionByVendor,
};
