(async () => {
  // Redirect to app if already logged in
  try {
    const r = await fetch('/api/auth/me');
    if (r.ok) { window.location.href = '/'; return; }
  } catch {}

  const form = document.getElementById('loginForm');
  const errEl = document.getElementById('errorMsg');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.remove('visible');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value.trim(),
          password: document.getElementById('password').value,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = '/';
      } else {
        errEl.textContent = data.error || 'Login failed';
        errEl.classList.add('visible');
      }
    } catch {
      errEl.textContent = 'Network error — is the server running?';
      errEl.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
})();
