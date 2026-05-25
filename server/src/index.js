require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { WebSocketServer } = require('ws');

const authMiddleware = require('./auth');
const { authWS } = require('./auth');
const authRoutes = require('./routes/auth');
const hostsRoutes = require('./routes/hosts');
const logsRoutes = require('./routes/logs');
const { handleSSHConnection } = require('./websocket');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:"],
      workerSrc: ["'self'", "blob:"],
    },
  },
}));

app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const CLIENT_DIR = path.join(__dirname, '../../client');
app.use(express.static(CLIENT_DIR));

app.use('/api/auth', authRoutes);
app.use('/api/hosts', authMiddleware, hostsRoutes);
app.use('/api/logs', authMiddleware, logsRoutes);

// Page routes
app.get('/login', (req, res) => res.sendFile(path.join(CLIENT_DIR, 'login.html')));
app.get('/logs', (req, res) => res.sendFile(path.join(CLIENT_DIR, 'logs.html')));
app.get('/', (req, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html')));
app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html')));

const PORT = parseInt(process.env.PORT) || 3000;

let server;
if (process.env.SSL_CERT_PATH && process.env.SSL_KEY_PATH) {
  const sslOptions = {
    cert: fs.readFileSync(process.env.SSL_CERT_PATH),
    key: fs.readFileSync(process.env.SSL_KEY_PATH),
  };
  server = https.createServer(sslOptions, app);
  console.log('[startup] HTTPS server configured');
} else {
  server = http.createServer(app);
  console.log('[startup] HTTP server (no SSL configured)');
}

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (!request.url.startsWith('/ws/ssh')) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const user = authWS(request);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  request.user = user;
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', handleSSHConnection);

server.listen(PORT, () => {
  console.log(`[startup] SSH Web Client listening on port ${PORT}`);
});
