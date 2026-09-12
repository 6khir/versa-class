'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  normalizeDestination,
  requireManagementDestination,
  buildRegisterPayload,
  pickerBooks,
  filterBooks,
  listBooks,
  availableFolder,
  registerExport,
  loadExportPicker
} = require('../src/book-management-bridge.cjs');
const { exportToManagementFolder } = require('../src/book-management-ipc.cjs');

const root = join(__dirname, '..');

test('picker payload normalizes available_folder and a searchable book list', () => {
  const suggested = normalizeDestination({
    product_id: 'P0100',
    book_path: '/tmp/tpt/P0100/Book',
    smm_path: '/tmp/tpt/P0100/SMM',
    root_path: '/tmp/tpt/P0100'
  });
  assert.equal(suggested.productId, 'P0100');
  assert.equal(suggested.bookPath, '/tmp/tpt/P0100/Book');

  const books = pickerBooks([
    { product_id: 'P0009', name: 'Ocean mazes', book_path: '/tmp/tpt/P0009/Book', smm_path: '/tmp/tpt/P0009/SMM' }
  ], suggested);
  assert.equal(books[0].productId, 'P0100');
  assert.equal(books[0].suggested, true);
  assert.equal(filterBooks(books, 'ocean')[0].productId, 'P0009');
  assert.deepEqual(buildRegisterPayload(suggested, 'Ocean mazes'), {
    product_id: 'P0100',
    book_path: '/tmp/tpt/P0100/Book',
    smm_path: '/tmp/tpt/P0100/SMM',
    book_name: 'Ocean mazes'
  });
});

test('export refuses a Finder-style empty destination', () => {
  assert.throws(
    () => requireManagementDestination({}),
    (error) => error.code === 'MANAGEMENT_DESTINATION_REQUIRED'
  );
});

test('list, available_folder, and register_export go through mocked fetch', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body || null });
    if (String(url).includes('/api/integration/books')) {
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          notion: false,
          books: [{ product_id: 'P0001', name: 'First', book_path: '/tmp/P0001/Book', smm_path: '/tmp/P0001/SMM' }]
        })
      };
    }
    if (String(url).includes('/api/integration/available_folder')) {
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          folder_info: {
            product_id: 'P0100',
            book_path: '/tmp/P0100/Book',
            smm_path: '/tmp/P0100/SMM',
            root_path: '/tmp/P0100'
          }
        })
      };
    }
    if (String(url).includes('/api/integration/register_export')) {
      return { ok: true, json: async () => ({ status: 'success', notion: false, message: 'Saved locally.' }) };
    }
    throw new Error(`unexpected ${url}`);
  };

  const listed = await listBooks('p00', { fetchImpl, baseUrl: 'http://127.0.0.1:5000' });
  assert.equal(listed.books[0].productId, 'P0001');
  const slot = await availableFolder({ fetchImpl, baseUrl: 'http://127.0.0.1:5000' });
  assert.equal(slot.productId, 'P0100');
  const registered = await registerExport(slot, 'Test book', { fetchImpl, baseUrl: 'http://127.0.0.1:5000' });
  assert.equal(registered.ok, true);
  assert.equal(registered.payload.product_id, 'P0100');
  assert.match(calls.at(-1).url, /\/api\/integration\/register_export$/);
  assert.equal(JSON.parse(calls.at(-1).body).book_name, 'Test book');

  const picker = await loadExportPicker('', { fetchImpl, baseUrl: 'http://127.0.0.1:5000' });
  assert.equal(picker.suggested.productId, 'P0100');
  assert.ok(picker.books.some((book) => book.productId === 'P0001'));
});

test('list falls back to /api/products when /books is missing', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/api/integration/books')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (String(url).includes('/api/products')) {
      return {
        ok: true,
        json: async () => ([{ product_id: 'P0002', name: 'Legacy', book_url: '/tmp/P0002/Book', smm_url: '/tmp/P0002/SMM' }])
      };
    }
    throw new Error(`unexpected ${url}`);
  };
  const listed = await listBooks('legacy', { fetchImpl, baseUrl: 'http://127.0.0.1:5000' });
  assert.equal(listed.books[0].productId, 'P0002');
  assert.equal(listed.books[0].bookPath, '/tmp/P0002/Book');
});

test('a down management server becomes MANAGEMENT_UNAVAILABLE', async () => {
  await assert.rejects(
    () => listBooks('', { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }),
    (error) => error.code === 'MANAGEMENT_UNAVAILABLE'
  );
});

test('export helper writes into the picked Book folder then POSTs register_export', async () => {
  const calls = [];
  const fileManager = {
    exportFinalPackageDirectory: async (project, destDir) => {
      calls.push({ destDir, projectId: project.id });
      return { destDir, manifest: { missing: [] } };
    }
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body });
    return { ok: true, json: async () => ({ status: 'success', notion: false }) };
  };
  const exported = await exportToManagementFolder({
    project: { id: 'p1', name: 'Ocean mazes' },
    destination: {
      productId: 'P0100',
      bookPath: '/tmp/versa-mgmt-book/P0100/Book',
      smmPath: '/tmp/versa-mgmt-book/P0100/SMM'
    },
    fileManager,
    bookName: 'Ocean mazes'
  }, { fetchImpl });
  assert.equal(exported.exportDirectory, '/tmp/versa-mgmt-book/P0100/Book');
  assert.equal(calls[0].destDir, '/tmp/versa-mgmt-book/P0100/Book');
  assert.match(calls[1].url, /register_export/);
  assert.equal(JSON.parse(calls[1].body).product_id, 'P0100');
});

test('the plugin lives in-repo and does not commit a Notion token', () => {
  const config = readFileSync(join(root, 'services/versa-book-management/config.py'), 'utf8');
  const app = readFileSync(join(root, 'services/versa-book-management/app.py'), 'utf8');
  assert.match(config, /VERSA_NOTION_TOKEN/);
  assert.doesNotMatch(config, /ntn_/);
  assert.match(app, /\/api\/integration\/available_folder/);
  assert.match(app, /\/api\/integration\/register_export/);
  assert.match(app, /\/api\/integration\/books/);
  assert.match(app, /\/api\/integration\/bootstrap/);
  assert.match(app, /\/api\/integration\/set_root/);
  const folders = readFileSync(join(root, 'services/versa-book-management/services/folder_manager.py'), 'utf8');
  assert.match(folders, /def ensure_pack_slots/);
  assert.match(folders, /P\{int\(num\):04d\}/);
});
