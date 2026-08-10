const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// DIAGNOSTIC SLOT MANAGEMENT
// ─────────────────────────────────────────────

const VALID_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * GET /api/v1/diagnostic/slots
 */
const getSlots = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;

    const [rows] = await pool.query(
      "SELECT * FROM diagnostic_slots WHERE diagnostic_center_id = ? ORDER BY FIELD(day_of_week, 'monday','tuesday','wednesday','thursday','friday','saturday','sunday'), start_time",
      [centerId]
    );

    // Group by day
    const grouped = {};
    for (const slot of rows) {
      if (!grouped[slot.day_of_week]) grouped[slot.day_of_week] = [];
      grouped[slot.day_of_week].push({
        id: slot.id,
        start_time: slot.start_time,
        end_time: slot.end_time,
        slot_duration_minutes: slot.slot_duration_minutes,
        max_bookings_per_slot: slot.max_bookings_per_slot,
        is_active: slot.is_active,
      });
    }

    return res.status(200).json({ message: 'Slots fetched.', data: grouped });
  } catch (error) {
    console.error('diagnostic getSlots error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/diagnostic/slots
 * Body: { day_of_week, start_time, end_time, slot_duration_minutes, max_bookings_per_slot }
 */
const createSlot = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { day_of_week, start_time, end_time, slot_duration_minutes, max_bookings_per_slot } = req.body;

    if (!day_of_week || !start_time || !end_time) {
      return res.status(400).json({ message: 'day_of_week, start_time, end_time required.' });
    }

    if (!VALID_DAYS.includes(day_of_week.toLowerCase())) {
      return res.status(400).json({ message: 'Invalid day.' });
    }

    const [result] = await pool.query(
      'INSERT INTO diagnostic_slots (diagnostic_center_id, day_of_week, start_time, end_time, slot_duration_minutes, max_bookings_per_slot) VALUES (?, ?, ?, ?, ?, ?)',
      [centerId, day_of_week.toLowerCase(), start_time, end_time, slot_duration_minutes || 30, max_bookings_per_slot || 1]
    );

    return res.status(201).json({
      message: 'Slot created.',
      data: { id: result.insertId, day_of_week, start_time, end_time, slot_duration_minutes: slot_duration_minutes || 30, max_bookings_per_slot: max_bookings_per_slot || 1 },
    });
  } catch (error) {
    console.error('diagnostic createSlot error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/diagnostic/slots/:id
 */
const updateSlot = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { id } = req.params;
    const { day_of_week, start_time, end_time, slot_duration_minutes, max_bookings_per_slot, is_active } = req.body;

    const [existing] = await pool.query('SELECT id FROM diagnostic_slots WHERE id = ? AND diagnostic_center_id = ?', [id, centerId]);
    if (!existing.length) {
      return res.status(404).json({ message: 'Slot not found.' });
    }

    const fields = [];
    const values = [];

    if (day_of_week) { fields.push('day_of_week = ?'); values.push(day_of_week.toLowerCase()); }
    if (start_time) { fields.push('start_time = ?'); values.push(start_time); }
    if (end_time) { fields.push('end_time = ?'); values.push(end_time); }
    if (slot_duration_minutes !== undefined) { fields.push('slot_duration_minutes = ?'); values.push(slot_duration_minutes); }
    if (max_bookings_per_slot !== undefined) { fields.push('max_bookings_per_slot = ?'); values.push(max_bookings_per_slot); }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active ? 1 : 0); }

    if (!fields.length) return res.status(400).json({ message: 'Nothing to update.' });

    values.push(id, centerId);
    await pool.query(`UPDATE diagnostic_slots SET ${fields.join(', ')} WHERE id = ? AND diagnostic_center_id = ?`, values);

    return res.status(200).json({ message: 'Slot updated.' });
  } catch (error) {
    console.error('diagnostic updateSlot error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * DELETE /api/v1/diagnostic/slots/:id
 */
const deleteSlot = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { id } = req.params;

    const [existing] = await pool.query('SELECT id FROM diagnostic_slots WHERE id = ? AND diagnostic_center_id = ?', [id, centerId]);
    if (!existing.length) {
      return res.status(404).json({ message: 'Slot not found.' });
    }

    await pool.query('DELETE FROM diagnostic_slots WHERE id = ? AND diagnostic_center_id = ?', [id, centerId]);
    return res.status(200).json({ message: 'Slot deleted.' });
  } catch (error) {
    console.error('diagnostic deleteSlot error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getSlots,
  createSlot,
  updateSlot,
  deleteSlot,
};
