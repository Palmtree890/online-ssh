const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

function getLogDir() {
  return process.env.LOG_DIR || path.join(__dirname, '../../../logs');
}

function safeFilename(filename) {
  return typeof filename === 'string' && /^[\w\-]+\.log$/.test(filename) && !filename.includes('..');
}

// List log files
router.get('/', (req, res) => {
  const logDir = getLogDir();
  if (!fs.existsSync(logDir)) return res.json([]);

  const files = fs.readdirSync(logDir)
    .filter(f => f.endsWith('.log'))
    .map(f => {
      const stat = fs.statSync(path.join(logDir, f));
      return { name: f, size: stat.size, created: stat.birthtime, modified: stat.mtime };
    })
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));

  res.json(files);
});

// Get log content
router.get('/:filename', (req, res) => {
  if (!safeFilename(req.params.filename)) return res.status(400).json({ error: 'Invalid filename' });

  const logPath = path.join(getLogDir(), req.params.filename);
  if (!fs.existsSync(logPath)) return res.status(404).json({ error: 'Log not found' });

  const content = fs.readFileSync(logPath, 'utf8');
  res.json({ filename: req.params.filename, content });
});

// Delete log
router.delete('/:filename', (req, res) => {
  if (!safeFilename(req.params.filename)) return res.status(400).json({ error: 'Invalid filename' });

  const logPath = path.join(getLogDir(), req.params.filename);
  if (!fs.existsSync(logPath)) return res.status(404).json({ error: 'Log not found' });

  fs.unlinkSync(logPath);
  res.json({ ok: true });
});

module.exports = router;
