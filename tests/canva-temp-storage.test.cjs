'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CANVA_TEMP_BUCKET,
  canvaTempObjectPath,
  rememberCanvaImportPdf,
  restoreCanvaImportPdfIfMissing,
  forgetCanvaImportPdf,
  sha256File
} = require('../src/canva-temp-storage.cjs');

const MINIMAL_PDF = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

function mockStore(values = {}) {
  const map = new Map(Object.entries(values));
  return {
    getSetting(key, fallback = null) {
      return map.has(key) ? map.get(key) : fallback;
    },
    setSetting(key, value) {
      map.set(key, value);
    }
  };
}

test('object paths stay inside the private Canva temp bucket', () => {
  const objectPath = canvaTempObjectPath({ projectId: 'book 1', checksum: 'abc123', fileName: 'book.pdf' });
  assert.match(objectPath, /book_1\/abc123-book\.pdf/);
  assert.equal(CANVA_TEMP_BUCKET, 'canva-import-temp');
});

test('resume downloads the print PDF from mock Supabase when the local file is gone', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canva-temp-'));
  const localPath = path.join(tmp, 'canva-import', 'book.pdf');
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, MINIMAL_PDF);
  const checksum = sha256File(localPath);
  const objects = new Map();
  const fetchImpl = async (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    if (method === 'POST' && /\/storage\/v1\/object\/canva-import-temp\//.test(url) && !/\/sign\//.test(url)) {
      objects.set('pdf', Buffer.from(options.body));
      return { ok: true, status: 200, text: async () => '{}' };
    }
    if (method === 'POST' && /\/object\/sign\//.test(url)) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ signedURL: '/object/sign/canva-import-temp/book.pdf' }) };
    }
    if (method === 'POST' && /\/rest\/v1\/canva_import_temp/.test(url)) {
      return { ok: true, status: 201, text: async () => '' };
    }
    if (method === 'GET' && /\/object\/sign\//.test(url)) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => objects.get('pdf'),
        body: null,
        text: async () => ''
      };
    }
    if (method === 'GET' && /\/storage\/v1\/object\//.test(url)) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => objects.get('pdf'),
        body: null,
        text: async () => ''
      };
    }
    if (method === 'DELETE') {
      objects.delete('pdf');
      return { ok: true, status: 200, text: async () => '{}' };
    }
    return { ok: false, status: 404, text: async () => 'missing' };
  };
  const store = mockStore({
    supabaseUrl: 'https://example.supabase.co',
    supabaseServiceRoleKey: 'service-role-test'
  });
  const remembered = await rememberCanvaImportPdf({
    projectId: 'proj-1',
    localPath,
    store,
    fetchImpl
  });
  assert.equal(remembered.bucket, 'canva-import-temp');
  assert.equal(remembered.checksum, checksum);
  assert.ok(remembered.objectPath);
  assert.ok(remembered.signedUrl);
  fs.rmSync(localPath, { force: true });
  assert.equal(fs.existsSync(localPath), false);
  const restored = await restoreCanvaImportPdfIfMissing({
    destPath: localPath,
    tempPdf: remembered,
    store,
    fetchImpl
  });
  assert.equal(restored, localPath);
  assert.equal(fs.existsSync(localPath), true);
  assert.equal(sha256File(localPath), checksum);
  const forgotten = await forgetCanvaImportPdf({ tempPdf: remembered, store, fetchImpl });
  assert.equal(forgotten, true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('missing Supabase config skips temp memory instead of failing Canva', async () => {
  const remembered = await rememberCanvaImportPdf({
    projectId: 'proj-2',
    localPath: __filename,
    store: mockStore()
  });
  assert.equal(remembered, null);
});
