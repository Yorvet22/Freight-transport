/**
 * FreightFlow API client (window.FT.api).
 * - base '/api' (relative), cookie auth (credentials: 'same-origin')
 * - checks res.ok before parsing, tolerates empty / non-JSON bodies
 * - throws Error with { code, status, details } (SPEC §4)
 * - 401 → redirect to /login.html (except on the login page itself)
 */
(function (root) {
  'use strict';

  const BASE = '/api';

  /** Builds '/api/path?x=1' skipping null/undefined/'' params. */
  function buildUrl(path, params) {
    const url = BASE + (path.startsWith('/') ? path : `/${path}`);
    if (!params) return url;
    const qs = new URLSearchParams();
    Object.keys(params).forEach((key) => {
      const v = params[key];
      if (v === null || v === undefined || v === '') return;
      qs.append(key, String(v));
    });
    const str = qs.toString();
    return str ? `${url}?${str}` : url;
  }

  function isLoginPage() {
    return typeof location !== 'undefined' && /\/login(\.html)?$/.test(location.pathname);
  }

  function makeError(status, body, fallback) {
    const err = new Error((body && body.message) || fallback || `Request failed (${status})`);
    err.status = status;
    err.code = (body && body.error) || (status === 0 ? 'NETWORK_ERROR' : 'HTTP_' + status);
    err.details = (body && Array.isArray(body.details)) ? body.details : [];
    return err;
  }

  async function readBody(res) {
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (_) { return { message: text.length < 300 ? text : undefined, raw: text }; }
  }

  async function request(method, path, options) {
    const opts = options || {};
    const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(buildUrl(path, opts.params), init);
    } catch (e) {
      throw makeError(0, null, 'Network error — is the server running?');
    }
    const body = await readBody(res);
    if (!res.ok) {
      if (res.status === 401 && !isLoginPage() && !opts.noRedirect) {
        const next = location.pathname + location.search;
        location.href = '/login.html?' + new URLSearchParams({ next }).toString();
      }
      throw makeError(res.status, body);
    }
    if (body && body.raw !== undefined) return body.raw;
    return body;
  }

  /** Fetches every page of a list endpoint (limit 500) and returns all items. */
  async function getAll(path, params) {
    const limit = 500;
    let page = 1;
    let items = [];
    for (;;) {
      const res = await request('GET', path, { params: Object.assign({}, params, { page, limit }) });
      const batch = Array.isArray(res) ? res : (res && res.items) || [];
      items = items.concat(batch);
      const total = Array.isArray(res) ? batch.length : Number(res.total || 0);
      if (Array.isArray(res) || items.length >= total || batch.length === 0) return items;
      page += 1;
    }
  }

  const api = {
    buildUrl,
    request,
    getAll,
    get: (path, params, opts) => request('GET', path, Object.assign({ params }, opts)),
    post: (path, body) => request('POST', path, { body }),
    put: (path, body) => request('PUT', path, { body }),
    patch: (path, body) => request('PATCH', path, { body }),
    del: (path) => request('DELETE', path),
  };

  root.FT = root.FT || {};
  root.FT.api = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
