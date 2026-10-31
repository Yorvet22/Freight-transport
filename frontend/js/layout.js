/**
 * FreightFlow app shell (window.FT.layout).
 * Wraps <main id="app"> in a grouped sidebar + top bar, loads the current user,
 * applies role-based visibility and the persisted light/dark theme, and turns
 * Lucide placeholders (<i data-lucide>) into SVGs after every render.
 * Page scripts wait for `FT.layout.ready` (resolves with the user).
 */
(function (root) {
  'use strict';

  const THEME_KEY = 'ft-theme';
  const ui = root.FT.ui;
  const api = root.FT.api;

  const NAV = [
    { title: 'Operations', items: [
      { href: '/index.html', icon: 'layout-dashboard', label: 'Dashboard', match: ['/', '/index.html'] },
      { href: '/orders.html', icon: 'package', label: 'Orders' },
      { href: '/warehouses.html', icon: 'warehouse', label: 'Warehouses' },
    ] },
    { title: 'Fleet', items: [{ href: '/vehicles.html', icon: 'truck', label: 'Vehicles' }] },
    { title: 'Insights', items: [{ href: '/reports.html', icon: 'chart-column', label: 'Reports' }] },
    { title: 'Admin', role: 'admin', items: [{ href: '/users.html', icon: 'users', label: 'Users' }] },
  ];

  /** Flat single-colour brand glyph (two chevrons), 20px, accent colour. */
  const BRAND_GLYPH = '<svg class="brand-glyph" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5l5 5-5 5"/><path d="M11 5l5 5-5 5"/></svg>';

  // ---------------------------------------------------------------------------
  // Icons: re-render Lucide placeholders whenever the DOM changes
  // ---------------------------------------------------------------------------
  let iconFrame = 0;
  function scheduleIcons() {
    if (iconFrame) return;
    iconFrame = root.requestAnimationFrame(() => { iconFrame = 0; ui.renderIcons(); });
  }
  function watchIcons() {
    ui.renderIcons();
    new MutationObserver(scheduleIcons).observe(document.body, { childList: true, subtree: true });
    root.addEventListener('load', () => ui.renderIcons());
  }

  // ---------------------------------------------------------------------------
  // Theme (applied immediately to avoid a flash)
  // ---------------------------------------------------------------------------
  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (_) { return null; }
  }

  function currentTheme() {
    const t = storedTheme();
    if (t === 'light' || t === 'dark') return t;
    return root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  const themeIcon = (theme) => ui.icon(theme === 'dark' ? 'sun' : 'moon');

  function syncThemeButtons() {
    document.querySelectorAll('[data-action="toggle-theme"]').forEach((b) => { b.innerHTML = themeIcon(currentTheme()); });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    syncThemeButtons();
    document.dispatchEvent(new CustomEvent('ft:themechange', { detail: { theme } }));
  }

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* storage unavailable */ }
    applyTheme(next);
  }

  document.documentElement.setAttribute('data-bs-theme', currentTheme());

  // ---------------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------------
  let user = null;

  function can(role) {
    return !!user && ui.hasRole(user.role, role);
  }

  /** Hides [data-requires-role] elements the user may not use. */
  function applyRoles(scope) {
    (scope || document).querySelectorAll('[data-requires-role]').forEach((n) => {
      if (!can(n.dataset.requiresRole)) {
        n.classList.add('d-none');
        n.setAttribute('aria-hidden', 'true');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Shell
  // ---------------------------------------------------------------------------
  function isActive(item) {
    return (item.match || [item.href]).includes(location.pathname);
  }

  function navHtml() {
    return NAV.map((group) => `
      <div class="side-group"${group.role ? ` data-requires-role="${group.role}"` : ''}>
        <div class="side-section">${ui.escapeHtml(group.title)}</div>
        <nav class="side-nav" aria-label="${ui.escapeHtml(group.title)}">
          ${group.items.map((item) => `
            <a class="side-link${isActive(item) ? ' active' : ''}" href="${item.href}"${isActive(item) ? ' aria-current="page"' : ''}>
              ${ui.icon(item.icon, 'icon-20')}<span>${ui.escapeHtml(item.label)}</span>
            </a>`).join('')}
        </nav>
      </div>`).join('');
  }

  function buildShell(main) {
    const title = document.body.dataset.title || document.title.split('·')[0].trim();
    const shell = document.createElement('div');
    shell.className = 'app-shell';
    shell.innerHTML = `
      <aside class="sidebar" id="sidebar" aria-label="Main navigation">
        <a class="brand" href="/index.html">${BRAND_GLYPH}<span class="brand-name">FreightFlow</span></a>
        ${navHtml()}
        <div class="sidebar-footer">Freight transport management</div>
      </aside>
      <div class="sidebar-backdrop" data-action="close-sidebar"></div>
      <div class="app-main">
        <header class="topbar">
          <button type="button" class="btn btn-icon d-lg-none" data-action="open-sidebar" aria-label="Open menu">${ui.icon('menu', 'icon-20')}</button>
          <h1 class="topbar-title">${ui.escapeHtml(title)}</h1>
          <div class="ms-auto d-flex align-items-center gap-2">
            <button type="button" class="btn btn-icon" data-action="toggle-theme" aria-label="Toggle light/dark theme" title="Toggle theme">${themeIcon(currentTheme())}</button>
            <div class="dropdown">
              <button type="button" class="btn user-chip" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Account menu">
                <span class="avatar" data-role="user-initials">··</span>
                <span class="d-none d-sm-flex flex-column text-start lh-sm">
                  <span class="fw-medium small" data-role="user-name">Loading…</span>
                  <span class="text-body-secondary xsmall" data-role="user-role"></span>
                </span>
                ${ui.icon('chevron-down', 'icon-muted')}
              </button>
              <ul class="dropdown-menu dropdown-menu-end">
                <li><span class="dropdown-item-text small text-body-secondary" data-role="user-menu-name"></span></li>
                <li><hr class="dropdown-divider"></li>
                <li><button type="button" class="dropdown-item" data-action="logout">Sign out</button></li>
              </ul>
            </div>
          </div>
        </header>
      </div>`;
    main.parentNode.insertBefore(shell, main);
    shell.querySelector('.app-main').appendChild(main);
    main.classList.add('app-content');

    shell.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      switch (a.dataset.action) {
        case 'toggle-theme': toggleTheme(); break;
        case 'open-sidebar': document.body.classList.add('sidebar-open'); break;
        case 'close-sidebar': document.body.classList.remove('sidebar-open'); break;
        case 'logout': logout(); break;
        default: break;
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.body.classList.remove('sidebar-open');
    });
  }

  function showUser(u) {
    const set = (sel, text) => document.querySelectorAll(sel).forEach((n) => { n.textContent = text; });
    set('[data-role="user-name"]', u.username);
    set('[data-role="user-menu-name"]', `Signed in as ${u.username}`);
    set('[data-role="user-role"]', ui.label(ui.ROLE_LABELS, u.role));
    set('[data-role="user-initials"]', String(u.username || '?').slice(0, 2).toUpperCase());
  }

  async function logout() {
    try { await api.post('/auth/logout'); } catch (_) { /* ignore */ }
    location.href = '/login.html';
  }

  let resolveReady;
  let rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });

  async function init() {
    watchIcons();
    const main = document.getElementById('app');
    if (!main) { syncThemeButtons(); return; }
    buildShell(main);
    try {
      const res = await api.get('/auth/me');
      user = (res && res.user) || res;
      showUser(user);
      applyRoles(document);
      document.body.classList.add('ready');
      resolveReady(user);
    } catch (err) {
      if (err.status !== 401) ui.toastError(err);
      rejectReady(err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  root.FT.layout = {
    ready,
    can,
    applyRoles,
    get user() { return user; },
    currentTheme,
    toggleTheme,
  };
})(window);
