/* ============================================================
   SSH Web Client — Main Application
   ============================================================ */

// Auth guard
(async () => {
  try {
    const r = await fetch('/api/auth/me');
    if (!r.ok) { window.location.href = '/login'; return; }
    const { username } = await r.json();
    document.getElementById('headerUsername').textContent = username;
  } catch {
    window.location.href = '/login';
    return;
  }

  App.init();
})();

// ── Utilities ──────────────────────────────────────────────

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) { window.location.href = '/login'; return null; }
  return res;
}

// ── Tab Manager ─────────────────────────────────────────────

const Tabs = (() => {
  let tabs = [];
  let activeId = null;
  let nextId = 1;

  const bar = document.getElementById('tabBar');
  const area = document.getElementById('terminalArea');
  const placeholder = document.getElementById('terminalPlaceholder');

  function render() {
    // Clear existing tab elements (keep new-tab button)
    bar.querySelectorAll('.tab').forEach(el => el.remove());

    tabs.forEach(tab => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === activeId ? ' active' : '');
      el.dataset.tabId = tab.id;
      el.innerHTML = `
        <span class="status-dot ${tab.status}"></span>
        <span class="tab-name" title="${tab.nickname}">${tab.nickname}</span>
        <button class="tab-close btn-icon" data-close="${tab.id}" title="Close">×</button>
      `;
      el.addEventListener('click', (e) => {
        if (e.target.dataset.close) { close(parseInt(e.target.dataset.close)); return; }
        activate(tab.id);
      });
      bar.insertBefore(el, document.getElementById('newTabBtn'));
    });

    placeholder.style.display = tabs.length === 0 ? 'flex' : 'none';
    updatePageTitle();
  }

  function updatePageTitle() {
    const tab = tabs.find(t => t.id === activeId);
    if (tab) {
      document.title = `${tab.nickname} — SSH Client`;
    } else {
      document.title = 'SSH Web Client';
    }
  }

  function activate(id) {
    activeId = id;
    document.querySelectorAll('.terminal-pane').forEach(pane => {
      pane.classList.toggle('active', pane.dataset.tabId == id);
    });
    const tab = tabs.find(t => t.id === id);
    if (tab?.terminal) {
      requestAnimationFrame(() => { tab.terminal.fit(); tab.terminal.focus(); });
    }
    render();
  }

  function create(nickname, connectFn) {
    const id = nextId++;
    const pane = document.createElement('div');
    pane.className = 'terminal-pane';
    pane.dataset.tabId = id;
    area.appendChild(pane);

    const tab = { id, nickname, status: 'connecting', pane, terminal: null, ws: null };
    tabs.push(tab);
    activate(id);

    tab.terminal = TerminalSession.create(pane, tab, connectFn);
    render();
    return tab;
  }

  function close(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const tab = tabs[idx];
    if (tab.ws) { try { tab.ws.close(); } catch {} }
    tab.pane.remove();
    tabs.splice(idx, 1);

    if (activeId === id) {
      const next = tabs[Math.max(0, idx - 1)];
      activeId = next ? next.id : null;
      if (next) activate(next.id);
    }
    render();
  }

  function updateStatus(id, status) {
    const tab = tabs.find(t => t.id === id);
    if (tab) { tab.status = status; render(); }
  }

  function getActive() { return tabs.find(t => t.id === activeId) || null; }

  return { create, close, activate, updateStatus, getActive, render };
})();

// ── Terminal Session ─────────────────────────────────────────

const TerminalSession = (() => {
  function create(pane, tab, connectPayload) {
    const term = new Terminal({
      theme: {
        background: '#000000',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        cursorAccent: '#000000',
        selectionBackground: 'rgba(88, 166, 255, 0.3)',
        black: '#010409', red: '#f85149', green: '#3fb950',
        yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff',
        cyan: '#39c5cf', white: '#b1bac4',
        brightBlack: '#6e7681', brightRed: '#ff7b72', brightGreen: '#56d364',
        brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
      },
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, Consolas, monospace",
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon.FitAddon();
    const linksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(linksAddon);
    term.open(pane);
    fitAddon.fit();

    // Expose fit method on tab
    tab.terminal = { term, fit: () => fitAddon.fit(), focus: () => term.focus() };

    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProto}//${location.host}/ws/ssh`);
    tab.ws = ws;

    term.writeln('\x1b[90mConnecting…\x1b[0m');

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'connect', ...connectPayload }));
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case 'connected':
          Tabs.updateStatus(tab.id, 'connected');
          term.clear();
          fitAddon.fit();
          sendResize();
          break;
        case 'data': {
          const binary = atob(msg.data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          term.write(bytes);
          break;
        }
        case 'error':
          term.writeln(`\r\n\x1b[31m✖ ${msg.message}\x1b[0m`);
          Tabs.updateStatus(tab.id, 'disconnected');
          break;
        case 'closed':
          term.writeln(`\r\n\x1b[90m[${msg.message}]\x1b[0m`);
          Tabs.updateStatus(tab.id, 'disconnected');
          break;
      }
    };

    ws.onclose = () => Tabs.updateStatus(tab.id, 'disconnected');
    ws.onerror = () => {
      term.writeln('\r\n\x1b[31m✖ WebSocket error\x1b[0m');
      Tabs.updateStatus(tab.id, 'disconnected');
    };

    function sendResize() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }));
      }
    }

    // Input
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    // Paste confirmation for multi-line
    term.onPaste = undefined; // handled via custom paste
    pane.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text');
      const lines = text.split('\n');
      if (lines.length > 1 && text.trim().length > 0) {
        PasteDialog.show(text, () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'data', data: text }));
          }
        });
      } else {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'data', data: text }));
        }
      }
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      sendResize();
    });
    ro.observe(pane);

    return tab.terminal;
  }

  return { create };
})();

// ── Paste Dialog ─────────────────────────────────────────────

const PasteDialog = (() => {
  let _resolve = null;
  const overlay = document.getElementById('pasteModal');
  const preview = document.getElementById('pastePreview');
  const lineCount = document.getElementById('pasteLineCount');

  document.getElementById('pasteConfirmBtn').addEventListener('click', () => {
    overlay.classList.remove('open');
    if (_resolve) { _resolve(true); _resolve = null; }
  });
  const cancel = () => {
    overlay.classList.remove('open');
    if (_resolve) { _resolve(false); _resolve = null; }
  };
  document.getElementById('pasteCancelBtn').addEventListener('click', cancel);
  document.getElementById('pasteModalClose').addEventListener('click', cancel);

  function show(text, onConfirm) {
    const lines = text.split('\n');
    lineCount.textContent = `${lines.length} lines · ${text.length} characters`;
    preview.textContent = text.length > 500 ? text.slice(0, 500) + '…' : text;
    overlay.classList.add('open');
    _resolve = (confirmed) => { if (confirmed) onConfirm(); };
  }

  return { show };
})();

// ── Host Manager ─────────────────────────────────────────────

const HostManager = (() => {
  let hosts = [];
  let editingId = null;
  let pendingConnect = null;

  const hostList = document.getElementById('hostList');
  const modal = document.getElementById('hostModal');
  const form = document.getElementById('hostForm');

  async function load() {
    const res = await api('/api/hosts');
    if (!res) return;
    hosts = await res.json();
    renderList();
  }

  function renderList() {
    if (hosts.length === 0) {
      hostList.innerHTML = '<div style="color:var(--text-dim); font-size:12px; padding:8px; text-align:center">No saved hosts yet</div>';
      return;
    }
    hostList.innerHTML = hosts.map(h => `
      <div class="host-item" data-id="${h.id}">
        <span style="font-size:16px">${h.auth_method === 'key' ? '🔑' : '🔒'}</span>
        <div class="host-item-info">
          <div class="host-item-name">${esc(h.nickname)}</div>
          <div class="host-item-sub">${esc(h.username)}@${esc(h.hostname)}:${h.port}</div>
        </div>
        <div class="host-item-actions">
          <button class="btn-icon" data-action="edit" data-id="${h.id}" title="Edit">✏️</button>
          <button class="btn-icon" data-action="delete" data-id="${h.id}" title="Delete" style="color:var(--red)">🗑</button>
        </div>
      </div>
    `).join('');

    hostList.querySelectorAll('.host-item').forEach(el => {
      el.addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        const id = parseInt(el.dataset.id);
        if (action === 'edit') { openEdit(id); return; }
        if (action === 'delete') { confirmDelete(id); return; }
        openConnect(id);
      });
    });
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function openAdd() {
    editingId = null;
    document.getElementById('hostModalTitle').textContent = 'Add Host';
    document.getElementById('hostModalSave').textContent = 'Save';
    form.reset();
    document.getElementById('hPort').value = '22';
    setAuthMethod('password');
    modal.classList.add('open');
    document.getElementById('hNickname').focus();
  }

  function openEdit(id) {
    const host = hosts.find(h => h.id === id);
    if (!host) return;
    editingId = id;
    document.getElementById('hostModalTitle').textContent = 'Edit Host';
    document.getElementById('hostModalSave').textContent = 'Save changes';
    document.getElementById('hNickname').value = host.nickname;
    document.getElementById('hHostname').value = host.hostname;
    document.getElementById('hPort').value = host.port;
    document.getElementById('hUsername').value = host.username;
    document.getElementById('hPassword').value = '';
    document.getElementById('hKey').value = '';
    setAuthMethod(host.auth_method);
    modal.classList.add('open');
    document.getElementById('hNickname').focus();
  }

  function openConnect(id) {
    const host = hosts.find(h => h.id === id);
    if (!host) return;
    pendingConnect = host;
    document.getElementById('connectModalTitle').textContent = `Connect to ${host.nickname}`;
    document.getElementById('connectPasswordRow').style.display = 'none';
    document.getElementById('connectPassword').value = '';
    document.getElementById('connectLogging').checked = false;
    document.getElementById('connectModal').classList.add('open');
  }

  async function confirmDelete(id) {
    const host = hosts.find(h => h.id === id);
    if (!host) return;
    if (!confirm(`Delete "${host.nickname}"?`)) return;
    const res = await api(`/api/hosts/${id}`, { method: 'DELETE' });
    if (res?.ok) { toast('Host deleted', 'success'); await load(); }
    else toast('Failed to delete host', 'error');
  }

  function setAuthMethod(method) {
    document.getElementById('hAuthMethod').value = method;
    document.querySelectorAll('.auth-toggle button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.method === method);
    });
    document.getElementById('authFieldPassword').classList.toggle('visible', method === 'password');
    document.getElementById('authFieldKey').classList.toggle('visible', method === 'key');
  }

  function closeModal() {
    modal.classList.remove('open');
    editingId = null;
  }

  // Modal event wiring
  document.querySelectorAll('.auth-toggle button').forEach(btn => {
    btn.addEventListener('click', () => setAuthMethod(btn.dataset.method));
  });

  document.getElementById('hostModalClose').addEventListener('click', closeModal);
  document.getElementById('hostModalCancel').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('hostModalSave');
    saveBtn.disabled = true;

    const body = {
      nickname: document.getElementById('hNickname').value.trim(),
      hostname: document.getElementById('hHostname').value.trim(),
      port: parseInt(document.getElementById('hPort').value),
      username: document.getElementById('hUsername').value.trim(),
      auth_method: document.getElementById('hAuthMethod').value,
    };

    if (body.auth_method === 'password') {
      const pw = document.getElementById('hPassword').value;
      if (pw) body.password = pw;
    } else {
      const key = document.getElementById('hKey').value.trim();
      if (key) body.private_key = key;
    }

    const url = editingId ? `/api/hosts/${editingId}` : '/api/hosts';
    const method = editingId ? 'PUT' : 'POST';

    try {
      const res = await api(url, { method, body });
      if (!res) return;
      if (res.ok) {
        toast(editingId ? 'Host updated' : 'Host added', 'success');
        closeModal();
        await load();
      } else {
        const d = await res.json();
        toast(d.error || 'Failed to save host', 'error');
      }
    } finally {
      saveBtn.disabled = false;
    }
  });

  // Connect modal
  const connectModal = document.getElementById('connectModal');
  const connectForm = document.getElementById('connectForm');

  document.getElementById('connectModalClose').addEventListener('click', () => connectModal.classList.remove('open'));
  document.getElementById('connectModalCancel').addEventListener('click', () => connectModal.classList.remove('open'));
  connectModal.addEventListener('click', (e) => { if (e.target === connectModal) connectModal.classList.remove('open'); });

  connectForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!pendingConnect) return;
    connectModal.classList.remove('open');

    const payload = {
      host_id: pendingConnect.id,
      enable_logging: document.getElementById('connectLogging').checked,
    };

    Tabs.create(pendingConnect.nickname, payload);
    pendingConnect = null;
  });

  return { load, openAdd };
})();

// ── Quick Connect ─────────────────────────────────────────────

document.getElementById('quickConnectForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const hostname = document.getElementById('qcHost').value.trim();
  const username = document.getElementById('qcUser').value.trim();
  const port = parseInt(document.getElementById('qcPort').value) || 22;
  const password = document.getElementById('qcPassword').value;
  const enable_logging = document.getElementById('qcLogging').checked;

  const nickname = `${username}@${hostname}`;
  Tabs.create(nickname, {
    hostname, port, username, enable_logging,
    auth_method: 'password',
    password: password || undefined,
  });
});

// ── Keyboard shortcuts ────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'T') {
    e.preventDefault();
    // Open connect modal or focus quick-connect
    document.getElementById('qcHost').focus();
  }
});

// ── Mobile sidebar ────────────────────────────────────────────

const sidebar = document.getElementById('sidebar');
const backdrop = document.getElementById('sidebarBackdrop');

document.getElementById('sidebarToggle').addEventListener('click', () => {
  sidebar.classList.toggle('mobile-open');
  backdrop.classList.toggle('visible');
});
backdrop.addEventListener('click', () => {
  sidebar.classList.remove('mobile-open');
  backdrop.classList.remove('visible');
});

// ── New tab button ────────────────────────────────────────────

document.getElementById('newTabBtn').addEventListener('click', () => {
  document.getElementById('qcHost').focus();
  sidebar.classList.add('mobile-open');
  backdrop.classList.add('visible');
});

// ── Add host buttons ──────────────────────────────────────────

document.getElementById('addHostBtn').addEventListener('click', () => HostManager.openAdd());
document.getElementById('placeholderAddBtn').addEventListener('click', () => HostManager.openAdd());

// ── Logout ────────────────────────────────────────────────────

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});

// ── Init ──────────────────────────────────────────────────────

const App = {
  init() { HostManager.load(); },
};
