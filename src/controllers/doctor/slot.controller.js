const slotModel = require('../../models/doctor/slot.model');

// ─────────────────────────────────────────────
// SLOT CONTROLLER - Doctor manages availability
// ─────────────────────────────────────────────

const VALID_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * GET /api/v1/doctor/slots
 * Get all slots for the doctor
 */
const getSlots = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const slots = await slotModel.getSlots(doctorId);

    // Group by day
    const grouped = {};
    for (const slot of slots) {
      if (!grouped[slot.day_of_week]) grouped[slot.day_of_week] = [];
      grouped[slot.day_of_week].push({
        id: slot.id,
        start_time: slot.start_time,
        end_time: slot.end_time,
        slot_duration_minutes: slot.slot_duration_minutes,
        consultation_type: slot.consultation_type,
        is_active: slot.is_active,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Slots fetched.',
      data: grouped,
    });
  } catch (error) {
    console.error('getSlots error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/doctor/slots
 * Create a new slot
 * Body: { day_of_week, start_time, end_time, slot_duration_minutes, consultation_type }
 */
const createSlot = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { day_of_week, start_time, end_time, slot_duration_minutes, consultation_type } = req.body;

    if (!day_of_week || !start_time || !end_time) {
      return res.status(400).json({ success: false, message: 'day_of_week, start_time, end_time are required.' });
    }

    if (!VALID_DAYS.includes(day_of_week.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Invalid day. Use: monday, tuesday, etc.' });
    }

    const slot = await slotModel.create(doctorId, {
      day_of_week: day_of_week.toLowerCase(),
      start_time,
      end_time,
      slot_duration_minutes: slot_duration_minutes || 15,
      consultation_type: consultation_type || 'both',
    });

    return res.status(201).json({
      success: true,
      message: 'Slot created.',
      data: { id: slot.id, day_of_week, start_time, end_time, slot_duration_minutes: slot_duration_minutes || 15 },
    });
  } catch (error) {
    console.error('createSlot error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/doctor/slots/:id
 * Update a slot
 */
const updateSlot = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { id } = req.params;

    const existing = await slotModel.findById(id, doctorId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Slot not found.' });
    }

    await slotModel.update(id, doctorId, req.body);

    return res.status(200).json({
      success: true,
      message: 'Slot updated.',
    });
  } catch (error) {
    console.error('updateSlot error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * DELETE /api/v1/doctor/slots/:id
 * Delete a slot
 */
const deleteSlot = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { id } = req.params;

    const existing = await slotModel.findById(id, doctorId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Slot not found.' });
    }

    await slotModel.remove(id, doctorId);

    return res.status(200).json({
      success: true,
      message: 'Slot deleted.',
    });
  } catch (error) {
    console.error('deleteSlot error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

module.exports = {
  getSlots,
  createSlot,
  updateSlot,
  deleteSlot,
};
