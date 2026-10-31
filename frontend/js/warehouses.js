/** Warehouses page: list, CRUD (admin) and per-warehouse dock schedule (SPEC §5). */
(function () {
  'use strict';

  const { api, ui, layout } = window.FT;
  const $ = (id) => document.getElementById(id);
  const esc = ui.escapeHtml;
  const modal = () => bootstrap.Modal.getOrCreateInstance($('warehouseModal'));
  let editing = null;
  let list = null;
  let scheduleSeq = 0;

  // ---------------------------------------------------------------------------
  // List & CRUD
  // ---------------------------------------------------------------------------
  function renderRow(w) {
    const actions = [`<button type="button" class="btn btn-icon btn-icon-sm" data-action="schedule" data-id="${esc(w.id)}" title="Dock schedule" aria-label="Dock schedule for ${esc(w.code)}">${ui.icon('calendar')}</button>`];
    if (layout.can('admin')) {
      actions.push(`<button type="button" class="btn btn-icon btn-icon-sm" data-action="edit" data-id="${esc(w.id)}" title="Edit" aria-label="Edit ${esc(w.code)}">${ui.icon('pencil')}</button>`);
      actions.push(`<button type="button" class="btn btn-icon btn-icon-sm danger" data-action="delete" data-id="${esc(w.id)}" title="Delete" aria-label="Delete ${esc(w.code)}">${ui.icon('trash-2')}</button>`);
    }
    return `
      <tr>
        <td><span class="cell-main mono">${esc(w.code)}</span></td>
        <td class="text-nowrap"><div class="fw-medium">${esc(w.name)}</div>${w.phone ? `<div class="cell-sub">${esc(w.phone)}</div>` : ''}</td>
        <td class="text-nowrap">${esc(w.city)}</td>
        <td class="hide-lg small">${esc(w.address)}</td>
        <td class="hide-lg text-end text-nowrap">${w.capacityPallets !== null && w.capacityPallets !== undefined ? `${esc(ui.formatNumber(w.capacityPallets))} pallets` : '—'}</td>
        <td class="hide-lg small">${esc(w.managerName || '—')}</td>
        <td>${w.isActive === false ? '<span class="badge-status badge-cancelled">Inactive</span>' : '<span class="badge-status badge-delivered">Active</span>'}</td>
        <td class="actions">${actions.join('')}</td>
      </tr>`;
  }

  function openForm(w) {
    editing = w || null;
    const f = $('warehouseForm');
    f.reset();
    ui.clearFieldErrors(f);
    $('warehouseModalTitle').textContent = w ? `Edit ${w.code}` : 'Add warehouse';
    if (w) {
      ['code', 'name', 'address', 'city', 'managerName', 'phone'].forEach((k) => { f[k].value = w[k] || ''; });
      f.capacityPallets.value = w.capacityPallets !== null && w.capacityPallets !== undefined ? w.capacityPallets : '';
      f.isActive.checked = w.isActive !== false;
    }
    modal().show();
  }

  async function submit(e) {
    e.preventDefault();
    const f = $('warehouseForm');
    const opt = (v) => { const s = v.trim(); return s ? s : null; };
    const data = {
      code: f.code.value.trim().toUpperCase(),
      name: f.name.value.trim(),
      address: f.address.value.trim(),
      city: f.city.value.trim(),
      capacityPallets: f.capacityPallets.value === '' ? null : Number(f.capacityPallets.value),
      managerName: opt(f.managerName.value),
      phone: opt(f.phone.value),
      isActive: f.isActive.checked,
    };
    const errs = ['code', 'name', 'address', 'city'].filter((k) => !data[k]).map((k) => ({ field: k, message: 'This field is required.' }));
    if (data.capacityPallets !== null && !(data.capacityPallets >= 0)) errs.push({ field: 'capacityPallets', message: 'Capacity must be zero or more.' });
    if (errs.length) { ui.showFieldErrors(f, { message: 'Please fix the highlighted fields.', details: errs }); return; }
    await ui.withBusy($('warehouseSaveBtn'), async () => {
      try {
        if (editing) await api.put(`/warehouses/${encodeURIComponent(editing.id)}`, data);
        else await api.post('/warehouses', data);
        modal().hide();
        ui.toast(editing ? 'Warehouse updated.' : 'Warehouse added.', 'success');
        list.load();
        loadWarehouseOptions();
      } catch (err) {
        if (err.code === 'DUPLICATE_CODE' && !err.details.length) err.details = [{ field: 'code', message: err.message }];
        ui.showFieldErrors(f, err);
      }
    });
  }

  async function remove(id) {
    const w = list.items().find((x) => String(x.id) === String(id));
    const ok = await ui.confirm({
      title: 'Delete warehouse?',
      message: `${w ? `${w.code} · ${w.name}` : 'This warehouse'} will be removed. Warehouses with open orders cannot be deleted — consider marking it inactive instead.`,
      confirmText: 'Delete', variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/warehouses/${encodeURIComponent(id)}`);
      ui.toast('Warehouse deleted.', 'success');
      list.load();
      loadWarehouseOptions();
    } catch (err) { ui.toastError(err); }
  }

  // ---------------------------------------------------------------------------
  // Dock schedule
  // ---------------------------------------------------------------------------
  async function loadWarehouseOptions() {
    const sel = $('scheduleForm').warehouseId;
    try {
      const all = await api.getAll('/warehouses', { sort: 'code', dir: 'asc' });
      ui.fillSelect(sel, all.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` })), { keepValue: true });
      if (!sel.value && all.length) sel.value = all[0].id;
      if (!all.length) ui.fillSelect(sel, [], { placeholder: 'No warehouses' });
    } catch (err) { ui.toastError(err); }
  }

  function scheduleItem(o, kind) {
    const time = kind === 'dep'
      ? `${esc(ui.formatTime(o.pickupWindowStart))}<small>to ${esc(ui.formatTime(o.pickupWindowEnd))}</small>`
      : `${esc(ui.formatDate(o.plannedDeliveryDate).slice(0, 6))}<small>planned</small>`;
    const other = kind === 'dep'
      ? (o.destinationWarehouseName || o.deliveryAddress)
      : (o.originWarehouseName || o.pickupAddress);
    return `
      <li class="schedule-item">
        <div class="schedule-time">${time}</div>
        <div class="flex-grow-1 min-w-0">
          <div class="d-flex flex-wrap align-items-center gap-2">
            <a class="fw-semibold mono" href="/orders.html?${new URLSearchParams({ open: o.id })}">${esc(o.orderNumber)}</a>
            ${ui.statusBadge(o.status)}
            ${o.dockNumber ? `<span class="dock-pill">Dock ${esc(o.dockNumber)}</span>` : ''}
          </div>
          <div class="small mt-1">${esc(o.clientName)} · ${esc(ui.formatWeight(o.cargoWeight))}</div>
          <div class="cell-sub">${kind === 'dep' ? 'To' : 'From'} ${esc(other || '—')}${o.truckPlate ? ` · <span class="meta">${ui.icon('truck')}<span class="mono">${esc(o.truckPlate)}</span></span>` : ''}</div>
        </div>
      </li>`;
  }

  function renderList(target, countEl, orders, kind) {
    countEl.textContent = String(orders.length);
    target.innerHTML = orders.length
      ? orders.map((o) => scheduleItem(o, kind)).join('')
      : `<li>${ui.emptyState(kind === 'dep' ? 'No departures' : 'No arrivals', 'Nothing scheduled for this day.', 'calendar')}</li>`;
  }

  async function loadSchedule() {
    const f = $('scheduleForm');
    const id = f.warehouseId.value;
    if (!id) {
      renderList($('departures'), $('depCount'), [], 'dep');
      renderList($('arrivals'), $('arrCount'), [], 'arr');
      return;
    }
    const mine = ++scheduleSeq;
    const skel = '<li class="schedule-item"><span class="skeleton block"></span></li>'.repeat(3);
    $('departures').innerHTML = skel;
    $('arrivals').innerHTML = skel;
    try {
      const res = await api.get(`/warehouses/${encodeURIComponent(id)}/schedule`, { date: f.date.value });
      if (mine !== scheduleSeq) return;
      if (res.date && !f.date.value) f.date.value = res.date;
      renderList($('departures'), $('depCount'), res.departures || [], 'dep');
      renderList($('arrivals'), $('arrCount'), res.arrivals || [], 'arr');
    } catch (err) {
      if (mine !== scheduleSeq) return;
      const msg = `<li>${ui.emptyState('Could not load schedule', ui.errorMessage(err), 'triangle-alert')}</li>`;
      $('departures').innerHTML = msg;
      $('arrivals').innerHTML = msg;
    }
  }

  function shiftDay(delta) {
    const f = $('scheduleForm');
    const d = ui.parseDate(f.date.value || ui.todayIso());
    d.setDate(d.getDate() + delta);
    f.date.value = ui.toDateInput(d);
    loadSchedule();
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  async function init() {
    list = window.FT.listPage({
      endpoint: '/warehouses', table: $('warehousesTable'), tbody: $('warehousesBody'), pagination: $('pagination'),
      filters: $('filters'), sort: 'code', dir: 'asc', cols: 8, renderRow,
      empty: { title: 'No warehouses yet', hint: 'Add a warehouse to start routing orders.', icon: 'warehouse' },
    });
    $('warehouseForm').addEventListener('submit', submit);

    const sf = $('scheduleForm');
    sf.date.value = ui.todayIso();
    sf.addEventListener('submit', (e) => e.preventDefault());
    sf.addEventListener('change', loadSchedule);

    document.addEventListener('click', (e) => {
      const a = e.target.closest('#app [data-action]');
      if (!a) return;
      const id = a.dataset.id;
      switch (a.dataset.action) {
        case 'create': openForm(null); break;
        case 'edit': openForm(list.items().find((x) => String(x.id) === id)); break;
        case 'delete': remove(id); break;
        case 'schedule':
          sf.warehouseId.value = id;
          loadSchedule();
          $('schedule').scrollIntoView({ behavior: 'smooth', block: 'start' });
          break;
        case 'day': shiftDay(Number(a.dataset.delta)); break;
        case 'today': sf.date.value = ui.todayIso(); loadSchedule(); break;
        default: break;
      }
    });

    list.load();
    await loadWarehouseOptions();
    loadSchedule();
  }

  layout.ready.then(init).catch(() => {});
})();
