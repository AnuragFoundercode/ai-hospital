const { pool } = require('../../config/database');
const agoraService = require('../../services/agora.service');
const walletModel = require('../../models/doctor/wallet.model');
const notificationService = require('../../services/notification.service');
const { sendToClient } = require('../../events/sse');

// Fallback admin commission % if a doctor has none set
const DEFAULT_ADMIN_COMMISSION_PERCENT = 15;

const genCallId = () => `CALL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

// Helper: safely generate Agora token (returns null if not configured)
function safeToken(channelName, uid) {
  try {
    return agoraService.generateToken(channelName, uid, 'publisher', 3600);
  } catch (e) {
    return { token: null, appId: null, channelName, uid, error: 'Agora not configured' };
  }
}

// ═══════════════════════════════════════════
// USER SIDE
// ═══════════════════════════════════════════

/**
 * POST /api/v1/user/doctor/:id/call
 * Start a call request to an online doctor.
 * :id = doctor uuid
 */
const startCall = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Get doctor
    const [docRows] = await pool.query('SELECT * FROM doctors WHERE uuid = ? AND is_active = 1 AND is_verified = 1', [id]);
    if (!docRows.length) return res.status(404).json({ message: 'Doctor not found.' });
    const doctor = docRows[0];

    if (doctor.call_status !== 'online') {
      return res.status(400).json({ message: `Doctor is currently ${doctor.call_status}. Cannot call now.` });
    }

    const perMinuteFee = parseFloat(doctor.per_minute_fee);
    if (!perMinuteFee || perMinuteFee <= 0) return res.status(400).json({ message: 'Doctor per-minute fee not set.' });

    // Ensure user wallet + check minimum 1-minute balance
    await pool.query('INSERT IGNORE INTO wallets (user_id) VALUES (?)', [userId]);
    const [walletRows] = await pool.query('SELECT id, balance FROM wallets WHERE user_id = ?', [userId]);
    const balance = parseFloat(walletRows[0].balance);
    if (balance < perMinuteFee) {
      return res.status(400).json({ message: `Insufficient wallet balance. Need at least ₹${perMinuteFee} for 1 minute.`, data: { balance, per_minute_fee: perMinuteFee } });
    }

    // Create call session
    const callId = genCallId();
    const channelName = callId;
    await pool.query(
      "INSERT INTO doctor_calls (call_id, user_id, doctor_id, channel_name, per_minute_fee, status) VALUES (?, ?, ?, ?, ?, 'ringing')",
      [callId, userId, doctor.id, channelName, perMinuteFee]
    );

    // Mark doctor busy so no one else calls
    await pool.query("UPDATE doctors SET call_status = 'busy' WHERE id = ?", [doctor.id]);

    // Agora token for user (uid = user id)
    const userToken = safeToken(channelName, userId);

    // Notify doctor (SSE + FCM)
    const [userInfo] = await pool.query('SELECT full_name, profile_photo FROM users WHERE id = ?', [userId]);
    sendToClient(`doctor_${doctor.id}`, 'incoming_call', {
      call_id: callId,
      channel_name: channelName,
      patient: { name: userInfo[0]?.full_name, photo: userInfo[0]?.profile_photo },
      per_minute_fee: perMinuteFee,
    });
    if (doctor.fcm_token) {
      await notificationService.sendToDevice(doctor.fcm_token, 'Incoming Call 📞', `${userInfo[0]?.full_name || 'A patient'} is calling you.`, { type: 'incoming_call', call_id: callId });
    }

    return res.status(201).json({
      message: 'Calling doctor...',
      data: {
        call_id: callId,
        channel_name: channelName,
        status: 'ringing',
        per_minute_fee: perMinuteFee,
        wallet_balance: balance,
        max_minutes: Math.floor(balance / perMinuteFee),
        agora: { app_id: userToken.appId, token: userToken.token, channel_name: channelName, uid: userId },
        doctor: { id: doctor.uuid, name: doctor.full_name, photo: doctor.profile_photo },
      },
    });
  } catch (error) { console.error('startCall error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * POST /api/v1/user/call/:call_id/tick
 * Called by the app every minute during an ongoing call.
 * Deducts per_minute_fee from user wallet. If balance runs out, call is auto-ended.
 */
const tickCall = async (req, res) => {
  try {
    const userId = req.user.id;
    const { call_id } = req.params;

    const [callRows] = await pool.query("SELECT * FROM doctor_calls WHERE call_id = ? AND user_id = ?", [call_id, userId]);
    if (!callRows.length) return res.status(404).json({ message: 'Call not found.' });
    const call = callRows[0];
    if (call.status !== 'ongoing') return res.status(400).json({ message: `Call is ${call.status}.` });

    const fee = parseFloat(call.per_minute_fee);
    const [walletRows] = await pool.query('SELECT id, balance FROM wallets WHERE user_id = ?', [userId]);
    const balance = parseFloat(walletRows[0].balance);

    // Not enough for this minute → end the call
    if (balance < fee) {
      await endCallInternal(call, 'system', 'Wallet balance exhausted');
      return res.status(200).json({ message: 'Call ended: insufficient balance.', data: { call_ended: true, reason: 'insufficient_balance', wallet_balance: balance } });
    }

    // Deduct one minute
    const newBalance = balance - fee;
    await pool.query('UPDATE wallets SET balance = ? WHERE user_id = ?', [newBalance, userId]);
    await pool.query(
      "INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, description, reference_type, reference_id, balance_after, created_by_type) VALUES (?, ?, 'debit', ?, ?, 'call_charge', ?, ?, 'system')",
      [walletRows[0].id, userId, fee, `Call charge - ${call.call_id}`, call.id, newBalance]
    );
    await pool.query('UPDATE doctor_calls SET total_minutes = total_minutes + 1, total_charged = total_charged + ? WHERE id = ?', [fee, call.id]);

    const minutes = call.total_minutes + 1;
    return res.status(200).json({ message: 'Minute charged.', data: { call_ended: false, minutes, charged_this_minute: fee, total_charged: parseFloat(call.total_charged) + fee, wallet_balance: newBalance, remaining_minutes: Math.floor(newBalance / fee) } });
  } catch (error) { console.error('tickCall error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ═══════════════════════════════════════════
// DOCTOR SIDE
// ═══════════════════════════════════════════

/**
 * PUT /api/v1/doctor/call/:call_id/accept
 */
const acceptCall = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { call_id } = req.params;
    const [callRows] = await pool.query("SELECT * FROM doctor_calls WHERE call_id = ? AND doctor_id = ?", [call_id, doctorId]);
    if (!callRows.length) return res.status(404).json({ message: 'Call not found.' });
    const call = callRows[0];
    if (call.status !== 'ringing') return res.status(400).json({ message: `Call is already ${call.status}.` });

    await pool.query("UPDATE doctor_calls SET status = 'ongoing', started_at = NOW() WHERE id = ?", [call.id]);

    const doctorToken = safeToken(call.channel_name, doctorId);

    // Notify user call accepted
    sendToClient(`user_${call.user_id}`, 'call_accepted', { call_id: call.call_id, channel_name: call.channel_name });
    const [u] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [call.user_id]);
    if (u[0]?.fcm_token) await notificationService.sendToDevice(u[0].fcm_token, 'Call Accepted', 'Doctor joined the call.', { type: 'call_accepted', call_id: call.call_id });

    return res.status(200).json({
      message: 'Call accepted.',
      data: { call_id: call.call_id, status: 'ongoing', channel_name: call.channel_name, agora: { app_id: doctorToken.appId, token: doctorToken.token, channel_name: call.channel_name, uid: doctorId } },
    });
  } catch (error) { console.error('acceptCall error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * PUT /api/v1/doctor/call/:call_id/reject
 */
const rejectCall = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { call_id } = req.params;
    const [callRows] = await pool.query("SELECT * FROM doctor_calls WHERE call_id = ? AND doctor_id = ?", [call_id, doctorId]);
    if (!callRows.length) return res.status(404).json({ message: 'Call not found.' });
    const call = callRows[0];
    if (call.status !== 'ringing') return res.status(400).json({ message: `Call is already ${call.status}.` });

    await pool.query("UPDATE doctor_calls SET status = 'rejected', ended_at = NOW(), ended_by = 'doctor', end_reason = 'Rejected by doctor' WHERE id = ?", [call.id]);
    await pool.query("UPDATE doctors SET call_status = 'online' WHERE id = ?", [doctorId]);

    sendToClient(`user_${call.user_id}`, 'call_rejected', { call_id: call.call_id });
    const [u] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [call.user_id]);
    if (u[0]?.fcm_token) await notificationService.sendToDevice(u[0].fcm_token, 'Call Rejected', 'Doctor is unavailable right now.', { type: 'call_rejected', call_id: call.call_id });

    return res.status(200).json({ message: 'Call rejected.', data: { call_id: call.call_id, status: 'rejected' } });
  } catch (error) { console.error('rejectCall error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ═══════════════════════════════════════════
// SHARED: END CALL (either side)
// ═══════════════════════════════════════════

/**
 * POST /api/v1/user/call/:call_id/end  (user)  OR
 * PUT  /api/v1/doctor/call/:call_id/end (doctor)
 */
const endCall = async (req, res) => {
  try {
    const isDoctor = !!req.doctor;
    const actorId = isDoctor ? req.doctor.id : req.user.id;
    const { call_id } = req.params;
    const col = isDoctor ? 'doctor_id' : 'user_id';

    const [callRows] = await pool.query(`SELECT * FROM doctor_calls WHERE call_id = ? AND ${col} = ?`, [call_id, actorId]);
    if (!callRows.length) return res.status(404).json({ message: 'Call not found.' });
    const call = callRows[0];
    if (['completed', 'rejected', 'cancelled', 'missed'].includes(call.status)) {
      return res.status(400).json({ message: `Call already ${call.status}.` });
    }

    const result = await endCallInternal(call, isDoctor ? 'doctor' : 'user', 'Call ended');
    return res.status(200).json({ message: 'Call ended.', data: result });
  } catch (error) { console.error('endCall error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * Internal: finalize a call, credit doctor, free doctor status, notify both.
 */
async function endCallInternal(call, endedBy, reason) {
  // If it never started (ringing → cancelled/missed)
  const wasOngoing = call.status === 'ongoing';
  const finalStatus = wasOngoing ? 'completed' : (endedBy === 'user' ? 'cancelled' : 'missed');

  // Latest totals
  const [fresh] = await pool.query('SELECT total_minutes, total_charged FROM doctor_calls WHERE id = ?', [call.id]);
  const totalCharged = parseFloat(fresh[0].total_charged);

  // Per-doctor admin commission %
  const [docRow] = await pool.query('SELECT admin_commission_percent FROM doctors WHERE id = ?', [call.doctor_id]);
  const commissionPercent = docRow[0]?.admin_commission_percent != null
    ? parseFloat(docRow[0].admin_commission_percent)
    : DEFAULT_ADMIN_COMMISSION_PERCENT;

  const commission = +(totalCharged * (commissionPercent / 100)).toFixed(2);
  const doctorEarning = +(totalCharged - commission).toFixed(2);

  await pool.query(
    "UPDATE doctor_calls SET status = ?, ended_at = NOW(), ended_by = ?, end_reason = ?, doctor_earning = ?, admin_commission = ? WHERE id = ?",
    [finalStatus, endedBy, reason, doctorEarning, commission, call.id]
  );

  // Free the doctor
  await pool.query("UPDATE doctors SET call_status = 'online' WHERE id = ?", [call.doctor_id]);

  // Credit doctor wallet for completed calls with earning
  if (wasOngoing && doctorEarning > 0) {
    await walletModel.credit(call.doctor_id, doctorEarning, `Call earning - ${call.call_id} (${fresh[0].total_minutes} min)`, 'call_earning', call.id);
    await pool.query('UPDATE doctors SET total_consultations = total_consultations + 1 WHERE id = ?', [call.doctor_id]);
  }

  // Notify both sides
  sendToClient(`user_${call.user_id}`, 'call_ended', { call_id: call.call_id, status: finalStatus, total_minutes: fresh[0].total_minutes, total_charged: totalCharged, reason });
  sendToClient(`doctor_${call.doctor_id}`, 'call_ended', { call_id: call.call_id, status: finalStatus, total_minutes: fresh[0].total_minutes, doctor_earning: doctorEarning, admin_commission: commission, reason });

  return { call_id: call.call_id, status: finalStatus, total_minutes: fresh[0].total_minutes, total_charged: totalCharged, admin_commission_percent: commissionPercent, admin_commission: commission, doctor_earning: doctorEarning };
}

// ═══════════════════════════════════════════
// CALL HISTORY (both sides)
// ═══════════════════════════════════════════

const getDoctorCallHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [count] = await pool.query('SELECT COUNT(*) as total FROM doctor_calls WHERE doctor_id = ?', [req.doctor.id]);
    const [rows] = await pool.query(
      `SELECT c.*, u.full_name as patient_name, u.profile_photo as patient_photo
       FROM doctor_calls c JOIN users u ON c.user_id = u.id
       WHERE c.doctor_id = ? ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [req.doctor.id, parseInt(limit), offset]
    );
    return res.status(200).json({
      message: 'Call history fetched.',
      data: rows.map(c => ({ call_id: c.call_id, status: c.status, patient: { name: c.patient_name, photo: c.patient_photo }, per_minute_fee: c.per_minute_fee, total_minutes: c.total_minutes, doctor_earning: c.doctor_earning, started_at: c.started_at, ended_at: c.ended_at, created_at: c.created_at })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count[0].total, total_pages: Math.ceil(count[0].total / parseInt(limit)) },
    });
  } catch (error) { console.error('getDoctorCallHistory error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

const getUserCallHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [count] = await pool.query('SELECT COUNT(*) as total FROM doctor_calls WHERE user_id = ?', [req.user.id]);
    const [rows] = await pool.query(
      `SELECT c.*, d.full_name as doctor_name, d.profile_photo as doctor_photo, dc.name as category
       FROM doctor_calls c JOIN doctors d ON c.doctor_id = d.id
       LEFT JOIN doctor_categories dc ON d.category_id = dc.id
       WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [req.user.id, parseInt(limit), offset]
    );
    return res.status(200).json({
      message: 'Call history fetched.',
      data: rows.map(c => ({ call_id: c.call_id, status: c.status, doctor: { name: c.doctor_name, photo: c.doctor_photo, category: c.category }, per_minute_fee: c.per_minute_fee, total_minutes: c.total_minutes, total_charged: c.total_charged, started_at: c.started_at, ended_at: c.ended_at, created_at: c.created_at })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count[0].total, total_pages: Math.ceil(count[0].total / parseInt(limit)) },
    });
  } catch (error) { console.error('getUserCallHistory error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

// ═══════════════════════════════════════════
// REPORTS (user) & PRESCRIPTION/NOTES (doctor)
// ═══════════════════════════════════════════

const parseJson = (v) => {
  if (!v) return [];
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
  return v;
};

/**
 * POST /api/v1/user/call/:call_id/reports
 * User uploads medical reports (Cloudinary URLs) for the call.
 * Body: { reports: [{ url, name }] }  OR  { url, name }
 */
const uploadUserReports = async (req, res) => {
  try {
    const userId = req.user.id;
    const { call_id } = req.params;
    let { reports, url, name } = req.body;
    if (!reports && url) reports = [{ url, name: name || 'Report' }];
    if (!Array.isArray(reports) || !reports.length) return res.status(400).json({ message: 'reports array (or url) required.' });

    const [rows] = await pool.query('SELECT * FROM doctor_calls WHERE call_id = ? AND user_id = ?', [call_id, userId]);
    if (!rows.length) return res.status(404).json({ message: 'Call not found.' });
    const call = rows[0];

    const existing = parseJson(call.user_reports);
    const now = new Date().toISOString();
    const added = reports.filter(r => r && r.url).map(r => ({ url: r.url, name: r.name || 'Report', uploaded_at: now }));
    const updated = [...existing, ...added];

    await pool.query('UPDATE doctor_calls SET user_reports = ? WHERE id = ?', [JSON.stringify(updated), call.id]);

    // Notify doctor (live during call)
    sendToClient(`doctor_${call.doctor_id}`, 'report_uploaded', { call_id: call.call_id, reports: added });

    return res.status(200).json({ message: 'Reports uploaded.', data: { call_id: call.call_id, reports: updated } });
  } catch (error) { console.error('uploadUserReports error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * POST /api/v1/doctor/call/:call_id/prescription
 * Doctor uploads prescription (URLs) + notes + diagnosis for the call.
 * Body: { prescriptions: [{ url, name }] , doctor_notes, diagnosis }
 */
const uploadPrescription = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { call_id } = req.params;
    let { prescriptions, url, name, doctor_notes, diagnosis } = req.body;
    if (!prescriptions && url) prescriptions = [{ url, name: name || 'Prescription' }];

    const [rows] = await pool.query('SELECT * FROM doctor_calls WHERE call_id = ? AND doctor_id = ?', [call_id, doctorId]);
    if (!rows.length) return res.status(404).json({ message: 'Call not found.' });
    const call = rows[0];

    const existing = parseJson(call.prescriptions);
    const now = new Date().toISOString();
    const added = Array.isArray(prescriptions) ? prescriptions.filter(p => p && p.url).map(p => ({ url: p.url, name: p.name || 'Prescription', uploaded_at: now })) : [];
    const updated = [...existing, ...added];

    await pool.query(
      'UPDATE doctor_calls SET prescriptions = ?, doctor_notes = COALESCE(?, doctor_notes), diagnosis = COALESCE(?, diagnosis) WHERE id = ?',
      [JSON.stringify(updated), doctor_notes ?? null, diagnosis ?? null, call.id]
    );

    // Notify user (live + push)
    sendToClient(`user_${call.user_id}`, 'prescription_uploaded', { call_id: call.call_id, prescriptions: added, doctor_notes: doctor_notes ?? null, diagnosis: diagnosis ?? null });
    const [u] = await pool.query('SELECT fcm_token FROM users WHERE id = ?', [call.user_id]);
    if (u[0]?.fcm_token) await notificationService.sendToDevice(u[0].fcm_token, 'Prescription Added 📄', 'Doctor has shared your prescription.', { type: 'prescription_uploaded', call_id: call.call_id });

    return res.status(200).json({ message: 'Prescription saved.', data: { call_id: call.call_id, prescriptions: updated, doctor_notes: doctor_notes ?? call.doctor_notes, diagnosis: diagnosis ?? call.diagnosis } });
  } catch (error) { console.error('uploadPrescription error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/user/call/:call_id   (user)
 * GET /api/v1/doctor/call/:call_id (doctor)
 * Full call detail incl. reports + prescription. Both sides see the same data.
 */
const getCallDetail = async (req, res) => {
  try {
    const isDoctor = !!req.doctor;
    const actorId = isDoctor ? req.doctor.id : req.user.id;
    const col = isDoctor ? 'doctor_id' : 'user_id';
    const { call_id } = req.params;

    const [rows] = await pool.query(
      `SELECT c.*, d.full_name as doctor_name, d.profile_photo as doctor_photo, dc.name as category,
              u.full_name as patient_name, u.profile_photo as patient_photo, u.gender as patient_gender, u.date_of_birth as patient_dob
       FROM doctor_calls c
       JOIN doctors d ON c.doctor_id = d.id
       LEFT JOIN doctor_categories dc ON d.category_id = dc.id
       JOIN users u ON c.user_id = u.id
       WHERE c.call_id = ? AND c.${col} = ?`,
      [call_id, actorId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Call not found.' });
    const c = rows[0];

    return res.status(200).json({
      message: 'Call detail fetched.',
      data: {
        call_id: c.call_id,
        status: c.status,
        channel_name: c.channel_name,
        per_minute_fee: c.per_minute_fee,
        total_minutes: c.total_minutes,
        total_charged: c.total_charged,
        doctor_earning: isDoctor ? c.doctor_earning : undefined,
        doctor: { name: c.doctor_name, photo: c.doctor_photo, category: c.category },
        patient: { name: c.patient_name, photo: c.patient_photo, gender: c.patient_gender, dob: c.patient_dob },
        user_reports: parseJson(c.user_reports),
        prescriptions: parseJson(c.prescriptions),
        doctor_notes: c.doctor_notes,
        diagnosis: c.diagnosis,
        timeline: { started_at: c.started_at, ended_at: c.ended_at, created_at: c.created_at },
      },
    });
  } catch (error) { console.error('getCallDetail error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/user/doctor/:id/calls?page=1&limit=20
 * How many times the logged-in user consulted a specific doctor + history (with call_id).
 * :id = doctor uuid
 */
const getUserDoctorCallHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params; // doctor uuid
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Resolve doctor by uuid
    const [docRows] = await pool.query(
      `SELECT d.id, d.uuid, d.full_name, d.profile_photo, dc.name as category
       FROM doctors d LEFT JOIN doctor_categories dc ON d.category_id = dc.id
       WHERE d.uuid = ?`,
      [id]
    );
    if (!docRows.length) return res.status(404).json({ message: 'Doctor not found.' });
    const doctor = docRows[0];

    // Total consultations (completed/ended calls) + overall count
    const [count] = await pool.query(
      'SELECT COUNT(*) as total FROM doctor_calls WHERE user_id = ? AND doctor_id = ?',
      [userId, doctor.id]
    );
    const [completedCount] = await pool.query(
      "SELECT COUNT(*) as total FROM doctor_calls WHERE user_id = ? AND doctor_id = ? AND status = 'ended'",
      [userId, doctor.id]
    );

    const [rows] = await pool.query(
      `SELECT call_id, status, per_minute_fee, total_minutes, total_charged, started_at, ended_at, created_at
       FROM doctor_calls
       WHERE user_id = ? AND doctor_id = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [userId, doctor.id, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Consultation history fetched.',
      data: {
        doctor: { id: doctor.uuid, name: doctor.full_name, photo: doctor.profile_photo, category: doctor.category },
        total_consultations: count[0].total,
        completed_consultations: completedCount[0].total,
        history: rows.map(c => ({
          call_id: c.call_id,
          status: c.status,
          per_minute_fee: c.per_minute_fee,
          total_minutes: c.total_minutes,
          total_charged: c.total_charged,
          started_at: c.started_at,
          ended_at: c.ended_at,
          created_at: c.created_at,
        })),
      },
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count[0].total, total_pages: Math.ceil(count[0].total / parseInt(limit)) },
    });
  } catch (error) { console.error('getUserDoctorCallHistory error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = {
  startCall,
  tickCall,
  acceptCall,
  rejectCall,
  endCall,
  getDoctorCallHistory,
  getUserCallHistory,
  getUserDoctorCallHistory,
  uploadUserReports,
  uploadPrescription,
  getCallDetail,
};
