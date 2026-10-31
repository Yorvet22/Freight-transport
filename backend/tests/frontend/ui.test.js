/**
 * Unit tests for pure frontend helpers (frontend/js/ui.js, frontend/js/api.js).
 * Run from backend/: npx jest tests/frontend
 */
const path = require('path');

const ui = require(path.join(__dirname, '..', '..', '..', 'frontend', 'js', 'ui.js'));
const api = require(path.join(__dirname, '..', '..', '..', 'frontend', 'js', 'api.js'));

describe('escapeHtml', () => {
  test('escapes all HTML-significant characters', () => {
    expect(ui.escapeHtml('<img src=x onerror="alert(\'x\')">&`'))
      .toBe('&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;&#96;');
  });
  test('handles null, undefined and numbers', () => {
    expect(ui.escapeHtml(null)).toBe('');
    expect(ui.escapeHtml(undefined)).toBe('');
    expect(ui.escapeHtml(0)).toBe('0');
    expect(ui.escapeHtml(42.5)).toBe('42.5');
  });
});

describe('enum labels and badges', () => {
  test('order status labels follow SPEC §1', () => {
    expect(ui.ORDER_STATUS_LABELS).toEqual({ new: 'New', in_transit: 'In Transit', delivered: 'Delivered', cancelled: 'Cancelled' });
  });
  test('order type, vehicle status and role labels', () => {
    expect(ui.label(ui.ORDER_TYPE_LABELS, 'transfer')).toBe('Transfer');
    expect(ui.label(ui.VEHICLE_STATUS_LABELS, 'on_trip')).toBe('On Trip');
    expect(ui.label(ui.ROLE_LABELS, 'dispatcher')).toBe('Dispatcher');
  });
  test('label falls back to code or dash', () => {
    expect(ui.label(ui.ORDER_STATUS_LABELS, 'weird')).toBe('weird');
    expect(ui.label(ui.ORDER_STATUS_LABELS, null)).toBe('—');
    expect(ui.label(ui.ORDER_STATUS_LABELS, 'toString')).toBe('toString');
  });
  test('every enum value has a badge class', () => {
    Object.keys(ui.ORDER_STATUS_LABELS).forEach((k) => expect(ui.ORDER_STATUS_BADGES[k]).toBeTruthy());
    Object.keys(ui.VEHICLE_STATUS_LABELS).forEach((k) => expect(ui.VEHICLE_STATUS_BADGES[k]).toBeTruthy());
    Object.keys(ui.ORDER_TYPE_LABELS).forEach((k) => expect(ui.ORDER_TYPE_BADGES[k]).toBeTruthy());
  });
  test('statusBadge renders escaped markup', () => {
    expect(ui.statusBadge('in_transit')).toBe('<span class="badge-status badge-transit">In Transit</span>');
    expect(ui.statusBadge('<b>')).toContain('&lt;b&gt;');
  });
});

describe('status transitions', () => {
  test('allowed transitions per SPEC §1', () => {
    expect(ui.allowedTransitions('new')).toEqual(['in_transit', 'cancelled']);
    expect(ui.allowedTransitions('in_transit')).toEqual(['delivered', 'cancelled']);
    expect(ui.allowedTransitions('delivered')).toEqual([]);
    expect(ui.allowedTransitions('cancelled')).toEqual([]);
    expect(ui.allowedTransitions('bogus')).toEqual([]);
  });
  test('canTransition', () => {
    expect(ui.canTransition('new', 'in_transit')).toBe(true);
    expect(ui.canTransition('new', 'delivered')).toBe(false);
    expect(ui.canTransition('delivered', 'cancelled')).toBe(false);
  });
  test('returned arrays are copies', () => {
    ui.allowedTransitions('new').push('delivered');
    expect(ui.allowedTransitions('new')).toEqual(['in_transit', 'cancelled']);
  });
  test('isOrderLocked (BR4)', () => {
    expect(ui.isOrderLocked('in_transit')).toBe(true);
    expect(ui.isOrderLocked('delivered')).toBe(true);
    expect(ui.isOrderLocked('new')).toBe(false);
    expect(ui.isOrderLocked('cancelled')).toBe(false);
  });
});

describe('hasRole', () => {
  test('role hierarchy viewer < dispatcher < admin', () => {
    expect(ui.hasRole('admin', 'dispatcher')).toBe(true);
    expect(ui.hasRole('dispatcher', 'dispatcher')).toBe(true);
    expect(ui.hasRole('viewer', 'dispatcher')).toBe(false);
    expect(ui.hasRole('dispatcher', 'admin')).toBe(false);
    expect(ui.hasRole('viewer', '')).toBe(true);
    expect(ui.hasRole(undefined, 'viewer')).toBe(false);
  });
});

describe('formatters', () => {
  test('formatDate keeps calendar dates without timezone shift', () => {
    expect(ui.formatDate('2026-10-31')).toBe('31 Oct 2026');
    expect(ui.formatDate('2026-01-05T00:00:00.000Z')).toBe('05 Jan 2026');
    expect(ui.formatDate(new Date(2026, 2, 7, 23, 59))).toBe('07 Mar 2026');
    expect(ui.formatDate(null)).toBe('—');
    expect(ui.formatDate('not a date')).toBe('—');
  });
  test('formatDateTime uses local time', () => {
    expect(ui.formatDateTime(new Date(2026, 9, 31, 14, 5))).toBe('31 Oct 2026, 14:05');
    expect(ui.formatDateTime('2026-10-31T08:30:00')).toBe('31 Oct 2026, 08:30');
    expect(ui.formatDateTime('2026-10-31 08:30:00')).toBe('31 Oct 2026, 08:30');
    expect(ui.formatDateTime('')).toBe('—');
  });
  test('formatTime', () => {
    expect(ui.formatTime('2026-10-31T07:05:00')).toBe('07:05');
  });
  test('formatWeight', () => {
    expect(ui.formatWeight(1234)).toBe('1,234 kg');
    expect(ui.formatWeight('1500.50')).toBe('1,500.5 kg');
    expect(ui.formatWeight(0)).toBe('0 kg');
    expect(ui.formatWeight(null)).toBe('—');
  });
  test('formatNumber', () => {
    expect(ui.formatNumber(1234567)).toBe('1,234,567');
    expect(ui.formatNumber(12.345, 2)).toBe('12.35');
    expect(ui.formatNumber('x')).toBe('—');
  });
  test('formatPercent', () => {
    expect(ui.formatPercent(0.875)).toBe('87.5%');
    expect(ui.formatPercent(1)).toBe('100.0%');
    expect(ui.formatPercent(0.33333, 0)).toBe('33%');
    expect(ui.formatPercent(null)).toBe('—');
  });
  test('formatHours', () => {
    expect(ui.formatHours(5.25)).toBe('5.3 h');
    expect(ui.formatHours(72)).toBe('3.0 d');
    expect(ui.formatHours(null)).toBe('—');
  });
  test('date input helpers', () => {
    expect(ui.toDateInput('2026-10-31')).toBe('2026-10-31');
    expect(ui.toDateInput('2026-10-31T00:00:00.000Z')).toBe('2026-10-31');
    expect(ui.toDateInput(null)).toBe('');
    expect(ui.toDateTimeLocal('2026-10-31T08:30:00')).toBe('2026-10-31T08:30');
    expect(ui.fromDateTimeLocal('2026-10-31T08:30')).toBe(new Date(2026, 9, 31, 8, 30).toISOString());
    expect(ui.fromDateTimeLocal('garbage')).toBeNull();
    expect(ui.fromDateTimeLocal('')).toBeNull();
    expect(ui.todayIso(new Date(2026, 0, 2))).toBe('2026-01-02');
  });
});

describe('pagination', () => {
  test('totalPages', () => {
    expect(ui.totalPages(0, 20)).toBe(1);
    expect(ui.totalPages(20, 20)).toBe(1);
    expect(ui.totalPages(21, 20)).toBe(2);
  });
  test('pageList shows all pages when few', () => {
    expect(ui.pageList(1, 1)).toEqual([1]);
    expect(ui.pageList(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  test('pageList with ellipses', () => {
    expect(ui.pageList(1, 10)).toEqual([1, 2, 3, 4, 5, '…', 10]);
    expect(ui.pageList(4, 10)).toEqual([1, 2, 3, 4, 5, '…', 10]);
    expect(ui.pageList(5, 10)).toEqual([1, '…', 4, 5, 6, '…', 10]);
    expect(ui.pageList(7, 10)).toEqual([1, '…', 6, 7, 8, 9, 10]);
    expect(ui.pageList(10, 10)).toEqual([1, '…', 6, 7, 8, 9, 10]);
  });
  test('pageList clamps out-of-range current page', () => {
    expect(ui.pageList(99, 10)).toEqual([1, '…', 6, 7, 8, 9, 10]);
    expect(ui.pageList(0, 3)).toEqual([1, 2, 3]);
  });
  test('rangeText', () => {
    expect(ui.rangeText(2, 20, 95)).toBe('Showing 21–40 of 95');
    expect(ui.rangeText(5, 20, 95)).toBe('Showing 81–95 of 95');
    expect(ui.rangeText(1, 20, 0)).toBe('No results');
  });
});

describe('debounce', () => {
  test('calls once after the wait with the latest args', () => {
    jest.useFakeTimers();
    const fn = jest.fn();
    const d = ui.debounce(fn, 100);
    d(1); d(2); d(3);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
    jest.useRealTimers();
  });
});

describe('DESIGN §3 status colour mapping', () => {
  test('cancelled is muted grey, new neutral, in transit blue, delivered green', () => {
    expect(ui.ORDER_STATUS_BADGES.cancelled).toContain('badge-cancelled');
    expect(ui.ORDER_STATUS_BADGES.new).toContain('badge-new');
    expect(ui.ORDER_STATUS_BADGES.in_transit).toContain('badge-transit');
    expect(ui.ORDER_STATUS_BADGES.delivered).toContain('badge-delivered');
  });
  test('vehicles: on trip blue, available green, maintenance amber', () => {
    expect(ui.VEHICLE_STATUS_BADGES.on_trip).toContain('badge-transit');
    expect(ui.VEHICLE_STATUS_BADGES.available).toContain('badge-delivered');
    expect(ui.VEHICLE_STATUS_BADGES.maintenance).toContain('badge-maintenance');
  });
});

describe('KPI helpers', () => {
  const days = (counts) => counts.map((count, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, count }));
  test('weekDelta compares last 7 days with the previous 7', () => {
    const r = ui.weekDelta(days([1, 1, 1, 1, 1, 1, 4, 2, 2, 2, 2, 2, 2, 2]));
    expect(r).toEqual({ current: 14, previous: 10, change: 0.4 });
  });
  test('weekDelta returns null change when previous week is empty', () => {
    expect(ui.weekDelta(days([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2]))).toEqual({ current: 3, previous: 0, change: null });
    expect(ui.weekDelta(null)).toEqual({ current: 0, previous: 0, change: null });
  });
  test('formatDelta colours by meaning, not direction', () => {
    expect(ui.formatDelta(0.042, true)).toEqual({ text: '▲ 4.2%', tone: 'good' });
    expect(ui.formatDelta(-0.1, true)).toEqual({ text: '▼ 10.0%', tone: 'bad' });
    expect(ui.formatDelta(-0.1, false)).toEqual({ text: '▼ 10.0%', tone: 'good' });
    expect(ui.formatDelta(0, true)).toEqual({ text: '0.0%', tone: 'neutral' });
    expect(ui.formatDelta(null, true)).toEqual({ text: '—', tone: 'neutral' });
  });
  test('sparklinePath scales values into the box', () => {
    expect(ui.sparklinePath([0, 5, 10], 102, 12)).toBe('M1 11 L51 6 L101 1');
    expect(ui.sparklinePath([3, 3], 10, 8)).toBe('M1 4 L9 4');
    expect(ui.sparklinePath([], 10, 8)).toBe('');
  });
});

describe('icon', () => {
  test('renders an escaped Lucide placeholder', () => {
    expect(ui.icon('truck')).toBe('<i data-lucide="truck" aria-hidden="true"></i>');
    expect(ui.icon('x"y', 'icon-20')).toBe('<i data-lucide="x&quot;y" class="icon-20" aria-hidden="true"></i>');
  });
});

describe('api.buildUrl', () => {
  test('prefixes /api and encodes params, skipping empty values', () => {
    expect(api.buildUrl('/orders')).toBe('/api/orders');
    expect(api.buildUrl('orders', { page: 2, q: 'a&b c', status: '', vehicleId: null }))
      .toBe('/api/orders?page=2&q=a%26b+c');
  });
});
