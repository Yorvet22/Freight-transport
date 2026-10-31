/**
 * Minimal signature pad on an HTML5 canvas (window.FT.SignaturePad).
 * Pointer events cover mouse, pen and touch; touch events are a fallback
 * for very old mobile browsers. Exports a PNG data URL on a white background.
 */
(function (root) {
  'use strict';

  function SignaturePad(canvas, opts) {
    const o = Object.assign({ color: '#111827', width: 2.2, onChange: null }, opts || {});
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let empty = true;
    let last = null;

    function resize() {
      const ratio = Math.max(1, root.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.width;
      clear();
    }

    function point(e) {
      const rect = canvas.getBoundingClientRect();
      const src = e.touches && e.touches[0] ? e.touches[0] : e;
      return { x: src.clientX - rect.left, y: src.clientY - rect.top };
    }

    function start(e) {
      e.preventDefault();
      drawing = true;
      last = point(e);
      ctx.beginPath();
      ctx.arc(last.x, last.y, o.width / 2, 0, Math.PI * 2);
      ctx.fillStyle = o.color;
      ctx.fill();
      markDirty();
      if (e.pointerId !== undefined && canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    }

    function move(e) {
      if (!drawing) return;
      e.preventDefault();
      const p = point(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    }

    function end() { drawing = false; last = null; }

    function markDirty() {
      if (empty) { empty = false; if (o.onChange) o.onChange(false); }
    }

    function clear() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      empty = true;
      if (o.onChange) o.onChange(true);
    }

    /** PNG data URL with a white background (readable in dark mode and print). */
    function toDataURL() {
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      const c = out.getContext('2d');
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, out.width, out.height);
      c.drawImage(canvas, 0, 0);
      return out.toDataURL('image/png');
    }

    if (root.PointerEvent) {
      canvas.addEventListener('pointerdown', start);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
      canvas.addEventListener('pointerleave', end);
    } else {
      canvas.addEventListener('mousedown', start);
      canvas.addEventListener('mousemove', move);
      root.addEventListener('mouseup', end);
      canvas.addEventListener('touchstart', start, { passive: false });
      canvas.addEventListener('touchmove', move, { passive: false });
      canvas.addEventListener('touchend', end);
    }

    return { resize, clear, toDataURL, isEmpty: () => empty };
  }

  root.FT = root.FT || {};
  root.FT.SignaturePad = SignaturePad;
})(window);
