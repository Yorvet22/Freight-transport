/**
 * Theme-aware Chart.js helpers (window.FT.charts).
 * Colours come from CSS custom properties so charts match status pills and theme (DESIGN §3).
 */
(function (root) {
  'use strict';

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function palette() {
    return {
      text: cssVar('--bs-body-color'),
      muted: cssVar('--bs-secondary-color'),
      grid: cssVar('--bs-border-color'),
      surface: cssVar('--ff-surface'),
      primary: cssVar('--bs-primary'),
      new: cssVar('--ft-chart-new'),
      in_transit: cssVar('--ft-chart-transit'),
      delivered: cssVar('--ft-chart-delivered'),
      cancelled: cssVar('--ft-chart-cancelled'),
      secondary: cssVar('--ft-chart-secondary'),
    };
  }

  function applyDefaults() {
    if (!root.Chart) return;
    const p = palette();
    const C = root.Chart;
    C.defaults.font.family = getComputedStyle(document.body).fontFamily;
    C.defaults.font.size = 12;
    C.defaults.color = p.muted;
    C.defaults.borderColor = p.grid;
    C.defaults.maintainAspectRatio = false;
    const legend = C.defaults.plugins.legend;
    legend.position = 'top';
    legend.align = 'start';
    legend.labels.usePointStyle = true;
    legend.labels.pointStyle = 'circle';
    legend.labels.boxWidth = 8;
    legend.labels.boxHeight = 8;
    legend.labels.color = p.text;
    const tip = C.defaults.plugins.tooltip;
    tip.backgroundColor = p.surface;
    tip.titleColor = p.text;
    tip.bodyColor = p.text;
    tip.borderColor = p.grid;
    tip.borderWidth = 1;
    tip.padding = 8;
    tip.cornerRadius = 6;
    tip.boxPadding = 4;
    tip.usePointStyle = true;
  }

  /** '#2563eb' + 0.12 → 'rgba(37,99,235,0.12)' (canvas-safe). */
  function alpha(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /** Thin border-coloured gridlines, no axis borders. */
  function axes(p, opts) {
    const o = opts || {};
    const valueAxis = { beginAtZero: true, ticks: { precision: 0 }, grid: { color: p.grid, lineWidth: 1 }, border: { display: false } };
    const catAxis = { grid: { display: false }, border: { display: false } };
    return o.horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis };
  }

  /** Keeps track of charts by key; destroys the previous instance on re-render. */
  const instances = {};
  function render(key, canvas, config) {
    if (!root.Chart || !canvas) return null;
    if (instances[key]) instances[key].destroy();
    instances[key] = new root.Chart(canvas, config);
    return instances[key];
  }

  root.FT = root.FT || {};
  root.FT.charts = { palette, applyDefaults, render, alpha, axes };
})(window);
