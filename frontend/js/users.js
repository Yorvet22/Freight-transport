/** Users page (admin only): list, create, delete. The current admin cannot delete themselves. */
(function () {
  'use strict';

  const { api, ui, layout } = window.FT;
  const $ = (id) => document.getElementById(id);
  const esc = ui.escapeHtml;
  const modal = () => bootstrap.Modal.getOrCreateInstance($('userModal'));
  let users = [];

  function render() {
    const me = layout.user;
    if (!users.length) {
      $('usersBody').innerHTML = ui.emptyRow(4, 'No users', 'Add the first account.', 'users');
      return;
    }
    $('usersBody').innerHTML = users.map((u) => {
      const self = me && String(me.id) === String(u.id);
      return `
        <tr>
          <td><div class="d-flex align-items-center gap-2"><span class="avatar" aria-hidden="true">${esc(String(u.username).slice(0, 2).toUpperCase())}</span>
            <span class="fw-semibold">${esc(u.username)}</span>${self ? '<span class="badge-soft badge rounded-pill">You</span>' : ''}</div></td>
          <td>${ui.roleBadge(u.role)}</td>
          <td class="hide-xs small text-body-secondary">${esc(ui.formatDateTime(u.createdAt))}</td>
          <td class="actions">${self
            ? '<button type="button" class="btn btn-icon btn-icon-sm" disabled title="You cannot delete your own account" aria-label="Cannot delete yourself">' + ui.icon('trash-2') + '</button>'
            : `<button type="button" class="btn btn-icon btn-icon-sm danger" data-action="delete" data-id="${esc(u.id)}" title="Delete" aria-label="Delete ${esc(u.username)}">${ui.icon('trash-2')}</button>`}</td>
        </tr>`;
    }).join('');
  }

  async function load() {
    $('usersBody').innerHTML = ui.skeletonRows(4, 4);
    try {
      const res = await api.get('/users');
      users = Array.isArray(res) ? res : (res && res.items) || [];
      render();
    } catch (err) {
      $('usersBody').innerHTML = ui.emptyRow(4, 'Could not load users', ui.errorMessage(err), 'triangle-alert');
    }
  }

  async function submit(e) {
    e.preventDefault();
    const f = $('userForm');
    const data = { username: f.username.value.trim(), password: f.password.value, role: f.role.value };
    const errs = [];
    if (!data.username) errs.push({ field: 'username', message: 'Username is required.' });
    if (data.password.length < 6) errs.push({ field: 'password', message: 'Password must be at least 6 characters.' });
    if (errs.length) { ui.showFieldErrors(f, { message: 'Please fix the highlighted fields.', details: errs }); return; }
    await ui.withBusy($('userSaveBtn'), async () => {
      try {
        await api.post('/users', data);
        modal().hide();
        ui.toast(`User ${data.username} created.`, 'success');
        load();
      } catch (err) {
        if (err.code === 'DUPLICATE_USERNAME' && !err.details.length) err.details = [{ field: 'username', message: err.message }];
        ui.showFieldErrors(f, err);
      }
    });
  }

  async function remove(id) {
    const u = users.find((x) => String(x.id) === String(id));
    const ok = await ui.confirm({ title: 'Delete user?', message: `${u ? u.username : 'This user'} will lose access immediately.`, confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await api.del(`/users/${encodeURIComponent(id)}`);
      ui.toast('User deleted.', 'success');
      load();
    } catch (err) { ui.toastError(err); }
  }

  function init() {
    if (!layout.can('admin')) {
      $('usersCard').innerHTML = ui.emptyState('Admins only', 'You need the admin role to manage users.', 'lock');
      return;
    }
    $('userForm').addEventListener('submit', submit);
    $('userModal').addEventListener('show.bs.modal', () => { $('userForm').reset(); ui.clearFieldErrors($('userForm')); });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('#app [data-action]');
      if (!a) return;
      if (a.dataset.action === 'create') modal().show();
      if (a.dataset.action === 'delete') remove(a.dataset.id);
    });
    load();
  }

  layout.ready.then(init).catch(() => {});
})();
