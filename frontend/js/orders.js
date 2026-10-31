/**
 * Orders page: server-side list, create/edit modal, detail drawer with
 * status timeline, status transitions and proof-of-delivery (SPEC §3, §5).
 */
(function () {
  'use strict';

  const { api, ui, layout } = window.FT;
  const $ = (id) => document.getElementById(id);
  const esc = ui.escapeHtml;

  const state = {
    page: 1, limit: 20, sort: 'createdAt', dir: 'desc',
    q: '', status: '', type: '', warehouseId: '', direction: 'any', vehicleId: '',
  };
  let warehouses = [];
  let vehicles = [];
  let items = [];
  let editing = null;      // order being edited (full shape) or null
  let current = null;      // order shown in the drawer
  let loadSeq = 0;

  const orderModal = () => bootstrap.Modal.getOrCreateInstance($('orderModal'));
  const podModal = () => bootstrap.Modal.getOrCreateInstance($('podModal'));
  const drawer = () => bootstrap.Offcanvas.getOrCreateInstance($('orderDrawer'));
  const canWrite = () => layout.can('dispatcher');

  // ---------------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------------
  const whById = (id) => warehouses.find((w) => String(w.id) === String(id));
  const vehById = (id) => vehicles.find((v) => String(v.id) === String(id));
  const whLabel = (w) => `${w.code} · ${w.name}${w.isActive === false ? ' (inactive)' : ''}`;
  const vehLabel = (v) => `${v.licensePlate} · ${v.model}${v.driverName ? ` — ${v.driverName}` : ''}`;

  async function loadLookups() {
    const [w, v] = await Promise.all([
      api.getAll('/warehouses', { sort: 'code', dir: 'asc' }).catch(() => []),
      api.getAll('/vehicles', { sort: 'licensePlate', dir: 'asc' }).catch(() => []),
    ]);
    warehouses = w;
    vehicles = v;
    const f = $('filters');
    ui.fillSelect(f.warehouseId, warehouses.map((x) => ({ value: x.id, label: whLabel(x) })), { placeholder: 'All warehouses', keepValue: true });
    ui.fillSelect(f.vehicleId, vehicles.map((x) => ({ value: x.id, label: `${x.licensePlate} · ${x.driverName || x.model}` })), { placeholder: 'All vehicles', keepValue: true });
  }

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------
  function queryParams() {
    return {
      sort: state.sort, dir: state.dir, q: state.q, status: state.status, type: state.type,
      vehicleId: state.vehicleId, warehouseId: state.warehouseId,
      direction: state.warehouseId ? state.direction : '',
    };
  }

  function routeCell(o) {
    const from = o.originWarehouseName || o.pickupAddress || '—';
    const to = o.destinationWarehouseName || o.deliveryAddress || '—';
    return `<div class="route small"><span>${esc(from)}</span><span class="sep">→</span><span>${esc(to)}</span></div>`;
  }

  function rowActions(o) {
    const locked = ui.isOrderLocked(o.status);
    const parts = [`<button type="button" class="btn btn-icon btn-icon-sm" data-action="view" data-id="${esc(o.id)}" title="Details" aria-label="View order ${esc(o.orderNumber)}">${ui.icon('eye')}</button>`];
    if (canWrite() && !locked) {
      parts.push(`<button type="button" class="btn btn-icon btn-icon-sm" data-action="edit" data-id="${esc(o.id)}" title="Edit" aria-label="Edit order ${esc(o.orderNumber)}">${ui.icon('pencil')}</button>`);
      parts.push(`<button type="button" class="btn btn-icon btn-icon-sm danger" data-action="delete" data-id="${esc(o.id)}" title="Delete" aria-label="Delete order ${esc(o.orderNumber)}">${ui.icon('trash-2')}</button>`);
    }
    return parts.join('');
  }

  function renderRows() {
    const tbody = $('ordersBody');
    if (!items.length) {
      const filtered = state.q || state.status || state.type || state.warehouseId || state.vehicleId;
      tbody.innerHTML = ui.emptyRow(9, filtered ? 'No orders match your filters' : 'No orders yet',
        filtered ? 'Try clearing the search or filters.' : 'Create the first order to get started.', 'package');
      return;
    }
    tbody.innerHTML = items.map((o) => `
      <tr class="clickable" data-action="view" data-id="${esc(o.id)}">
        <td><div class="cell-main mono">${esc(o.orderNumber)}</div><div>${ui.typeBadge(o.type)}</div></td>
        <td><div class="fw-medium">${esc(o.clientName)}</div><div class="cell-sub text-truncate" style="max-width:220px">${esc(o.cargoDescription)}</div>
          <div class="cell-sub text-truncate d-xl-none hide-xs" style="max-width:240px">${esc(o.originWarehouseName || o.pickupAddress || '—')} → ${esc(o.destinationWarehouseName || o.deliveryAddress || '—')}</div></td>
        <td class="hide-xs hide-lg">${routeCell(o)}</td>
        <td class="hide-xs hide-lg">${o.truckPlate ? `<div class="meta">${ui.icon('truck')}<span class="mono text-body">${esc(o.truckPlate)}</span></div><div class="cell-sub">${esc(o.driverName || '')}</div>` : '<span class="text-body-secondary small">Unassigned</span>'}</td>
        <td class="text-end text-nowrap">${esc(ui.formatWeight(o.cargoWeight))}</td>
        <td class="hide-xs hide-lg text-nowrap small">${esc(ui.formatDate(o.plannedDeliveryDate))}</td>
        <td>${ui.statusBadge(o.status)}</td>
        <td class="hide-xs hide-lg text-nowrap small text-body-secondary">${esc(ui.formatDate(o.createdAt))}</td>
        <td class="actions">${rowActions(o)}</td>
      </tr>`).join('');
  }

  async function load() {
    const seq = ++loadSeq;
    const tbody = $('ordersBody');
    if (!items.length) tbody.innerHTML = ui.skeletonRows(9, 8);
    else tbody.style.opacity = '.55';
    ui.updateSortHeaders($('ordersTable'), state.sort, state.dir);
    try {
      const res = await api.get('/orders', Object.assign({ page: state.page, limit: state.limit }, queryParams()));
      if (seq !== loadSeq) return;
      items = res.items || [];
      const total = Number(res.total || 0);
      if (!items.length && total && state.page > 1) { state.page = ui.totalPages(total, state.limit); load(); return; }
      renderRows();
      ui.renderPagination($('pagination'), { page: state.page, limit: state.limit, total }, (p) => { state.page = p; load(); });
    } catch (err) {
      if (seq !== loadSeq) return;
      items = [];
      tbody.innerHTML = ui.emptyRow(9, 'Could not load orders', ui.errorMessage(err), 'triangle-alert');
    } finally {
      if (seq === loadSeq) tbody.style.opacity = '';
    }
  }

  // ---------------------------------------------------------------------------
  // Create / edit form
  // ---------------------------------------------------------------------------
  function fillFormSelects(order) {
    const f = $('orderForm');
    const keep = (w) => w.isActive !== false || (order && (String(order.originWarehouseId) === String(w.id) || String(order.destinationWarehouseId) === String(w.id)));
    const whOptions = warehouses.filter(keep).map((w) => ({ value: w.id, label: whLabel(w) }));
    ui.fillSelect(f.originWarehouseId, whOptions, { placeholder: '— None —' });
    ui.fillSelect(f.destinationWarehouseId, whOptions, { placeholder: '— None —' });
    const vehOptions = vehicles
      .filter((v) => v.status !== 'maintenance' || (order && String(order.vehicleId) === String(v.id)))
      .map((v) => ({ value: v.id, label: `${vehLabel(v)} [${ui.label(ui.VEHICLE_STATUS_LABELS, v.status)}]` }));
    ui.fillSelect(f.vehicleId, vehOptions, { placeholder: '— Unassigned —' });
  }

  function syncTypeHints() {
    const f = $('orderForm');
    const type = f.type.value;
    const needOrigin = type === 'outbound' || type === 'transfer';
    const needDest = type === 'inbound' || type === 'transfer';
    document.querySelector('[data-req="origin"]').classList.toggle('d-none', !needOrigin);
    document.querySelector('[data-req="destination"]').classList.toggle('d-none', !needDest);
    const hints = {
      inbound: 'Inbound: goods arrive at our destination warehouse. Pick a destination warehouse.',
      outbound: 'Outbound: goods leave our origin warehouse. Pick an origin warehouse.',
      transfer: 'Transfer: goods move between two different warehouses. Pick both.',
    };
    $('routeHint').textContent = hints[type] || '';
  }

  function autofillAddress(select, input) {
    const w = whById(select.value);
    if (w) input.value = [w.address, w.city].filter(Boolean).join(', ');
  }

  function openForm(order) {
    editing = order || null;
    const f = $('orderForm');
    f.reset();
    ui.clearFieldErrors(f);
    fillFormSelects(order);
    $('orderModalTitle').textContent = order ? `Edit order ${order.orderNumber}` : 'New order';
    if (order) {
      f.type.value = order.type || 'inbound';
      f.clientName.value = order.clientName || '';
      f.originWarehouseId.value = order.originWarehouseId || '';
      f.destinationWarehouseId.value = order.destinationWarehouseId || '';
      f.pickupAddress.value = order.pickupAddress || '';
      f.deliveryAddress.value = order.deliveryAddress || '';
      f.cargoDescription.value = order.cargoDescription || '';
      f.cargoWeight.value = order.cargoWeight !== null && order.cargoWeight !== undefined ? Number(order.cargoWeight) : '';
      f.vehicleId.value = order.vehicleId || '';
      f.plannedDeliveryDate.value = ui.toDateInput(order.plannedDeliveryDate);
      f.pickupWindowStart.value = ui.toDateTimeLocal(order.pickupWindowStart);
      f.pickupWindowEnd.value = ui.toDateTimeLocal(order.pickupWindowEnd);
      f.dockNumber.value = order.dockNumber || '';
    }
    // BR4: vehicle can only change while the order is new.
    const vehicleLocked = !!order && order.status !== 'new';
    f.vehicleId.disabled = vehicleLocked;
    $('vehicleHint').textContent = vehicleLocked ? 'The vehicle can only be changed while the order is New.' : 'Vehicles in maintenance are not listed.';
    syncTypeHints();
    orderModal().show();
  }

  const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const strOrNull = (v) => { const s = String(v || '').trim(); return s ? s : null; };

  function readForm() {
    const f = $('orderForm');
    return {
      type: f.type.value,
      clientName: f.clientName.value.trim(),
      originWarehouseId: numOrNull(f.originWarehouseId.value),
      destinationWarehouseId: numOrNull(f.destinationWarehouseId.value),
      pickupAddress: f.pickupAddress.value.trim(),
      deliveryAddress: f.deliveryAddress.value.trim(),
      cargoDescription: f.cargoDescription.value.trim(),
      cargoWeight: f.cargoWeight.value === '' ? null : Number(f.cargoWeight.value),
      vehicleId: f.vehicleId.disabled ? (editing ? editing.vehicleId : null) : numOrNull(f.vehicleId.value),
      plannedDeliveryDate: strOrNull(f.plannedDeliveryDate.value),
      pickupWindowStart: ui.fromDateTimeLocal(f.pickupWindowStart.value),
      pickupWindowEnd: ui.fromDateTimeLocal(f.pickupWindowEnd.value),
      dockNumber: strOrNull(f.dockNumber.value),
    };
  }

  /** Client-side mirror of the most common server validations (server stays authoritative). */
  function validate(d) {
    const errs = [];
    const req = (field, msg) => { if (!d[field]) errs.push({ field, message: msg }); };
    req('clientName', 'Client name is required.');
    req('pickupAddress', 'Pickup address is required.');
    req('deliveryAddress', 'Delivery address is required.');
    req('cargoDescription', 'Cargo description is required.');
    if (!(d.cargoWeight > 0 && d.cargoWeight <= 100000)) errs.push({ field: 'cargoWeight', message: 'Weight must be greater than 0 and at most 100,000 kg.' });
    if ((d.type === 'outbound' || d.type === 'transfer') && !d.originWarehouseId) errs.push({ field: 'originWarehouseId', message: 'Origin warehouse is required for this type.' });
    if ((d.type === 'inbound' || d.type === 'transfer') && !d.destinationWarehouseId) errs.push({ field: 'destinationWarehouseId', message: 'Destination warehouse is required for this type.' });
    if (d.type === 'transfer' && d.originWarehouseId && d.originWarehouseId === d.destinationWarehouseId) errs.push({ field: 'destinationWarehouseId', message: 'Origin and destination must differ.' });
    if (d.pickupWindowStart && d.pickupWindowEnd && d.pickupWindowEnd < d.pickupWindowStart) errs.push({ field: 'pickupWindowEnd', message: 'Window end must be after the start.' });
    return errs;
  }

  async function submitForm(e) {
    e.preventDefault();
    const f = $('orderForm');
    const data = readForm();
    const errs = validate(data);
    if (errs.length) { ui.showFieldErrors(f, { message: 'Please fix the highlighted fields.', details: errs }); return; }
    await ui.withBusy($('orderSaveBtn'), async () => {
      try {
        const saved = editing ? await api.put(`/orders/${encodeURIComponent(editing.id)}`, data) : await api.post('/orders', data);
        orderModal().hide();
        ui.toast(editing ? `Order ${editing.orderNumber} updated.` : `Order ${saved && saved.orderNumber ? saved.orderNumber : ''} created.`, 'success');
        if (!editing) { state.page = 1; }
        await load();
        if (current && editing && String(current.id) === String(editing.id)) openDrawer(current.id);
      } catch (err) {
        ui.showFieldErrors(f, err);
      }
    });
  }

  async function editOrder(id) {
    try {
      const order = await api.get(`/orders/${encodeURIComponent(id)}`);
      if (ui.isOrderLocked(order.status)) { ui.toast('Orders in transit or delivered cannot be edited.', 'warning'); return; }
      openForm(order);
    } catch (err) { ui.toastError(err); }
  }

  async function deleteOrder(id) {
    const o = items.find((x) => String(x.id) === String(id)) || current || {};
    const ok = await ui.confirm({ title: 'Delete order?', message: `Order ${o.orderNumber || ''} will be permanently removed. This cannot be undone.`, confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await api.del(`/orders/${encodeURIComponent(id)}`);
      ui.toast('Order deleted.', 'success');
      if (current && String(current.id) === String(id)) drawer().hide();
      load();
    } catch (err) { ui.toastError(err); }
  }

  // ---------------------------------------------------------------------------
  // Detail drawer
  // ---------------------------------------------------------------------------
  function detail(labelText, value, cls) {
    return `<div class="${cls || ''}"><div class="detail-label">${esc(labelText)}</div><div class="detail-value">${value}</div></div>`;
  }

  const TRANSITION_BUTTONS = {
    in_transit: { text: 'Dispatch', cls: 'btn-primary' },
    delivered: { text: 'Mark delivered', cls: 'btn-success' },
    cancelled: { text: 'Cancel order', cls: 'btn-outline-danger' },
  };

  function renderTimeline(history) {
    if (!history || !history.length) return '<p class="text-body-secondary small mb-0">No history recorded.</p>';
    return `<ul class="timeline">${history.map((h) => `
      <li>
        <span class="timeline-dot s-${esc(h.toStatus)}"></span>
        <div class="d-flex flex-wrap justify-content-between gap-2">
          <div class="fw-medium small">${h.fromStatus ? `${esc(ui.label(ui.ORDER_STATUS_LABELS, h.fromStatus))} <span class="text-body-secondary">→</span> ` : 'Created as '}${esc(ui.label(ui.ORDER_STATUS_LABELS, h.toStatus))}</div>
          <div class="xsmall text-body-secondary">${esc(ui.formatDateTime(h.changedAt))}</div>
        </div>
        <div class="xsmall text-body-secondary">${h.changedBy ? `by ${esc(h.changedBy)}` : ''}</div>
        ${h.note ? `<div class="timeline-note">${esc(h.note)}</div>` : ''}
      </li>`).join('')}</ul>`;
  }

  function renderDrawer(o, history) {
    $('drawerTitle').textContent = o.orderNumber || 'Order';
    $('drawerBadges').innerHTML = `${ui.statusBadge(o.status)} ${ui.typeBadge(o.type)}`;
    const transitions = canWrite() ? ui.allowedTransitions(o.status) : [];
    const locked = ui.isOrderLocked(o.status);
    const actions = transitions.map((t) => {
      const b = TRANSITION_BUTTONS[t];
      return `<button type="button" class="btn btn-sm ${b.cls}" data-action="transition" data-status="${esc(t)}">${esc(b.text)}</button>`;
    });
    if (canWrite() && !locked) {
      actions.push(`<button type="button" class="btn btn-sm btn-light" data-action="edit" data-id="${esc(o.id)}">Edit</button>`);
      actions.push(`<button type="button" class="btn btn-sm btn-light text-danger" data-action="delete" data-id="${esc(o.id)}">Delete</button>`);
    }
    const pickupWin = o.pickupWindowStart || o.pickupWindowEnd
      ? `${esc(ui.formatDateTime(o.pickupWindowStart))} – ${esc(ui.formatTime(o.pickupWindowEnd))}` : '—';
    const signature = typeof o.podSignature === 'string' && o.podSignature.startsWith('data:image/png;base64,') ? o.podSignature : null;

    $('drawerBody').innerHTML = `
      ${actions.length ? `<div class="drawer-section d-flex flex-wrap gap-2">${actions.join('')}</div>` : ''}
      <div class="drawer-section">
        <h6>Shipment</h6>
        <div class="detail-grid">
          ${detail('Client', esc(o.clientName), 'full')}
          ${detail('Cargo', esc(o.cargoDescription), 'full')}
          ${detail('Weight', esc(ui.formatWeight(o.cargoWeight)))}
          ${detail('Created', esc(ui.formatDateTime(o.createdAt)))}
        </div>
      </div>
      <div class="drawer-section">
        <h6>Route</h6>
        <div class="detail-grid">
          ${detail('Origin', `${esc(o.originWarehouseName || '—')}<div class="cell-sub">${esc(o.pickupAddress)}</div>`)}
          ${detail('Destination', `${esc(o.destinationWarehouseName || '—')}<div class="cell-sub">${esc(o.deliveryAddress)}</div>`)}
          ${detail('Vehicle', o.truckPlate ? `<span class="mono">${esc(o.truckPlate)}</span><div class="cell-sub">${esc(o.driverName || '')}</div>` : '<span class="text-body-secondary">Unassigned</span>')}
          ${detail('Dock', o.dockNumber ? `<span class="dock-pill">${esc(o.dockNumber)}</span>` : '—')}
          ${detail('Pickup window', pickupWin)}
          ${detail('Planned delivery', esc(ui.formatDate(o.plannedDeliveryDate)))}
          ${o.deliveredAt ? detail('Delivered at', esc(ui.formatDateTime(o.deliveredAt))) : ''}
        </div>
      </div>
      ${o.status === 'delivered' ? `
      <div class="drawer-section">
        <h6>Proof of delivery</h6>
        <div class="detail-grid">
          ${detail('Recipient', esc(o.podRecipientName || '—'))}
          ${detail('Note', esc(o.podNote || '—'))}
          <div class="full"><div class="detail-label mb-1">Signature</div>${signature ? '<img class="pod-signature" id="podSignatureImg" alt="Recipient signature">' : '<span class="text-body-secondary small">No signature captured.</span>'}</div>
        </div>
      </div>` : ''}
      <div class="drawer-section">
        <h6>Status history</h6>
        ${renderTimeline(history)}
      </div>`;
    if (signature) $('podSignatureImg').src = signature;
  }

  async function openDrawer(id) {
    $('drawerTitle').textContent = 'Loading…';
    $('drawerBadges').innerHTML = '';
    $('drawerBody').innerHTML = '<div class="py-4"><span class="skeleton mb-3" style="width:60%"></span><span class="skeleton mb-3"></span><span class="skeleton" style="width:40%"></span></div>';
    drawer().show();
    try {
      const [order, history] = await Promise.all([
        api.get(`/orders/${encodeURIComponent(id)}`),
        api.get(`/orders/${encodeURIComponent(id)}/history`).catch(() => []),
      ]);
      current = order;
      renderDrawer(order, Array.isArray(history) ? history : (history && history.items) || []);
    } catch (err) {
      $('drawerTitle').textContent = 'Order';
      $('drawerBody').innerHTML = ui.emptyState('Could not load order', ui.errorMessage(err), 'triangle-alert');
    }
  }

  // ---------------------------------------------------------------------------
  // Status transitions & POD
  // ---------------------------------------------------------------------------
  async function patchStatus(body) {
    await api.patch(`/orders/${encodeURIComponent(current.id)}/status`, body);
    ui.toast(`Order ${current.orderNumber} is now ${ui.label(ui.ORDER_STATUS_LABELS, body.status)}.`, 'success');
    await Promise.all([openDrawer(current.id), load()]);
  }

  async function transition(status) {
    if (!current || !ui.canTransition(current.status, status)) return;
    if (status === 'delivered') { openPod(); return; }
    if (status === 'in_transit' && !current.vehicleId) {
      ui.toast('Assign a vehicle before dispatching this order.', 'warning');
      openForm(current);
      return;
    }
    const isCancel = status === 'cancelled';
    const ok = await ui.confirm({
      title: isCancel ? `Cancel order ${current.orderNumber}?` : `Dispatch order ${current.orderNumber}?`,
      message: isCancel
        ? (current.status === 'in_transit' ? 'The order will be cancelled and its vehicle released.' : 'The order will be cancelled.')
        : `Vehicle ${current.truckPlate || ''} will be marked On Trip.`,
      confirmText: isCancel ? 'Cancel order' : 'Dispatch',
      variant: isCancel ? 'danger' : 'primary',
      withNote: true,
    });
    if (!ok) return;
    try {
      const body = { status };
      if (ok.note) body.note = ok.note;
      await patchStatus(body);
    } catch (err) { ui.toastError(err); }
  }

  let pad = null;
  function openPod() {
    const f = $('podForm');
    f.reset();
    ui.clearFieldErrors(f);
    $('podOrderInfo').textContent = `${current.orderNumber} · ${current.clientName} · ${current.deliveryAddress || ''}`;
    podModal().show();
  }

  function initPod() {
    pad = window.FT.SignaturePad($('signatureCanvas'), {
      onChange: (empty) => $('signatureWrap').classList.toggle('signed', !empty),
    });
    $('podModal').addEventListener('shown.bs.modal', () => { pad.resize(); $('pod-name').focus(); });
    $('podForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = $('podForm');
      const name = f.podRecipientName.value.trim();
      if (!name) { ui.showFieldErrors(f, { message: 'Recipient name is required.', details: [{ field: 'podRecipientName', message: 'Recipient name is required.' }] }); return; }
      const body = { status: 'delivered', podRecipientName: name };
      const note = f.podNote.value.trim();
      if (note) body.podNote = note;
      if (!pad.isEmpty()) {
        body.podSignature = pad.toDataURL();
        if (body.podSignature.length > 500 * 1024) { ui.showFieldErrors(f, { message: 'Signature image is too large. Please clear and sign again.', details: [] }); return; }
      }
      await ui.withBusy($('podSaveBtn'), async () => {
        try {
          await patchStatus(body);
          podModal().hide();
        } catch (err) { ui.showFieldErrors(f, err); }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  async function exportExcel(btn) {
    await ui.withBusy(btn, async () => {
      try {
        const all = await api.getAll('/orders', queryParams());
        if (!all.length) { ui.toast('No orders to export.', 'info'); return; }
        window.FT.export.ordersToExcel(all);
        ui.toast(`Exported ${all.length} orders.`, 'success');
      } catch (err) { ui.toastError(err); }
    });
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  function bindEvents() {
    const filters = $('filters');
    const reload = () => { state.page = 1; load(); };
    filters.addEventListener('submit', (e) => e.preventDefault());
    filters.q.addEventListener('input', ui.debounce(() => { state.q = filters.q.value.trim(); reload(); }, 300));
    filters.addEventListener('change', (e) => {
      const n = e.target;
      if (!n.name || n.name === 'q') return;
      state[n.name] = n.value;
      if (n.name === 'warehouseId') filters.direction.disabled = !n.value;
      reload();
    });

    $('ordersTable').querySelector('thead').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (!th) return;
      const key = th.dataset.sort;
      state.dir = state.sort === key && state.dir === 'asc' ? 'desc' : (state.sort === key ? 'asc' : (key === 'createdAt' || key === 'cargoWeight' ? 'desc' : 'asc'));
      state.sort = key;
      reload();
    });

    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a || !a.closest('#app, #orderDrawer')) return;
      const id = a.dataset.id;
      switch (a.dataset.action) {
        case 'create': openForm(null); break;
        case 'export': exportExcel(a); break;
        case 'reset-filters':
          filters.reset();
          filters.direction.disabled = true;
          Object.assign(state, { q: '', status: '', type: '', warehouseId: '', direction: 'any', vehicleId: '', page: 1 });
          load();
          break;
        case 'view': openDrawer(id); break;
        case 'edit': e.stopPropagation(); editOrder(id); break;
        case 'delete': e.stopPropagation(); deleteOrder(id); break;
        case 'transition': transition(a.dataset.status); break;
        default: break;
      }
    });

    const f = $('orderForm');
    f.addEventListener('submit', submitForm);
    f.type.addEventListener('change', syncTypeHints);
    f.originWarehouseId.addEventListener('change', () => autofillAddress(f.originWarehouseId, f.pickupAddress));
    f.destinationWarehouseId.addEventListener('change', () => autofillAddress(f.destinationWarehouseId, f.deliveryAddress));
    $('podModal').addEventListener('click', (e) => { if (e.target.closest('[data-action="clear-signature"]')) pad.clear(); });
  }

  async function init() {
    bindEvents();
    initPod();
    const params = new URLSearchParams(location.search);
    ['status', 'type', 'vehicleId', 'warehouseId'].forEach((k) => {
      if (params.get(k)) { state[k] = params.get(k); }
    });
    await loadLookups();
    const filters = $('filters');
    ['status', 'type', 'vehicleId', 'warehouseId'].forEach((k) => { filters[k].value = state[k]; });
    filters.direction.disabled = !state.warehouseId;
    await load();
    if (params.get('new') === '1' && canWrite()) openForm(null);
    if (params.get('open')) openDrawer(params.get('open'));
  }

  layout.ready.then(init).catch(() => {});
})();
