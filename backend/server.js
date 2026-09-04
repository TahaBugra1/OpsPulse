require('dotenv').config();

const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const requestsRoutes = require('./routes/requests.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const usersRoutes = require('./routes/users.routes');
const authMiddleware = require('./middleware/auth.middleware');
const errorHandler = require('./middleware/errorHandler');
const attachSockets = require('./sockets');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(apiLimiter);

app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/requests', authMiddleware, requestsRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/users', authMiddleware, usersRoutes);

app.use(errorHandler);

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_ORIGIN },
});
attachSockets(io);

if (require.main === module) {
  const port = process.env.PORT || 4000;
  httpServer.listen(port, () => {
    console.log(`OpsPulse backend listening on port ${port}`);
  });
}

module.exports = app;
module.exports.httpServer = httpServer;
module.exports.io = io;
