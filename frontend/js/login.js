/** Login page: POST /api/auth/login, then redirect to ?next (same-origin path only) or the dashboard. */
(function () {
  'use strict';

  const { api, ui, layout } = window.FT;
  const form = document.getElementById('loginForm');

  function nextUrl() {
    const next = new URLSearchParams(location.search).get('next') || '';
    // Only allow local absolute paths ("/orders.html"), never "//host" or "http://".
    return /^\/(?!\/)[\w\-./?=&%]*$/.test(next) && !/login/.test(next) ? next : '/index.html';
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'toggle-theme') layout.toggleTheme();
    if (a.dataset.action === 'fill-demo') {
      form.username.value = a.dataset.username;
      form.password.value = a.dataset.password;
      form.password.focus();
    }
    if (a.dataset.action === 'toggle-password') {
      const show = form.password.type === 'password';
      form.password.type = show ? 'text' : 'password';
      a.textContent = show ? 'Hide' : 'Show';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ui.clearFieldErrors(form);
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) {
      ui.showFieldErrors(form, {
        message: 'Please enter your username and password.',
        details: [!username && { field: 'username', message: 'Username is required.' }, !password && { field: 'password', message: 'Password is required.' }].filter(Boolean),
      });
      return;
    }
    await ui.withBusy(document.getElementById('loginBtn'), async () => {
      try {
        await api.post('/auth/login', { username, password });
        location.href = nextUrl();
      } catch (err) {
        ui.showFieldErrors(form, { message: err.status === 401 ? 'Invalid username or password.' : ui.errorMessage(err), details: [] });
      }
    });
  });

  // Already signed in? Go straight to the app.
  api.get('/auth/me', null, { noRedirect: true }).then(() => { location.href = nextUrl(); }).catch(() => {});
})();
