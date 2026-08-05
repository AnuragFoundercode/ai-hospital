/**
 * Server-Sent Events (SSE) Manager
 * Real-time updates for all panels
 * Keys: user_1, doctor_1, lab_1 (type + id)
 */

const clients = new Map();

/**
 * Register SSE connection
 * @param {string} clientKey - e.g., "user_1", "lab_4", "doctor_2"
 */
const registerClient = (req, res, clientKey) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE connected' })}\n\n`);

  clients.set(clientKey, res);
  console.log(`📡 SSE connected: ${clientKey} | Total: ${clients.size}`);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(clientKey);
    console.log(`📡 SSE disconnected: ${clientKey} | Total: ${clients.size}`);
  });
};

/**
 * Send event to specific client
 */
const sendToClient = (clientKey, eventType, data) => {
  const client = clients.get(clientKey);
  if (client) {
    client.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  }
  return false;
};

// Shorthand helpers
const sendToUser = (userId, eventType, data) => sendToClient(`user_${userId}`, eventType, data);
const sendToDoctor = (doctorId, eventType, data) => sendToClient(`doctor_${doctorId}`, eventType, data);
const sendToLab = (labId, eventType, data) => sendToClient(`lab_${labId}`, eventType, data);

/**
 * Broadcast to all
 */
const broadcast = (eventType, data) => {
  clients.forEach((client) => {
    client.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  });
};

module.exports = { registerClient, sendToClient, sendToUser, sendToDoctor, sendToLab, broadcast };
