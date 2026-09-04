'use strict';

const { createHash } = require('node:crypto');
const { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { dirname, basename } = require('node:path');
const { pipeline } = require('node:stream/promises');

const CANVA_TEMP_BUCKET = 'canva-import-temp';
const CANVA_TEMP_MIME = 'application/pdf';
const CANVA_TEMP_TTL_SECONDS = 24 * 60 * 60;
const CANVA_TEMP_TABLE = 'canva_import_temp';

function readCanvaTempStorageConfig(store = null) {
  const url = String(process.env.SUPABASE_URL || store?.getSetting?.('supabaseUrl') || '')
    .trim()
    .replace(/\/+$/, '');
  const serviceRoleKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || store?.getSetting?.('supabaseServiceRoleKey')
    || ''
  ).trim();
  return {
    url,
    serviceRoleKey,
    bucket: CANVA_TEMP_BUCKET,
    configured: Boolean(url && serviceRoleKey)
  };
}

function describeCanvaTempStorage(store = null) {
  const config = readCanvaTempStorageConfig(store);
  return {
    url: config.url,
    configured: config.configured,
    bucket: CANVA_TEMP_BUCKET,
    keySaved: Boolean(config.serviceRoleKey)
  };
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function canvaTempObjectPath({ projectId, checksum, fileName = 'book.pdf' } = {}) {
  const safeProject = String(projectId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeName = String(fileName || 'book.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  const hash = String(checksum || 'pdf').slice(0, 64);
  return `${safeProject}/${hash}-${safeName}`;
}

function storageHeaders(config, extra = {}) {
  return {
    Authorization: `Bearer ${config.serviceRoleKey}`,
    apikey: config.serviceRoleKey,
    ...extra
  };
}

async function storageRequest(config, pathname, {
  method = 'GET',
  headers = {},
  body = null,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw Object.assign(new Error('Fetch is not available for Supabase Storage.'), { code: 'SUPABASE_FETCH_MISSING' });
  }
  const response = await fetchImpl(`${config.url}${pathname}`, { method, headers, body });
  const text = await response.text().catch(() => '');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { ok: response.ok, status: response.status, text, json, response };
}

async function signCanvaTempObject(config, objectPath, { fetchImpl = globalThis.fetch } = {}) {
  const signed = await storageRequest(config, `/storage/v1/object/sign/${encodeURIComponent(config.bucket)}/${objectPath}`, {
    method: 'POST',
    headers: storageHeaders(config, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn: CANVA_TEMP_TTL_SECONDS }),
    fetchImpl
  });
  const path = signed.json?.signedURL || signed.json?.signedUrl || '';
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${config.url}/storage/v1${path.startsWith('/') ? path : `/${path}`}`;
}

async function rememberCanvaImportPdf({
  projectId,
  jobId = null,
  localPath,
  store = null,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!localPath || !existsSync(localPath)) return null;
  const config = readCanvaTempStorageConfig(store);
  if (!config.configured) return null;
  const checksum = sha256File(localPath);
  const bytes = statSync(localPath).size;
  const objectPath = canvaTempObjectPath({ projectId, checksum, fileName: basename(localPath) });
  const fileBytes = readFileSync(localPath);
  const uploaded = await storageRequest(config, `/storage/v1/object/${encodeURIComponent(config.bucket)}/${objectPath}`, {
    method: 'POST',
    headers: storageHeaders(config, {
      'Content-Type': CANVA_TEMP_MIME,
      'x-upsert': 'true',
      'cache-control': `max-age=${CANVA_TEMP_TTL_SECONDS}`
    }),
    body: fileBytes,
    fetchImpl
  });
  if (!uploaded.ok) {
    console.warn('[canva] Supabase temp PDF upload failed:', uploaded.status, uploaded.text?.slice(0, 240));
    return null;
  }
  const signedUrl = await signCanvaTempObject(config, objectPath, { fetchImpl }).catch(() => '');
  const expiresAt = new Date(Date.now() + CANVA_TEMP_TTL_SECONDS * 1000).toISOString();
  const record = {
    bucket: config.bucket,
    objectPath,
    checksum,
    mime: CANVA_TEMP_MIME,
    bytes,
    localPath,
    signedUrl: signedUrl || null,
    expiresAt,
    projectId: String(projectId || ''),
    jobId: jobId || null,
    uploadedAt: new Date().toISOString()
  };
  await storageRequest(config, `/rest/v1/${CANVA_TEMP_TABLE}`, {
    method: 'POST',
    headers: storageHeaders(config, {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    }),
    body: JSON.stringify({
      project_id: record.projectId,
      job_id: record.jobId,
      object_path: objectPath,
      checksum,
      mime: CANVA_TEMP_MIME,
      bytes,
      expires_at: expiresAt
    }),
    fetchImpl
  }).catch(() => null);
  return record;
}

async function restoreCanvaImportPdfIfMissing({
  destPath,
  tempPdf = null,
  store = null,
  fetchImpl = globalThis.fetch
} = {}) {
  if (destPath && existsSync(destPath)) return destPath;
  if (!tempPdf?.objectPath && !tempPdf?.signedUrl) return null;
  const config = readCanvaTempStorageConfig(store);
  if (!config.configured && !tempPdf?.signedUrl) return null;
  const url = tempPdf.signedUrl && (!tempPdf.expiresAt || Date.parse(tempPdf.expiresAt) > Date.now())
    ? tempPdf.signedUrl
    : `${config.url}/storage/v1/object/${encodeURIComponent(tempPdf.bucket || config.bucket)}/${tempPdf.objectPath}`;
  const headers = tempPdf.signedUrl && url === tempPdf.signedUrl
    ? {}
    : storageHeaders(config);
  if (typeof fetchImpl !== 'function') return null;
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    console.warn('[canva] Supabase temp PDF download failed:', response.status);
    return null;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  const body = response.body;
  if (body && typeof body.pipe === 'function') {
    await pipeline(body, createWriteStream(destPath));
  } else {
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(destPath, buffer);
  }
  if (tempPdf.checksum && existsSync(destPath) && sha256File(destPath) !== tempPdf.checksum) {
    console.warn('[canva] Restored temp PDF checksum did not match; keeping the downloaded file anyway.');
  }
  return existsSync(destPath) ? destPath : null;
}

async function forgetCanvaImportPdf({
  tempPdf = null,
  store = null,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!tempPdf?.objectPath) return false;
  const config = readCanvaTempStorageConfig(store);
  if (!config.configured) return false;
  const removed = await storageRequest(config, `/storage/v1/object/${encodeURIComponent(tempPdf.bucket || config.bucket)}/${tempPdf.objectPath}`, {
    method: 'DELETE',
    headers: storageHeaders(config),
    fetchImpl
  });
  await storageRequest(config, `/rest/v1/${CANVA_TEMP_TABLE}?object_path=eq.${encodeURIComponent(tempPdf.objectPath)}`, {
    method: 'DELETE',
    headers: storageHeaders(config),
    fetchImpl
  }).catch(() => null);
  return removed.ok;
}

module.exports = {
  CANVA_TEMP_BUCKET,
  CANVA_TEMP_MIME,
  CANVA_TEMP_TTL_SECONDS,
  readCanvaTempStorageConfig,
  describeCanvaTempStorage,
  sha256File,
  canvaTempObjectPath,
  rememberCanvaImportPdf,
  restoreCanvaImportPdfIfMissing,
  forgetCanvaImportPdf
};
