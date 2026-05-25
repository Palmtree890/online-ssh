const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const { authWS } = require('./auth');
const { decrypt } = require('./crypto');
const db = require('./db');

function getLogDir() {
  return process.env.LOG_DIR || path.join(__dirname, '../../../logs');
}

function handleSSHConnection(ws, request) {
  const user = authWS(request);
  if (!user) {
    ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
    ws.close(1008, 'Unauthorized');
    return;
  }

  let sshClient = null;
  let sshStream = null;
  let logStream = null;
  let closed = false;

  function cleanup() {
    if (closed) return;
    closed = true;
    if (logStream) { try { logStream.end(); } catch {} logStream = null; }
    if (sshClient) { try { sshClient.end(); } catch {} sshClient = null; }
    sshStream = null;
  }

  function send(obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {
      case 'connect':
        startSSH(msg);
        break;
      case 'data':
        if (sshStream) sshStream.write(msg.data);
        break;
      case 'resize':
        if (sshStream && msg.rows > 0 && msg.cols > 0) {
          sshStream.setWindow(msg.rows, msg.cols, 0, 0);
        }
        break;
    }
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);

  function startSSH(config) {
    sshClient = new Client();

    let connCfg = {
      readyTimeout: 15000,
      keepaliveInterval: 10000,
    };

    if (config.host_id) {
      const host = db.prepare('SELECT * FROM hosts WHERE id = ?').get(config.host_id);
      if (!host) { send({ type: 'error', message: 'Saved host not found' }); return; }

      connCfg.host = host.hostname;
      connCfg.port = host.port;
      connCfg.username = host.username;

      try {
        if (host.auth_method === 'password') {
          connCfg.password = decrypt(host.encrypted_password);
        } else {
          connCfg.privateKey = decrypt(host.encrypted_key);
        }
      } catch (e) {
        send({ type: 'error', message: 'Failed to decrypt stored credentials' });
        return;
      }
    } else {
      // Quick connect — credentials from client (never stored)
      if (!config.hostname || !config.username) {
        send({ type: 'error', message: 'hostname and username required' });
        return;
      }
      connCfg.host = String(config.hostname).trim();
      connCfg.port = parseInt(config.port) || 22;
      connCfg.username = String(config.username).trim();

      if (config.auth_method === 'password') {
        connCfg.password = config.password;
      } else if (config.auth_method === 'key') {
        connCfg.privateKey = config.private_key;
      }
    }

    if (config.enable_logging) {
      const logDir = getLogDir();
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const safeName = (connCfg.host || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
      const logPath = path.join(logDir, `${ts}_${safeName}.log`);
      logStream = fs.createWriteStream(logPath, { flags: 'a' });
    }

    sshClient.on('ready', () => {
      send({ type: 'connected' });

      sshClient.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
        if (err) {
          send({ type: 'error', message: `Shell error: ${err.message}` });
          cleanup();
          return;
        }

        sshStream = stream;

        stream.on('data', (chunk) => {
          send({ type: 'data', data: chunk.toString('base64') });
          if (logStream) logStream.write(chunk);
        });

        stream.stderr.on('data', (chunk) => {
          send({ type: 'data', data: chunk.toString('base64') });
        });

        stream.on('close', () => {
          send({ type: 'closed', message: 'Session ended' });
          cleanup();
        });
      });
    });

    sshClient.on('error', (err) => {
      send({ type: 'error', message: `SSH error: ${err.message}` });
      cleanup();
    });

    sshClient.on('close', () => {
      if (!closed) send({ type: 'closed', message: 'Connection closed' });
      cleanup();
    });

    sshClient.connect(connCfg);
  }
}

module.exports = { handleSSHConnection };
