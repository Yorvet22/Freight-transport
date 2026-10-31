/**
 * Small controller for server-side paginated, sortable, searchable tables
 * (window.FT.listPage). Used by the vehicles and warehouses pages.
 *
 * FT.listPage({
 *   endpoint: '/vehicles', table, tbody, pagination, filters (form, optional),
 *   sort: 'licensePlate', dir: 'asc', limit: 20, cols: 7,
 *   renderRow(item) → '<tr>…</tr>' (escaped!), empty: { title, hint, icon }
 * }) → { load, state, items() }
 */
(function (root) {
  'use strict';

  const { api, ui } = root.FT;

  function listPage(cfg) {
    const state = Object.assign({ page: 1, limit: cfg.limit || 20, sort: cfg.sort, dir: cfg.dir || 'asc', q: '' }, cfg.initial || {});
    let items = [];
    let seq = 0;

    function params() {
      const p = { page: state.page, limit: state.limit, sort: state.sort, dir: state.dir, q: state.q };
      if (cfg.filters) {
        Array.from(cfg.filters.elements).forEach((n) => { if (n.name && n.name !== 'q') p[n.name] = n.value; });
      }
      return p;
    }

    async function load() {
      const mine = ++seq;
      if (!items.length) cfg.tbody.innerHTML = ui.skeletonRows(cfg.cols, 6);
      else cfg.tbody.style.opacity = '.55';
      ui.updateSortHeaders(cfg.table, state.sort, state.dir);
      try {
        const res = await api.get(cfg.endpoint, params());
        if (mine !== seq) return;
        items = res.items || [];
        const total = Number(res.total || 0);
        if (!items.length && total && state.page > 1) { state.page = ui.totalPages(total, state.limit); load(); return; }
        if (!items.length) {
          const filtered = state.q || (cfg.filters && Array.from(cfg.filters.elements).some((n) => n.name && n.name !== 'q' && n.value));
          cfg.tbody.innerHTML = filtered
            ? ui.emptyRow(cfg.cols, 'No results match your filters', 'Try clearing the search or filters.', 'search-x')
            : ui.emptyRow(cfg.cols, cfg.empty.title, cfg.empty.hint, cfg.empty.icon);
        } else {
          cfg.tbody.innerHTML = items.map(cfg.renderRow).join('');
        }
        ui.renderPagination(cfg.pagination, { page: state.page, limit: state.limit, total }, (p) => { state.page = p; load(); });
        if (cfg.onLoad) cfg.onLoad(items, res);
      } catch (err) {
        if (mine !== seq) return;
        items = [];
        cfg.tbody.innerHTML = ui.emptyRow(cfg.cols, 'Could not load data', ui.errorMessage(err), 'triangle-alert');
      } finally {
        if (mine === seq) cfg.tbody.style.opacity = '';
      }
    }

    const reload = () => { state.page = 1; load(); };

    cfg.table.querySelector('thead').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (!th) return;
      const key = th.dataset.sort;
      state.dir = state.sort === key ? (state.dir === 'asc' ? 'desc' : 'asc') : 'asc';
      state.sort = key;
      reload();
    });

    if (cfg.filters) {
      cfg.filters.addEventListener('submit', (e) => e.preventDefault());
      if (cfg.filters.q) cfg.filters.q.addEventListener('input', ui.debounce(() => { state.q = cfg.filters.q.value.trim(); reload(); }, 300));
      cfg.filters.addEventListener('change', (e) => { if (e.target.name && e.target.name !== 'q') reload(); });
      cfg.filters.addEventListener('reset', () => setTimeout(() => { state.q = ''; reload(); }, 0));
    }

    return { load, reload, state, items: () => items };
  }

  root.FT.listPage = listPage;
})(window);
