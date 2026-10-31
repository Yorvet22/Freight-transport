/** Excel export helpers built on SheetJS (window.FT.export). */
(function (root) {
  'use strict';

  const ui = root.FT.ui;

  /** Maps an order (list shape) to an English spreadsheet row. */
  function orderRow(o) {
    return {
      'Order #': o.orderNumber,
      Type: ui.label(ui.ORDER_TYPE_LABELS, o.type),
      Status: ui.label(ui.ORDER_STATUS_LABELS, o.status),
      Client: o.clientName,
      'Origin warehouse': o.originWarehouseName || '',
      'Destination warehouse': o.destinationWarehouseName || '',
      'Pickup address': o.pickupAddress,
      'Delivery address': o.deliveryAddress,
      Cargo: o.cargoDescription,
      'Weight (kg)': o.cargoWeight === null || o.cargoWeight === undefined ? '' : Number(o.cargoWeight),
      Vehicle: o.truckPlate || '',
      Driver: o.driverName || '',
      'Planned delivery': o.plannedDeliveryDate ? ui.toDateInput(o.plannedDeliveryDate) : '',
      'Pickup window start': o.pickupWindowStart ? ui.formatDateTime(o.pickupWindowStart) : '',
      'Pickup window end': o.pickupWindowEnd ? ui.formatDateTime(o.pickupWindowEnd) : '',
      Dock: o.dockNumber || '',
      Created: o.createdAt ? ui.formatDateTime(o.createdAt) : '',
      Delivered: o.deliveredAt ? ui.formatDateTime(o.deliveredAt) : '',
      'POD recipient': o.podRecipientName || '',
    };
  }

  function autoWidth(rows) {
    if (!rows.length) return [];
    return Object.keys(rows[0]).map((k) => ({
      wch: Math.min(40, Math.max(k.length, ...rows.map((r) => String(r[k] === undefined || r[k] === null ? '' : r[k]).length)) + 2),
    }));
  }

  /** sheets: [{ name, rows: [{col: value}] }] → downloads `filename`. */
  function writeWorkbook(filename, sheets) {
    if (!root.XLSX) { ui.toast('Excel library failed to load.', 'danger'); return; }
    const wb = root.XLSX.utils.book_new();
    sheets.forEach((s) => {
      const ws = root.XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ Info: 'No data' }]);
      ws['!cols'] = autoWidth(s.rows);
      root.XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    });
    root.XLSX.writeFile(wb, filename);
  }

  function ordersToExcel(orders, filename) {
    writeWorkbook(filename || `orders-${ui.todayIso()}.xlsx`, [{ name: 'Orders', rows: orders.map(orderRow) }]);
  }

  root.FT.export = { orderRow, writeWorkbook, ordersToExcel };
})(window);
