/**
 * FreightFlow UI helpers (window.FT.ui).
 * Pure helpers (escaping, formatting, enum maps, pagination maths) are also
 * exported via module.exports so they can be unit-tested with jest (node env).
 * DOM helpers (toasts, confirm dialog, pagination renderer, field errors)
 * only touch `document` when called.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Escaping
  // ---------------------------------------------------------------------------
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, (ch) => ESCAPES[ch]);
  }

  // ---------------------------------------------------------------------------
  // Enum labels & badge classes (SPEC §1)
  // ---------------------------------------------------------------------------
  const ORDER_STATUS_LABELS = { new: 'New', in_transit: 'In Transit', delivered: 'Delivered', cancelled: 'Cancelled' };
  const ORDER_TYPE_LABELS = { inbound: 'Inbound', outbound: 'Outbound', transfer: 'Transfer' };
  const VEHICLE_STATUS_LABELS = { available: 'Available', on_trip: 'On Trip', maintenance: 'Maintenance' };
  const ROLE_LABELS = { admin: 'Admin', dispatcher: 'Dispatcher', viewer: 'Viewer' };

  const ORDER_STATUS_BADGES = {
    new: 'badge-status badge-new',
    in_transit: 'badge-status badge-transit',
    delivered: 'badge-status badge-delivered',
    cancelled: 'badge-status badge-cancelled',
  };
  // Types are not statuses: plain muted text, no colour (DESIGN §4 "unique hue per status").
  const ORDER_TYPE_BADGES = {
    inbound: 'badge-type',
    outbound: 'badge-type',
    transfer: 'badge-type',
  };
  // DESIGN §3: On Trip → blue, Available → green, Maintenance → amber.
  const VEHICLE_STATUS_BADGES = {
    available: 'badge-status badge-delivered',
    on_trip: 'badge-status badge-transit',
    maintenance: 'badge-status badge-maintenance',
  };
  const ROLE_BADGES = {
    admin: 'badge-status badge-plain badge-transit',
    dispatcher: 'badge-status badge-plain badge-new',
    viewer: 'badge-status badge-plain badge-cancelled',
  };

  /** Returns the label for a code, falling back to the code itself (or an em dash). */
  function label(map, code) {
    if (code === null || code === undefined || code === '') return '—';
    return Object.prototype.hasOwnProperty.call(map, code) ? map[code] : String(code);
  }

  function badge(labels, classes, code) {
    const cls = classes[code] || 'badge-status badge-cancelled';
    return `<span class="${cls}">${escapeHtml(label(labels, code))}</span>`;
  }

  const statusBadge = (code) => badge(ORDER_STATUS_LABELS, ORDER_STATUS_BADGES, code);
  const typeBadge = (code) => badge(ORDER_TYPE_LABELS, ORDER_TYPE_BADGES, code);
  const vehicleStatusBadge = (code) => badge(VEHICLE_STATUS_LABELS, VEHICLE_STATUS_BADGES, code);
  const roleBadge = (code) => badge(ROLE_LABELS, ROLE_BADGES, code);

  // ---------------------------------------------------------------------------
  // Order status transitions (SPEC §1)
  // ---------------------------------------------------------------------------
  const TRANSITIONS = {
    new: ['in_transit', 'cancelled'],
    in_transit: ['delivered', 'cancelled'],
    delivered: [],
    cancelled: [],
  };

  function allowedTransitions(status) {
    return (TRANSITIONS[status] || []).slice();
  }

  function canTransition(from, to) {
    return allowedTransitions(from).includes(to);
  }

  /** BR4: in_transit / delivered orders cannot be edited or deleted. */
  function isOrderLocked(status) {
    return status === 'in_transit' || status === 'delivered';
  }

  // ---------------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------------
  const ROLE_RANK = { viewer: 0, dispatcher: 1, admin: 2 };

  /** True if `userRole` satisfies `requiredRole` (dispatcher+ / admin). */
  function hasRole(userRole, requiredRole) {
    if (!requiredRole) return true;
    if (!(userRole in ROLE_RANK) || !(requiredRole in ROLE_RANK)) return false;
    return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
  const pad2 = (n) => String(n).padStart(2, '0');

  /** Parses API dates. "YYYY-MM-DD" is treated as a local calendar date (no TZ shift). */
  function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    const str = String(value);
    const m = DATE_ONLY.exec(str);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(str.includes('T') || !/^\d{4}-\d{2}-\d{2} /.test(str) ? str : str.replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDate(value) {
    const str = typeof value === 'string' ? value : '';
    const m = DATE_ONLY.exec(str.slice(0, 10));
    // Calendar dates (and DATE columns serialised at midnight) keep their Y-M-D.
    if (m && (str.length === 10 || /T00:00:00(\.000)?Z?$/.test(str))) {
      return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
    }
    const d = parseDate(value);
    if (!d) return '—';
    return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  function formatDateTime(value) {
    const d = parseDate(value);
    if (!d) return '—';
    return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function formatTime(value) {
    const d = parseDate(value);
    if (!d) return '—';
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function formatNumber(value, decimals) {
    const n = Number(value);
    if (value === null || value === undefined || value === '' || !isFinite(n)) return '—';
    const fixed = n.toFixed(decimals === undefined ? 0 : decimals);
    const [int, frac] = fixed.split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return frac ? `${grouped}.${frac}` : grouped;
  }

  /** 1234.5 → "1,234.5 kg"; whole numbers lose the decimals. */
  function formatWeight(value) {
    const n = Number(value);
    if (value === null || value === undefined || value === '' || !isFinite(n)) return '—';
    return `${formatNumber(n, Number.isInteger(n) ? 0 : 1)} kg`;
  }

  /** Fraction 0..1 → "87.5%"; null → "—". */
  function formatPercent(fraction, decimals) {
    if (fraction === null || fraction === undefined || fraction === '' || !isFinite(Number(fraction))) return '—';
    return `${(Number(fraction) * 100).toFixed(decimals === undefined ? 1 : decimals)}%`;
  }

  /** Hours → "5.3 h" or "2.1 d" for long durations; null → "—". */
  function formatHours(hours) {
    if (hours === null || hours === undefined || hours === '' || !isFinite(Number(hours))) return '—';
    const h = Number(hours);
    if (h >= 48) return `${(h / 24).toFixed(1)} d`;
    return `${h.toFixed(1)} h`;
  }

  /** Value for <input type="date">. */
  function toDateInput(value) {
    if (!value) return '';
    const str = String(value);
    if (DATE_ONLY.test(str.slice(0, 10)) && (str.length === 10 || /T00:00:00(\.000)?Z?$/.test(str))) return str.slice(0, 10);
    const d = parseDate(value);
    if (!d) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  /** Value for <input type="datetime-local"> (local time). */
  function toDateTimeLocal(value) {
    const d = parseDate(value);
    if (!d) return '';
    return `${toDateInput(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  /** datetime-local "YYYY-MM-DDTHH:mm" (local time) → unambiguous UTC ISO-8601 string (or null). */
  function fromDateTimeLocal(value) {
    if (!value) return null;
    const d = new Date(value.length === 16 ? `${value}:00` : value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  function todayIso(now) {
    return toDateInput(now || new Date());
  }

  // ---------------------------------------------------------------------------
  // Pagination maths
  // ---------------------------------------------------------------------------
  function totalPages(total, limit) {
    if (!total || !limit) return 1;
    return Math.max(1, Math.ceil(total / limit));
  }

  /**
   * Page list with ellipses, e.g. (5, 10) → [1, '…', 4, 5, 6, '…', 10].
   * Always contains first and last page and `siblings` pages around current.
   */
  function pageList(current, pages, siblings) {
    const s = siblings === undefined ? 1 : siblings;
    const last = Math.max(1, Math.floor(pages) || 1);
    const cur = Math.min(Math.max(1, Math.floor(current) || 1), last);
    const slots = 2 * s + 5; // first, last, two ellipses, current and siblings
    const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    if (last <= slots) return range(1, last);
    const edge = 2 * s + 3; // pages shown next to a single ellipsis
    if (cur <= s + 3) return range(1, edge).concat(['…', last]);
    if (cur >= last - s - 2) return [1, '…'].concat(range(last - edge + 1, last));
    return [1, '…'].concat(range(cur - s, cur + s), ['…', last]);
  }

  /** "Showing 21–40 of 95" text. */
  function rangeText(page, limit, total) {
    if (!total) return 'No results';
    const from = (page - 1) * limit + 1;
    const to = Math.min(total, page * limit);
    return `Showing ${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}`;
  }

  // ---------------------------------------------------------------------------
  // KPI helpers
  // ---------------------------------------------------------------------------
  /**
   * Orders created in the last 7 days vs the previous 7, from ordersPerDay
   * (oldest first, SPEC §6). change is a fraction, or null when previous = 0.
   */
  function weekDelta(ordersPerDay) {
    const counts = (ordersPerDay || []).map((d) => Number(d && d.count) || 0);
    const current = counts.slice(-7).reduce((a, b) => a + b, 0);
    const previous = counts.slice(-14, -7).reduce((a, b) => a + b, 0);
    const change = previous > 0 ? Math.round(((current - previous) / previous) * 10000) / 10000 : null;
    return { current, previous, change };
  }

  /**
   * Delta line text + tone. `higherIsGood` decides the colour (meaning, not direction).
   * { change: 0.042 } → { text: '▲ 4.2%', tone: 'good' }
   */
  function formatDelta(change, higherIsGood) {
    if (change === null || change === undefined || !isFinite(Number(change))) return { text: '—', tone: 'neutral' };
    const c = Number(change);
    if (c === 0) return { text: '0.0%', tone: 'neutral' };
    const up = c > 0;
    const good = higherIsGood === false ? !up : up;
    return { text: `${up ? '▲' : '▼'} ${Math.abs(c * 100).toFixed(1)}%`, tone: good ? 'good' : 'bad' };
  }

  /** SVG path ("M x y L …") for a sparkline of `values` inside a w×h box (1px padding). */
  function sparklinePath(values, w, h) {
    const v = (values || []).map((n) => Number(n) || 0);
    if (!v.length) return '';
    const max = Math.max(...v);
    const min = Math.min(...v);
    const span = max - min || 1;
    const step = v.length > 1 ? (w - 2) / (v.length - 1) : 0;
    const r = (n) => Math.round(n * 100) / 100;
    return v.map((n, i) => {
      const x = v.length > 1 ? 1 + i * step : w / 2;
      const y = max === min ? h / 2 : 1 + (h - 2) * (1 - (n - min) / span);
      return `${i ? 'L' : 'M'}${r(x)} ${r(y)}`;
    }).join(' ');
  }

  // ---------------------------------------------------------------------------
  // Icons (Lucide). Markup only; layout.js turns <i data-lucide> into SVG.
  // ---------------------------------------------------------------------------
  function icon(name, cls) {
    return `<i data-lucide="${escapeHtml(name)}"${cls ? ` class="${escapeHtml(cls)}"` : ''} aria-hidden="true"></i>`;
  }

  /** Converts pending <i data-lucide> placeholders into SVGs (no-op without Lucide). */
  function renderIcons() {
    if (typeof document === 'undefined' || !root.lucide || !document.querySelector('i[data-lucide]')) return;
    root.lucide.createIcons();
  }

  // ---------------------------------------------------------------------------
  // Misc
  // ---------------------------------------------------------------------------
  function debounce(fn, wait) {
    let t = null;
    return function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait === undefined ? 300 : wait);
    };
  }

  /** Converts an error from FT.api into a friendly message. */
  function errorMessage(err) {
    if (!err) return 'Something went wrong.';
    if (err.status === 0) return 'Network error — is the server running?';
    return err.message || 'Something went wrong.';
  }

  // ---------------------------------------------------------------------------
  // DOM helpers (browser only)
  // ---------------------------------------------------------------------------
  function el(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    return tpl.content.firstElementChild;
  }

  function toastContainer() {
    let c = document.getElementById('ft-toasts');
    if (!c) {
      c = el('<div id="ft-toasts" class="toast-container position-fixed bottom-0 end-0 p-3" aria-live="polite"></div>');
      document.body.appendChild(c);
    }
    return c;
  }

  const TOAST_VARIANTS = ['success', 'danger', 'warning', 'info'];

  /** toast('Saved', 'success' | 'danger' | 'warning' | 'info') */
  function toast(message, variant) {
    const v = TOAST_VARIANTS.includes(variant) ? variant : 'info';
    const node = el(`
      <div class="toast ft-toast ft-toast-${v}" role="status" aria-atomic="true">
        <div class="d-flex align-items-start gap-2 p-3">
          <div class="flex-grow-1 small">${escapeHtml(message)}</div>
          <button type="button" class="btn-close btn-close-sm" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      </div>`);
    toastContainer().appendChild(node);
    if (root.bootstrap && root.bootstrap.Toast) {
      const t = new root.bootstrap.Toast(node, { delay: v === 'danger' ? 6000 : 3500 });
      node.addEventListener('hidden.bs.toast', () => node.remove());
      t.show();
    } else {
      setTimeout(() => node.remove(), 4000);
    }
  }

  function toastError(err) {
    toast(errorMessage(err), 'danger');
  }

  /**
   * Promise-based confirm modal.
   * confirm({ title, message, confirmText, variant, withNote, noteLabel })
   * Resolves to false when cancelled, or { note } when confirmed.
   */
  function confirmDialog(opts) {
    const o = Object.assign({ title: 'Are you sure?', message: '', confirmText: 'Confirm', variant: 'primary', withNote: false, noteLabel: 'Note (optional)' }, opts || {});
    return new Promise((resolve) => {
      const node = el(`
        <div class="modal fade" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header border-0 pb-0">
                <h5 class="modal-title">${escapeHtml(o.title)}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body">
                <p class="text-body-secondary mb-0">${escapeHtml(o.message)}</p>
                ${o.withNote ? `<label class="form-label mt-3 small fw-semibold" for="ft-confirm-note">${escapeHtml(o.noteLabel)}</label>
                <textarea id="ft-confirm-note" class="form-control" rows="2" maxlength="500"></textarea>` : ''}
              </div>
              <div class="modal-footer border-0 pt-0">
                <button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-${escapeHtml(o.variant)}" data-role="confirm">${escapeHtml(o.confirmText)}</button>
              </div>
            </div>
          </div>
        </div>`);
      document.body.appendChild(node);
      let result = false;
      const modal = new root.bootstrap.Modal(node);
      node.querySelector('[data-role="confirm"]').addEventListener('click', () => {
        const noteEl = node.querySelector('#ft-confirm-note');
        result = { note: noteEl ? noteEl.value.trim() : '' };
        modal.hide();
      });
      node.addEventListener('hidden.bs.modal', () => { modal.dispose(); node.remove(); resolve(result); });
      modal.show();
    });
  }

  /**
   * Renders pagination into `container`. `onChange(page)` is called on click.
   * Uses event delegation; re-rendering replaces the handler.
   */
  function renderPagination(container, state, onChange) {
    if (!container) return;
    const pages = totalPages(state.total, state.limit);
    const items = pageList(state.page, pages);
    const btn = (page, content, opts) => {
      const o = opts || {};
      return `<li class="page-item${o.disabled ? ' disabled' : ''}${o.active ? ' active' : ''}">
        <button type="button" class="page-link" ${o.disabled ? 'disabled' : `data-page="${page}"`} ${o.aria ? `aria-label="${o.aria}"` : ''}>${content}</button></li>`;
    };
    const parts = [btn(state.page - 1, icon('chevron-left'), { disabled: state.page <= 1, aria: 'Previous page' })];
    items.forEach((p) => {
      parts.push(p === '…' ? '<li class="page-item disabled"><span class="page-link">…</span></li>' : btn(p, String(p), { active: p === state.page }));
    });
    parts.push(btn(state.page + 1, icon('chevron-right'), { disabled: state.page >= pages, aria: 'Next page' }));
    container.innerHTML = `
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
        <span class="small text-body-secondary">${escapeHtml(rangeText(state.page, state.limit, state.total))}</span>
        <ul class="pagination pagination-sm mb-0">${parts.join('')}</ul>
      </div>`;
    container.onclick = (e) => {
      const b = e.target.closest('[data-page]');
      if (!b) return;
      const p = Number(b.dataset.page);
      if (p >= 1 && p <= pages && p !== state.page) onChange(p);
    };
  }

  function clearFieldErrors(form) {
    if (!form) return;
    form.querySelectorAll('.is-invalid').forEach((n) => n.classList.remove('is-invalid'));
    form.querySelectorAll('.invalid-feedback[data-generated]').forEach((n) => n.remove());
    const alert = form.querySelector('[data-role="form-alert"]');
    if (alert) { alert.classList.add('d-none'); alert.textContent = ''; }
  }

  /**
   * Highlights fields from an API error's `details` ([{ field, message }]).
   * Fields are matched by `name`. Unmatched messages go into [data-role="form-alert"].
   */
  function showFieldErrors(form, err) {
    clearFieldErrors(form);
    if (!form) return;
    const details = (err && Array.isArray(err.details)) ? err.details : [];
    const unmatched = [];
    details.forEach((d) => {
      const input = d && d.field ? form.querySelector(`[name="${CSS.escape(d.field)}"]`) : null;
      if (!input) { unmatched.push(d && d.message ? `${d.field ? d.field + ': ' : ''}${d.message}` : ''); return; }
      input.classList.add('is-invalid');
      const fb = document.createElement('div');
      fb.className = 'invalid-feedback';
      fb.dataset.generated = '1';
      fb.textContent = d.message || 'Invalid value';
      (input.closest('.input-group') || input).insertAdjacentElement('afterend', fb);
    });
    const alert = form.querySelector('[data-role="form-alert"]');
    const msg = details.length && !unmatched.filter(Boolean).length ? '' : [errorMessage(err)].concat(unmatched.filter(Boolean)).join(' ');
    if (alert && msg) { alert.textContent = msg; alert.classList.remove('d-none'); }
    else if (!alert && msg) toast(msg, 'danger');
    const first = form.querySelector('.is-invalid');
    if (first) first.focus();
  }

  /** Reads named form fields into an object of trimmed strings. */
  function formValues(form) {
    const out = {};
    Array.from(form.elements).forEach((n) => {
      if (!n.name || n.disabled) return;
      if (n.type === 'checkbox') out[n.name] = n.checked;
      else out[n.name] = typeof n.value === 'string' ? n.value.trim() : n.value;
    });
    return out;
  }

  /** Table body placeholder rows. */
  function skeletonRows(cols, rows) {
    const cells = Array.from({ length: cols }, () => '<td><span class="skeleton"></span></td>').join('');
    return Array.from({ length: rows || 6 }, () => `<tr class="skeleton-row">${cells}</tr>`).join('');
  }

  function emptyRow(cols, title, hint, iconName) {
    return `<tr class="empty-row"><td colspan="${cols}">${emptyState(title, hint, iconName)}</td></tr>`;
  }

  function emptyState(title, hint, iconName) {
    return `<div class="empty-state">
      <div class="empty-state-icon">${icon(iconName || 'inbox')}</div>
      <div class="fw-semibold">${escapeHtml(title || 'Nothing here yet')}</div>
      ${hint ? `<div class="small text-body-secondary">${escapeHtml(hint)}</div>` : ''}
    </div>`;
  }

  /** Toggles a spinner on a button while `promise` runs. */
  async function withBusy(button, fn) {
    if (!button) return fn();
    const html = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>${escapeHtml(button.textContent.trim())}`;
    try { return await fn(); } finally { button.disabled = false; button.innerHTML = html; }
  }

  /** Fills a <select> with options. items: [{ value, label }]. */
  function fillSelect(select, items, opts) {
    const o = opts || {};
    const parts = [];
    if (o.placeholder !== undefined) parts.push(`<option value="">${escapeHtml(o.placeholder)}</option>`);
    items.forEach((it) => {
      parts.push(`<option value="${escapeHtml(it.value)}"${it.disabled ? ' disabled' : ''}>${escapeHtml(it.label)}</option>`);
    });
    const prev = o.keepValue ? select.value : null;
    select.innerHTML = parts.join('');
    if (prev !== null) select.value = prev;
  }

  /** Updates sort indicators on <th data-sort>. */
  function updateSortHeaders(table, sort, dir) {
    table.querySelectorAll('th[data-sort]').forEach((th) => {
      const active = th.dataset.sort === sort;
      th.classList.toggle('sorted', active);
      th.setAttribute('aria-sort', active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.dataset.dir = active ? dir : '';
    });
  }

  const ui = {
    escapeHtml, label, statusBadge, typeBadge, vehicleStatusBadge, roleBadge,
    ORDER_STATUS_LABELS, ORDER_TYPE_LABELS, VEHICLE_STATUS_LABELS, ROLE_LABELS,
    ORDER_STATUS_BADGES, ORDER_TYPE_BADGES, VEHICLE_STATUS_BADGES, ROLE_BADGES,
    weekDelta, formatDelta, sparklinePath, icon, renderIcons,
    allowedTransitions, canTransition, isOrderLocked, hasRole,
    parseDate, formatDate, formatDateTime, formatTime, formatNumber, formatWeight, formatPercent, formatHours,
    toDateInput, toDateTimeLocal, fromDateTimeLocal, todayIso,
    totalPages, pageList, rangeText, debounce, errorMessage,
    toast, toastError, confirm: confirmDialog, renderPagination, clearFieldErrors, showFieldErrors,
    formValues, skeletonRows, emptyRow, emptyState, withBusy, fillSelect, updateSortHeaders,
  };

  root.FT = root.FT || {};
  root.FT.ui = ui;
  if (typeof module !== 'undefined' && module.exports) module.exports = ui;
})(typeof window !== 'undefined' ? window : globalThis);
