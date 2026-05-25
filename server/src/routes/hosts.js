const express = require('express');
const { encrypt, decrypt } = require('../crypto');
const db = require('../db');

const router = express.Router();

function validateHost(body) {
  const { nickname, hostname, port, username, auth_method } = body;
  if (!nickname || typeof nickname !== 'string' || nickname.length > 100) return 'Invalid nickname';
  if (!hostname || typeof hostname !== 'string' || hostname.length > 255) return 'Invalid hostname';
  const p = Number(port);
  if (!p || p < 1 || p > 65535 || !Number.isInteger(p)) return 'Invalid port (1-65535)';
  if (!username || typeof username !== 'string' || username.length > 100) return 'Invalid username';
  if (!['password', 'key'].includes(auth_method)) return 'auth_method must be "password" or "key"';
  return null;
}

// List all hosts (no sensitive data)
router.get('/', (req, res) => {
  const hosts = db.prepare(`
    SELECT id, nickname, hostname, port, username, auth_method, created_at, updated_at
    FROM hosts ORDER BY nickname ASC
  `).all();
  res.json(hosts);
});

// Get single host (no sensitive data)
router.get('/:id', (req, res) => {
  const host = db.prepare(`
    SELECT id, nickname, hostname, port, username, auth_method, created_at, updated_at
    FROM hosts WHERE id = ?
  `).get(req.params.id);

  if (!host) return res.status(404).json({ error: 'Host not found' });
  res.json(host);
});

// Create host
router.post('/', (req, res) => {
  const err = validateHost(req.body);
  if (err) return res.status(400).json({ error: err });

  const { nickname, hostname, port, username, auth_method, password, private_key } = req.body;

  let encrypted_password = null;
  let encrypted_key = null;

  if (auth_method === 'password') {
    if (!password || typeof password !== 'string') return res.status(400).json({ error: 'Password required' });
    encrypted_password = encrypt(password);
  } else {
    if (!private_key || typeof private_key !== 'string') return res.status(400).json({ error: 'Private key required' });
    encrypted_key = encrypt(private_key);
  }

  const result = db.prepare(`
    INSERT INTO hosts (nickname, hostname, port, username, auth_method, encrypted_password, encrypted_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(nickname, hostname, Number(port), username, auth_method, encrypted_password, encrypted_key);

  const host = db.prepare(
    'SELECT id, nickname, hostname, port, username, auth_method, created_at FROM hosts WHERE id = ?'
  ).get(result.lastInsertRowid);

  res.status(201).json(host);
});

// Update host
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM hosts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Host not found' });

  const err = validateHost(req.body);
  if (err) return res.status(400).json({ error: err });

  const { nickname, hostname, port, username, auth_method, password, private_key } = req.body;

  let encrypted_password = null;
  let encrypted_key = null;

  if (auth_method === 'password') {
    encrypted_password = password ? encrypt(password) : existing.encrypted_password;
  } else {
    encrypted_key = private_key ? encrypt(private_key) : existing.encrypted_key;
  }

  db.prepare(`
    UPDATE hosts SET nickname=?, hostname=?, port=?, username=?, auth_method=?,
    encrypted_password=?, encrypted_key=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(nickname, hostname, Number(port), username, auth_method, encrypted_password, encrypted_key, req.params.id);

  const host = db.prepare(
    'SELECT id, nickname, hostname, port, username, auth_method, created_at, updated_at FROM hosts WHERE id=?'
  ).get(req.params.id);

  res.json(host);
});

// Delete host
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM hosts WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Host not found' });
  res.json({ ok: true });
});

module.exports = router;
