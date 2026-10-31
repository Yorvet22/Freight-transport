/** Vehicles page: list + CRUD (dispatcher+). BR5: on_trip vehicles are read-only and cannot be deleted. */
(function () {
  'use strict';

  const { api, ui, layout } = window.FT;
  const $ = (id) => document.getElementById(id);
  const esc = ui.escapeHtml;
  const modal = () => bootstrap.Modal.getOrCreateInstance($('vehicleModal'));
  let editing = null;
  let list = null;

  function renderRow(v) {
    const canWrite = layout.can('dispatcher');
    const onTrip = v.status === 'on_trip';
    const actions = [];
    if (canWrite) {
      actions.push(`<button type="button" class="btn btn-icon btn-icon-sm" data-action="edit" data-id="${esc(v.id)}" title="Edit" aria-label="Edit ${esc(v.licensePlate)}">${ui.icon('pencil')}</button>`);
      actions.push(onTrip
        ? `<button type="button" class="btn btn-icon btn-icon-sm" disabled title="Vehicle is on a trip" aria-label="Cannot delete: on trip">${ui.icon('trash-2')}</button>`
        : `<button type="button" class="btn btn-icon btn-icon-sm danger" data-action="delete" data-id="${esc(v.id)}" title="Delete" aria-label="Delete ${esc(v.licensePlate)}">${ui.icon('trash-2')}</button>`);
    }
    actions.push(`<a class="btn btn-icon btn-icon-sm" href="/orders.html?${new URLSearchParams({ vehicleId: v.id })}" title="Orders" aria-label="Orders of ${esc(v.licensePlate)}">${ui.icon('package')}</a>`);
    return `
      <tr>
        <td><span class="cell-main mono">${esc(v.licensePlate)}</span></td>
        <td>${esc(v.model)}</td>
        <td>${esc(v.driverName || '—')}</td>
        <td class="text-end hide-xs text-nowrap">${esc(ui.formatWeight(v.capacityKg))}</td>
        <td>${ui.vehicleStatusBadge(v.status)}</td>
        <td class="actions">${actions.join('')}</td>
      </tr>`;
  }

  async function loadCounts() {
    try {
      const k = await api.get('/dashboard/kpis');
      const v = (k && k.vehicles) || {};
      ['total', 'available', 'on_trip', 'maintenance'].forEach((key) => {
        const n = document.querySelector(`[data-count="${key}"]`);
        if (n) n.textContent = ui.formatNumber(v[key] || 0);
      });
    } catch (_) { /* counts are decorative */ }
  }

  function openForm(v) {
    editing = v || null;
    const f = $('vehicleForm');
    f.reset();
    ui.clearFieldErrors(f);
    $('vehicleModalTitle').textContent = v ? `Edit ${v.licensePlate}` : 'Add vehicle';
    const statusSel = f.status;
    statusSel.querySelectorAll('option[value="on_trip"]').forEach((o) => o.remove());
    statusSel.disabled = false;
    $('statusHint').textContent = 'On Trip is set automatically when an order is dispatched.';
    if (v) {
      f.licensePlate.value = v.licensePlate || '';
      f.model.value = v.model || '';
      f.driverName.value = v.driverName || '';
      f.capacityKg.value = v.capacityKg !== null && v.capacityKg !== undefined ? v.capacityKg : '';
      if (v.status === 'on_trip') {
        statusSel.insertAdjacentHTML('beforeend', '<option value="on_trip">On Trip</option>');
        statusSel.disabled = true;
        $('statusHint').textContent = 'Status cannot be changed while the vehicle is on a trip.';
      }
      statusSel.value = v.status || 'available';
    }
    modal().show();
  }

  async function submit(e) {
    e.preventDefault();
    const f = $('vehicleForm');
    const data = {
      licensePlate: f.licensePlate.value.trim().toUpperCase(),
      model: f.model.value.trim(),
      driverName: f.driverName.value.trim(),
      capacityKg: f.capacityKg.value === '' ? null : Number(f.capacityKg.value),
    };
    if (!f.status.disabled) data.status = f.status.value;
    const errs = [];
    if (!data.licensePlate) errs.push({ field: 'licensePlate', message: 'License plate is required.' });
    if (!data.model) errs.push({ field: 'model', message: 'Model is required.' });
    if (!data.driverName) errs.push({ field: 'driverName', message: 'Driver name is required.' });
    if (data.capacityKg !== null && !(data.capacityKg > 0)) errs.push({ field: 'capacityKg', message: 'Capacity must be a positive number.' });
    if (errs.length) { ui.showFieldErrors(f, { message: 'Please fix the highlighted fields.', details: errs }); return; }
    await ui.withBusy($('vehicleSaveBtn'), async () => {
      try {
        if (editing) await api.put(`/vehicles/${encodeURIComponent(editing.id)}`, data);
        else await api.post('/vehicles', data);
        modal().hide();
        ui.toast(editing ? 'Vehicle updated.' : 'Vehicle added.', 'success');
        list.load();
        loadCounts();
      } catch (err) {
        if (err.code === 'DUPLICATE_PLATE' && !err.details.length) err.details = [{ field: 'licensePlate', message: err.message }];
        ui.showFieldErrors(f, err);
      }
    });
  }

  async function remove(id) {
    const v = list.items().find((x) => String(x.id) === String(id));
    const ok = await ui.confirm({ title: 'Delete vehicle?', message: `${v ? v.licensePlate : 'This vehicle'} will be removed. Orders keep their history but lose the vehicle link.`, confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await api.del(`/vehicles/${encodeURIComponent(id)}`);
      ui.toast('Vehicle deleted.', 'success');
      list.load();
      loadCounts();
    } catch (err) { ui.toastError(err); }
  }

  function init() {
    list = window.FT.listPage({
      endpoint: '/vehicles', table: $('vehiclesTable'), tbody: $('vehiclesBody'), pagination: $('pagination'),
      filters: $('filters'), sort: 'licensePlate', dir: 'asc', cols: 6, renderRow,
      empty: { title: 'No vehicles yet', hint: 'Add your first vehicle to start assigning orders.', icon: 'truck' },
    });
    $('vehicleForm').addEventListener('submit', submit);
    document.addEventListener('click', (e) => {
      const a = e.target.closest('#app [data-action]');
      if (!a) return;
      if (a.dataset.action === 'create') openForm(null);
      if (a.dataset.action === 'edit') openForm(list.items().find((x) => String(x.id) === a.dataset.id));
      if (a.dataset.action === 'delete') remove(a.dataset.id);
    });
    list.load();
    loadCounts();
  }

  layout.ready.then(init).catch(() => {});
})();
