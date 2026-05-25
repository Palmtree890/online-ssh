# SSH Web Client

A self-hosted, browser-based SSH client built for Raspberry Pi. Access your servers from any device on your network (or remotely via Twingate) through a clean terminal UI.

## Features

- Full xterm.js terminal with 256-color support and auto-resize
- Saved hosts with AES-256 encrypted passwords and SSH keys
- Multi-tab sessions — open multiple SSH connections simultaneously
- Quick-connect form for ad-hoc connections
- Session logging to timestamped files with an in-app log viewer
- JWT auth with rate-limited login (10 attempts / 15 min)
- Mobile responsive — works on phones

## Quick Start

### 1. Clone and configure

```bash
cp .env.example .env
```

Edit `.env` and fill in the required values.

**Generate a bcrypt password hash:**
```bash
node -e "require('bcrypt').hash('yourpassword', 12).then(console.log)"
```

**Generate secrets:**
```bash
openssl rand -base64 48   # run twice — once for JWT_SECRET, once for ENCRYPTION_SECRET
```

### 2. Run with Docker (recommended)

```bash
docker compose up -d
```

The app will be available at `http://<pi-ip>:3000`.

### 3. Run directly with Node.js

```bash
# Install dependencies
cd server && npm install

# Start (from repo root)
npm start

# Development mode (auto-restart on changes)
npm run dev
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ADMIN_USERNAME` | Yes | Login username |
| `ADMIN_PASSWORD_HASH` | Yes | bcrypt hash of your password |
| `JWT_SECRET` | Yes | Secret for JWT signing (min 32 chars) |
| `ENCRYPTION_SECRET` | Yes | Secret for AES-256 encryption of stored credentials |
| `PORT` | No | Server port (default: `3000`) |
| `DB_PATH` | No | Path to SQLite database (default: `./data/ssh-client.db`) |
| `LOG_DIR` | No | Directory for session logs (default: `./logs`) |
| `SSL_CERT_PATH` | No | Path to SSL certificate for HTTPS |
| `SSL_KEY_PATH` | No | Path to SSL private key for HTTPS |
| `NODE_ENV` | No | Set to `production` to enable secure cookies (requires HTTPS) |

## HTTPS Setup

For HTTPS, provide SSL cert paths:

```env
SSL_CERT_PATH=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/yourdomain.com/privkey.pem
NODE_ENV=production
```

Or use a reverse proxy (nginx, Caddy) in front of the app on port 3000.

## Security Notes

- All SSH credentials are encrypted at rest using AES-256-GCM before being stored in SQLite
- Private keys are never transmitted to the browser
- SSH connections are made server-side only
- Session cookies are `httpOnly` and `SameSite=Strict`
- Helmet.js sets secure HTTP headers on all responses
- Login rate-limited to 10 attempts per 15 minutes per IP

## Project Structure

```
online-ssh/
├── client/              # Static frontend (HTML, CSS, JS)
│   ├── index.html       # Main terminal app
│   ├── login.html       # Login page
│   ├── logs.html        # Session log viewer
│   ├── css/style.css    # Dark theme styles
│   └── js/
│       ├── app.js       # Main app (tabs, host manager, terminal)
│       └── login.js     # Login form
├── server/              # Node.js backend
│   └── src/
│       ├── index.js     # Express + WebSocket server
│       ├── db.js        # SQLite setup
│       ├── auth.js      # Auth middleware
│       ├── crypto.js    # AES-256 encrypt/decrypt
│       ├── websocket.js # SSH ↔ WebSocket bridge
│       └── routes/
│           ├── auth.js  # Login / logout / me
│           ├── hosts.js # Saved host CRUD
│           └── logs.js  # Session log API
├── data/                # SQLite database (created on first run)
├── logs/                # Session log files (created on first run)
├── Dockerfile
├── docker-compose.yml
└── .env.example
```
