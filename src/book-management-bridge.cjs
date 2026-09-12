'use strict';

const DEFAULT_BASE_URL = process.env.VERSA_BOOK_MGMT_URL || 'http://127.0.0.1:5000';
const DEFAULT_TIMEOUT_MS = 8_000;

function managementUnavailable(cause) {
  return Object.assign(new Error('Versa Management is not running. Open Versa Management to start it.'), {
    code: 'MANAGEMENT_UNAVAILABLE',
    cause
  });
}

function normalizeDestination(input = {}) {
  const folder = input.folder_info || input.folderInfo || input;
  const productId = String(folder.product_id || folder.productId || '').trim();
  const bookPath = String(folder.book_path || folder.bookPath || '').trim();
  const smmPath = String(folder.smm_path || folder.smmPath || '').trim();
  const rootPath = String(folder.root_path || folder.rootPath || '').trim();
  const name = String(folder.name || folder.book_name || folder.bookName || productId || '').trim();
  return {
    productId,
    name,
    bookPath,
    smmPath,
    rootPath,
    empty: Boolean(folder.empty),
    suggested: Boolean(folder.suggested),
    status: String(folder.status || ''),
    source: String(folder.source || 'local')
  };
}

function requireManagementDestination(input) {
  const destination = normalizeDestination(input);
  if (!destination.bookPath) {
    throw Object.assign(
      new Error('Pick a Versa Management book before exporting. Open Versa Management if the list is empty.'),
      { code: 'MANAGEMENT_DESTINATION_REQUIRED' }
    );
  }
  return destination;
}

function buildRegisterPayload(destination, bookName) {
  const dest = normalizeDestination(destination);
  return {
    product_id: dest.productId,
    book_path: dest.bookPath,
    smm_path: dest.smmPath,
    book_name: String(bookName || dest.name || dest.productId || 'New Exported Book')
  };
}

function pickerBooks(books = [], suggested = null) {
  const list = Array.isArray(books) ? books.map((item) => normalizeDestination(item)) : [];
  const next = suggested ? { ...normalizeDestination(suggested), suggested: true, empty: true } : null;
  if (next?.productId && !list.some((item) => item.productId === next.productId)) {
    list.unshift(next);
  } else if (next?.productId) {
    const match = list.find((item) => item.productId === next.productId);
    if (match) {
      match.suggested = true;
      match.empty = true;
      match.bookPath = match.bookPath || next.bookPath;
      match.smmPath = match.smmPath || next.smmPath;
    }
  }
  return list;
}

function filterBooks(books = [], query = '') {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return books;
  return books.filter((item) => {
    const haystack = `${item.productId || ''} ${item.name || ''} ${item.status || ''}`.toLowerCase();
    return haystack.includes(needle);
  });
}

async function requestJson(path, {
  method = 'GET',
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  baseUrl = DEFAULT_BASE_URL
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(json.message || `Versa Management request failed (${response.status}).`), {
        code: 'MANAGEMENT_HTTP_ERROR',
        status: response.status
      });
    }
    return json;
  } catch (error) {
    if (error && (error.code === 'MANAGEMENT_HTTP_ERROR')) throw error;
    throw managementUnavailable(error);
  } finally {
    clearTimeout(timer);
  }
}

async function listBooks(query = '', options = {}) {
  const suffix = query ? `?q=${encodeURIComponent(String(query))}` : '';
  try {
    const json = await requestJson(`/api/integration/books${suffix}`, options);
    return {
      books: Array.isArray(json.books) ? json.books.map((item) => normalizeDestination(item)) : [],
      notion: Boolean(json.notion)
    };
  } catch (error) {
    if (error?.code !== 'MANAGEMENT_HTTP_ERROR') throw error;
    const products = await requestJson('/api/products', options);
    const list = Array.isArray(products) ? products : (products.books || []);
    const books = list.map((item) => normalizeDestination({
      product_id: item.product_id,
      name: item.name,
      book_path: item.book_path || item.book_url,
      smm_path: item.smm_path || item.smm_url,
      status: item.status,
      source: item.source || 'notion'
    }));
    return { books: filterBooks(books, query), notion: true };
  }
}

async function availableFolder(options = {}) {
  const json = await requestJson('/api/integration/available_folder', options);
  return normalizeDestination(json.folder_info || json);
}

async function bootstrapSlots(rootPath, options = {}) {
  return requestJson('/api/integration/bootstrap', {
    ...options,
    method: 'POST',
    body: {
      root_path: String(rootPath || '').trim(),
      count: 1000
    }
  });
}

async function setPluginRoot(rootPath, options = {}) {
  const path = String(rootPath || '').trim();
  if (!path) return { ok: false };
  try {
    const json = await requestJson('/api/integration/set_root', {
      ...options,
      method: 'POST',
      body: { root_path: path }
    });
    return { ok: json.status === 'success' || json.ok === true, rootPath: path, ...json };
  } catch (error) {
    if (error?.status === 404 || error?.code === 'MANAGEMENT_HTTP_ERROR') {
      return { ok: false, skipped: true };
    }
    throw error;
  }
}

async function registerExport(destination, bookName, options = {}) {
  const payload = buildRegisterPayload(destination, bookName);
  const json = await requestJson('/api/integration/register_export', {
    ...options,
    method: 'POST',
    body: payload
  });
  return {
    ok: json.status === 'success' || json.status === 'ok' || json.ok === true,
    notion: Boolean(json.notion),
    message: json.message || 'Successfully linked.',
    payload
  };
}

async function loadExportPicker(query = '', options = {}) {
  const [listed, suggested] = await Promise.all([
    listBooks(query, options),
    availableFolder(options)
  ]);
  return {
    suggested,
    notion: listed.notion,
    books: pickerBooks(listed.books, suggested)
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  normalizeDestination,
  requireManagementDestination,
  buildRegisterPayload,
  pickerBooks,
  filterBooks,
  requestJson,
  listBooks,
  availableFolder,
  registerExport,
  bootstrapSlots,
  setPluginRoot,
  loadExportPicker
};
