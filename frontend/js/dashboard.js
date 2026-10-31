/** Dashboard page: KPIs, charts and recent orders from GET /api/dashboard/kpis (SPEC §6, DESIGN §3). */
(function () {
  'use strict';

  const { api, ui, charts, layout } = window.FT;
  const STATUSES = ['new', 'in_transit', 'delivered', 'cancelled'];
  let data = null;

  const kpi = (key) => document.querySelector(`[data-kpi="${key}"]`);
  const setKpi = (key, text) => { const n = kpi(key); if (n) n.textContent = text; };

  function renderKpis(d) {
    const o = d.orders || {};
    const v = d.vehicles || {};

    // Only this KPI has a delta: last 7 days vs previous 7, from ordersPerDay.
    const week = ui.weekDelta(d.ordersPerDay);
    setKpi('week', ui.formatNumber(week.current));
    const deltaEl = kpi('weekDelta');
    if (week.change === null) {
      deltaEl.className = 'kpi-delta';
      deltaEl.textContent = week.previous === 0 && week.current > 0 ? 'No orders in previous 7 days' : 'vs previous 7 days';
    } else {
      const delta = ui.formatDelta(week.change, true);
      deltaEl.className = `kpi-delta ${delta.tone}`;
      deltaEl.innerHTML = `${ui.escapeHtml(delta.text)} <span class="note">vs previous 7 days</span>`;
    }
    const counts = (d.ordersPerDay || []).map((r) => r.count);
    const path = ui.sparklinePath(counts, 200, 28);
    kpi('spark').innerHTML = path ? `<path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>` : '';

    setKpi('onTimeRate', ui.formatPercent(d.onTimeRate));
    setKpi('fleetUtilization', ui.formatPercent(d.fleetUtilization));
    setKpi('fleetSub', `${v.on_trip || 0} on trip of ${Math.max(0, (v.total || 0) - (v.maintenance || 0))} in service`);
    setKpi('avgTransitHours', ui.formatHours(d.avgTransitHours));
    setKpi('active', ui.formatNumber((o.new || 0) + (o.in_transit || 0)));
    setKpi('activeSub', `${o.new || 0} new · ${o.in_transit || 0} in transit`);
    setKpi('totalOrders', `${ui.formatNumber(o.total || 0)} orders in total`);
  }

  function renderCharts(d) {
    charts.applyDefaults();
    const p = charts.palette();
    const o = d.orders || {};

    charts.render('status', document.getElementById('statusChart'), {
      type: 'doughnut',
      data: {
        labels: STATUSES.map((s) => ui.ORDER_STATUS_LABELS[s]),
        datasets: [{
          data: STATUSES.map((s) => o[s] || 0),
          backgroundColor: STATUSES.map((s) => p[s]),
          borderColor: p.surface,
          borderWidth: 2,
        }],
      },
      options: { cutout: '70%' },
    });

    const perDay = d.ordersPerDay || [];
    charts.render('perDay', document.getElementById('ordersPerDayChart'), {
      type: 'line',
      data: {
        labels: perDay.map((r) => ui.formatDate(r.date).slice(0, 6)),
        datasets: [{
          label: 'Orders',
          data: perDay.map((r) => r.count),
          borderColor: p.primary,
          backgroundColor: charts.alpha(p.primary, 0.08),
          fill: true,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: p.primary,
        }],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } },
        scales: charts.axes(p),
      },
    });

    const wh = d.warehouses || [];
    charts.render('warehouses', document.getElementById('warehouseChart'), {
      type: 'bar',
      data: {
        labels: wh.map((w) => w.code || w.name),
        datasets: [
          { label: 'Inbound', data: wh.map((w) => w.inbound || 0), backgroundColor: p.primary, borderRadius: 3, barPercentage: 0.7, categoryPercentage: 0.7 },
          { label: 'Outbound', data: wh.map((w) => w.outbound || 0), backgroundColor: p.secondary, borderRadius: 3, barPercentage: 0.7, categoryPercentage: 0.7 },
        ],
      },
      options: {
        indexAxis: 'y',
        interaction: { mode: 'index', intersect: false, axis: 'y' },
        plugins: {
          tooltip: { callbacks: { title: (items) => { const w = wh[items[0].dataIndex]; return w ? `${w.code} · ${w.name}` : ''; } } },
        },
        scales: charts.axes(p, { horizontal: true }),
      },
    });
  }

  function renderRecent(list) {
    const tbody = document.getElementById('recentOrders');
    if (!list || !list.length) {
      tbody.innerHTML = ui.emptyRow(5, 'No orders yet', 'Create the first order to see it here.', 'package');
      return;
    }
    tbody.innerHTML = list.map((o) => `
      <tr class="clickable" data-id="${ui.escapeHtml(o.id)}">
        <td><div class="mono">${ui.escapeHtml(o.orderNumber)}</div><div class="cell-sub">${ui.escapeHtml(ui.label(ui.ORDER_TYPE_LABELS, o.type))}</div></td>
        <td>${ui.escapeHtml(o.clientName)}</td>
        <td class="hide-xs small"><span class="route"><span>${ui.escapeHtml(o.originWarehouseName || o.pickupAddress || '—')}</span><span class="sep">→</span><span>${ui.escapeHtml(o.destinationWarehouseName || o.deliveryAddress || '—')}</span></span></td>
        <td>${ui.statusBadge(o.status)}</td>
        <td class="hide-xs small text-body-secondary text-nowrap text-end">${ui.escapeHtml(ui.formatDate(o.createdAt))}</td>
      </tr>`).join('');
  }

  async function load() {
    document.getElementById('recentOrders').innerHTML = ui.skeletonRows(5, 5);
    try {
      data = await api.get('/dashboard/kpis');
      renderKpis(data);
      renderCharts(data);
      renderRecent(data.recentOrders);
    } catch (err) {
      ui.toastError(err);
      document.getElementById('recentOrders').innerHTML = ui.emptyRow(5, 'Could not load dashboard', ui.errorMessage(err), 'triangle-alert');
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="refresh"]')) load();
    const row = e.target.closest('#recentOrders tr[data-id]');
    if (row) location.href = `/orders.html?${new URLSearchParams({ open: row.dataset.id })}`;
  });
  document.addEventListener('ft:themechange', () => { if (data) renderCharts(data); });

  layout.ready.then(load).catch(() => {});
})();
