/**
 * Server-Sent Events (SSE) Manager
 * Real-time updates for ambulance tracking, order status, notifications
 */

const clients = new Map(); // userId -> response object

/**
 * Register SSE connection for a user
 */
const registerClient = (req, res, userId) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE connected' })}\n\n`);

  // Store client
  clients.set(userId, res);
  console.log(`📡 SSE client connected: ${userId} | Total: ${clients.size}`);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(userId);
    console.log(`📡 SSE client disconnected: ${userId} | Total: ${clients.size}`);
  });
};

/**
 * Send event to specific user
 */
const sendToUser = (userId, eventType, data) => {
  const client = clients.get(userId);
  if (client) {
    client.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  }
  return false;
};

/**
 * Broadcast event to all connected clients
 */
const broadcast = (eventType, data) => {
  clients.forEach((client) => {
    client.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  });
};

/**
 * Send event to multiple users
 */
const sendToUsers = (userIds, eventType, data) => {
  userIds.forEach((userId) => sendToUser(userId, eventType, data));
};

module.exports = { registerClient, sendToUser, broadcast, sendToUsers };
