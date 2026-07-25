const app = require('./app');
const { testConnection } = require('./config/database');
const { initFirebase } = require('./config/firebase');

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  // Test database connection
  await testConnection();

  // Initialize Firebase
  initFirebase();

  // Start server
  app.listen(PORT, () => {
    console.log(`\n🚀 AI Hospital Server running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV}`);
    console.log(`🔗 Health Check: http://localhost:${PORT}/api/v1/health`);
    console.log('─'.repeat(50));
  });
};

startServer();
