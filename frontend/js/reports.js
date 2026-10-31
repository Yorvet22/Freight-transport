/** Reports page: GET /api/reports/summary (SPEC §6) with PDF (jsPDF + autotable) and Excel export. */
(function () {
  'use strict';

  const { api, ui, layout } = window.FT;
  const $ = (id) => document.getElementById(id);
  const esc = ui.escapeHtml;
  let report = null;
  let whNames = {};
  let vehNames = {};

  function filters() {
    const f = $('filters');
    return { from: f.from.value, to: f.to.value, warehouseId: f.warehouseId.value, vehicleId: f.vehicleId.value };
  }

  function setRange(days) {
    const f = $('filters');
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (days - 1));
    f.from.value = ui.toDateInput(from);
    f.to.value = ui.toDateInput(to);
  }

  async function loadLookups() {
    const f = $('filters');
    const [w, v] = await Promise.all([
      api.getAll('/warehouses', { sort: 'code', dir: 'asc' }).catch(() => []),
      api.getAll('/vehicles', { sort: 'licensePlate', dir: 'asc' }).catch(() => []),
    ]);
    whNames = Object.fromEntries(w.map((x) => [String(x.id), `${x.code} · ${x.name}`]));
    vehNames = Object.fromEntries(v.map((x) => [String(x.id), `${x.licensePlate} · ${x.driverName || x.model}`]));
    ui.fillSelect(f.warehouseId, w.map((x) => ({ value: x.id, label: whNames[String(x.id)] })), { placeholder: 'All warehouses' });
    ui.fillSelect(f.vehicleId, v.map((x) => ({ value: x.id, label: vehNames[String(x.id)] })), { placeholder: 'All vehicles' });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function setTotal(key, text) {
    const n = document.querySelector(`[data-total="${key}"]`);
    if (n) n.textContent = text;
  }

  function renderTotals(t) {
    setTotal('orders', ui.formatNumber(t.orders || 0));
    setTotal('delivered', ui.formatNumber(t.delivered || 0));
    setTotal('inTransit', ui.formatNumber(t.inTransit || 0));
    setTotal('newCancelled', `${ui.formatNumber(t.new || 0)} / ${ui.formatNumber(t.cancelled || 0)}`);
    setTotal('totalWeight', ui.formatWeight(t.totalWeight || 0));
    setTotal('deliveryRate', ui.formatPercent(t.deliveryRate));
  }

  function renderTables(r) {
    const wh = r.byWarehouse || [];
    $('byWarehouse').innerHTML = wh.length ? wh.map((w) => `
      <tr>
        <td><span class="mono fw-semibold">${esc(w.code)}</span> <span class="text-body-secondary">${esc(w.name)}</span></td>
        <td class="text-end">${esc(ui.formatNumber(w.inbound))}</td>
        <td class="text-end">${esc(ui.formatNumber(w.outbound))}</td>
        <td class="text-end text-nowrap">${esc(ui.formatWeight(w.weight))}</td>
      </tr>`).join('') : ui.emptyRow(4, 'No warehouse activity', 'No orders touched a warehouse in this period.', 'warehouse');

    const vh = r.byVehicle || [];
    $('byVehicle').innerHTML = vh.length ? vh.map((v) => `
      <tr>
        <td><span class="mono fw-semibold">${esc(v.licensePlate)}</span><div class="cell-sub">${esc(v.driverName || '')}</div></td>
        <td class="text-end">${esc(ui.formatNumber(v.trips))}</td>
        <td class="text-end">${esc(ui.formatNumber(v.delivered))}</td>
        <td class="text-end text-nowrap">${esc(ui.formatWeight(v.weight))}</td>
      </tr>`).join('') : ui.emptyRow(4, 'No vehicle activity', 'No orders were assigned to vehicles in this period.', 'truck');

    const orders = r.orders || [];
    $('ordersCaption').textContent = `${ui.formatNumber(orders.length)} orders`;
    $('reportOrders').innerHTML = orders.length ? orders.map((o) => `
      <tr>
        <td><a class="mono fw-semibold" href="/orders.html?${new URLSearchParams({ open: o.id })}">${esc(o.orderNumber)}</a><div class="cell-sub">${esc(ui.label(ui.ORDER_TYPE_LABELS, o.type))}</div></td>
        <td>${esc(o.clientName)}</td>
        <td class="hide-xs small"><span class="route"><span>${esc(o.originWarehouseName || o.pickupAddress || '—')}</span><span class="sep">→</span><span>${esc(o.destinationWarehouseName || o.deliveryAddress || '—')}</span></span></td>
        <td class="text-end text-nowrap">${esc(ui.formatWeight(o.cargoWeight))}</td>
        <td>${ui.statusBadge(o.status)}</td>
        <td class="hide-xs small text-body-secondary text-nowrap">${esc(ui.formatDate(o.createdAt))}</td>
      </tr>`).join('') : ui.emptyRow(6, 'No orders in this period', 'Adjust the date range or filters.', 'calendar-x');
  }

  async function load() {
    const f = filters();
    if (f.from && f.to && f.from > f.to) { ui.toast('"From" date must be before "To" date.', 'warning'); return; }
    ['byWarehouse', 'byVehicle'].forEach((id) => { $(id).innerHTML = ui.skeletonRows(4, 4); });
    $('reportOrders').innerHTML = ui.skeletonRows(6, 6);
    try {
      report = await api.get('/reports/summary', f);
      renderTotals(report.totals || {});
      renderTables(report);
    } catch (err) {
      report = null;
      ui.toastError(err);
      const fail = (cols) => ui.emptyRow(cols, 'Could not load report', ui.errorMessage(err), 'triangle-alert');
      $('byWarehouse').innerHTML = fail(4);
      $('byVehicle').innerHTML = fail(4);
      $('reportOrders').innerHTML = fail(6);
    }
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  function filterSummary() {
    const f = filters();
    return [
      `Period: ${f.from ? ui.formatDate(f.from) : 'start'} – ${f.to ? ui.formatDate(f.to) : 'today'}`,
      `Warehouse: ${f.warehouseId ? whNames[f.warehouseId] || f.warehouseId : 'All'}`,
      `Vehicle: ${f.vehicleId ? vehNames[f.vehicleId] || f.vehicleId : 'All'}`,
    ];
  }

  function totalsRows(t) {
    return [
      ['Orders', ui.formatNumber(t.orders || 0)],
      ['Delivered', ui.formatNumber(t.delivered || 0)],
      ['In transit', ui.formatNumber(t.inTransit || 0)],
      ['New', ui.formatNumber(t.new || 0)],
      ['Cancelled', ui.formatNumber(t.cancelled || 0)],
      ['Total weight', ui.formatWeight(t.totalWeight || 0)],
      ['Delivery rate', ui.formatPercent(t.deliveryRate)],
    ];
  }

  /** Standard PDF fonts are Latin-1 only: map typographic characters to ASCII. */
  const pdfText = (v) => String(v === null || v === undefined ? '' : v).replace(/[–—]/g, '-').replace(/·/g, '|').replace(/…/g, '...');
  const pdfRows = (rows) => rows.map((r) => r.map(pdfText));

  function exportPdf() {
    if (!report) { ui.toast('Load a report first.', 'info'); return; }
    if (!window.jspdf || !window.jspdf.jsPDF) { ui.toast('PDF library failed to load.', 'danger'); return; }
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    if (typeof doc.autoTable !== 'function') { ui.toast('PDF table plugin failed to load.', 'danger'); return; }
    const head = { fillColor: [42, 111, 214], textColor: 255, fontStyle: 'bold' };
    const styles = { fontSize: 8, cellPadding: 4 };
    const left = 40;

    doc.setFontSize(18);
    doc.text('FreightFlow - Transport report', left, 48);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text([...filterSummary(), `Generated: ${ui.formatDateTime(new Date())}`].map(pdfText), left, 66);
    doc.setTextColor(0);

    doc.autoTable({ startY: 120, head: [['Metric', 'Value']], body: pdfRows(totalsRows(report.totals || {})), theme: 'grid', headStyles: head, styles, tableWidth: 260, margin: { left } });
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 20,
      head: [['Warehouse', 'Inbound', 'Outbound', 'Weight']],
      body: pdfRows((report.byWarehouse || []).map((w) => [`${w.code} | ${w.name}`, w.inbound, w.outbound, ui.formatWeight(w.weight)])),
      theme: 'striped', headStyles: head, styles, margin: { left },
    });
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 20,
      head: [['Vehicle', 'Driver', 'Trips', 'Delivered', 'Weight']],
      body: pdfRows((report.byVehicle || []).map((v) => [v.licensePlate, v.driverName || '', v.trips, v.delivered, ui.formatWeight(v.weight)])),
      theme: 'striped', headStyles: head, styles, margin: { left },
    });
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 20,
      head: [['Order #', 'Type', 'Client', 'From', 'To', 'Weight', 'Status', 'Vehicle', 'Created', 'Delivered']],
      body: pdfRows((report.orders || []).map((o) => [
        o.orderNumber, ui.label(ui.ORDER_TYPE_LABELS, o.type), o.clientName,
        o.originWarehouseName || o.pickupAddress || '', o.destinationWarehouseName || o.deliveryAddress || '',
        ui.formatWeight(o.cargoWeight), ui.label(ui.ORDER_STATUS_LABELS, o.status), o.truckPlate || '',
        ui.formatDate(o.createdAt), o.deliveredAt ? ui.formatDate(o.deliveredAt) : '',
      ])),
      theme: 'striped', headStyles: head, styles: { fontSize: 7, cellPadding: 3 }, margin: { left },
    });

    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i += 1) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(`Page ${i} of ${pages}`, doc.internal.pageSize.getWidth() - 90, doc.internal.pageSize.getHeight() - 20);
    }
    doc.save(`freight-report-${ui.todayIso()}.pdf`);
  }

  function exportExcel() {
    if (!report) { ui.toast('Load a report first.', 'info'); return; }
    const summary = filterSummary().map((line) => { const [k, ...rest] = line.split(': '); return { Metric: k, Value: rest.join(': ') }; })
      .concat(totalsRows(report.totals || {}).map(([Metric, Value]) => ({ Metric, Value })));
    window.FT.export.writeWorkbook(`freight-report-${ui.todayIso()}.xlsx`, [
      { name: 'Summary', rows: summary },
      { name: 'By warehouse', rows: (report.byWarehouse || []).map((w) => ({ Code: w.code, Name: w.name, Inbound: w.inbound, Outbound: w.outbound, 'Weight (kg)': Number(w.weight || 0) })) },
      { name: 'By vehicle', rows: (report.byVehicle || []).map((v) => ({ Plate: v.licensePlate, Driver: v.driverName || '', Trips: v.trips, Delivered: v.delivered, 'Weight (kg)': Number(v.weight || 0) })) },
      { name: 'Orders', rows: (report.orders || []).map(window.FT.export.orderRow) },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  async function init() {
    setRange(30);
    $('filters').addEventListener('submit', (e) => { e.preventDefault(); load(); });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('#app [data-action]');
      if (!a) return;
      if (a.dataset.action === 'range') { setRange(Number(a.dataset.days)); load(); }
      if (a.dataset.action === 'pdf') exportPdf();
      if (a.dataset.action === 'excel') exportExcel();
    });
    await loadLookups();
    load();
  }

  layout.ready.then(init).catch(() => {});
})();
