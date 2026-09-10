/**
 * Server-Sent Events (SSE) Manager
 * Real-time updates for all panels.
 * Keys: user_1, doctor_1, lab_1, blood_delivery_3 (type + id)
 *
 * A single key (e.g. one vendor) may have MULTIPLE live connections
 * (reconnects, multiple tabs/devices). We keep a Set of responses per key so:
 *   - data is delivered to every live connection for that key
 *   - a reconnect never silently overwrites/orphans an older connection
 *   - each connection cleans up only itself (no cross-connection races)
 */

// clientKey -> Set<res>
const clients = new Map();

const addConnection = (clientKey, res) => {
  let set = clients.get(clientKey);
  if (!set) { set = new Set(); clients.set(clientKey, set); }
  set.add(res);
  return set;
};

const removeConnection = (clientKey, res) => {
  const set = clients.get(clientKey);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(clientKey);
};

const totalConnections = () => {
  let n = 0;
  clients.forEach((set) => { n += set.size; });
  return n;
};

/**
 * Register an SSE connection.
 * @param {string} clientKey - e.g., "user_1", "lab_4", "blood_delivery_3"
 */
const registerClient = (req, res, clientKey) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE connected' })}\n\n`);

  addConnection(clientKey, res);
  console.log(`📡 SSE connected: ${clientKey} | Connections: ${totalConnections()}`);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      // write on a dead socket -> clean this connection up
      clearInterval(heartbeat);
      removeConnection(clientKey, res);
    }
  }, 30000);

  // Clean up THIS specific connection only.
  const cleanup = () => {
    clearInterval(heartbeat);
    removeConnection(clientKey, res);
    console.log(`📡 SSE disconnected: ${clientKey} | Connections: ${totalConnections()}`);
  };
  req.on('close', cleanup);
  res.on('error', cleanup);
};

/**
 * Send an event to every live connection for a client key.
 * Returns true if at least one connection received it.
 */
const sendToClient = (clientKey, eventType, data) => {
  const set = clients.get(clientKey);
  if (!set || set.size === 0) return false;

  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  let delivered = false;
  for (const res of [...set]) {
    try {
      res.write(payload);
      delivered = true;
    } catch (e) {
      // dead connection -> drop it
      removeConnection(clientKey, res);
    }
  }
  return delivered;
};

// Shorthand helpers
const sendToUser = (userId, eventType, data) => sendToClient(`user_${userId}`, eventType, data);
const sendToDoctor = (doctorId, eventType, data) => sendToClient(`doctor_${doctorId}`, eventType, data);
const sendToLab = (labId, eventType, data) => sendToClient(`lab_${labId}`, eventType, data);

/**
 * Broadcast to every connection of every client.
 */
const broadcast = (eventType, data) => {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach((set, clientKey) => {
    for (const res of [...set]) {
      try {
        res.write(payload);
      } catch (e) {
        removeConnection(clientKey, res);
      }
    }
  });
};

module.exports = { registerClient, sendToClient, sendToUser, sendToDoctor, sendToLab, broadcast };
