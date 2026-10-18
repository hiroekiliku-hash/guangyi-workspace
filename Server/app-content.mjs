import { createHash } from 'node:crypto';
import publishedContent from './AppContent/catalog.mjs';

export const appContentProtocol = 'WORKSHOP-CONTENT/1';
export const appContentPath = '/api/native/v1/app-content';
const identifier = /^[a-z0-9][a-z0-9-]{0,79}$/;
const kindIdentifier = /^[a-z][a-z0-9-]{0,39}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const packageLimit = 1024 * 1024;
const catalogLimit = 4 * 1024 * 1024;

function encodedPackage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.protocol !== appContentProtocol || typeof value.id !== 'string' || !identifier.test(value.id) ||
      typeof value.kind !== 'string' || !kindIdentifier.test(value.kind) ||
      !Number.isSafeInteger(value.version) || value.version < 1 ||
      !Number.isSafeInteger(value.minimumContentVersion) || value.minimumContentVersion < 1 ||
      !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) {
    throw new Error('INVALID_PUBLISHED_APP_CONTENT');
  }
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  if (bytes.length > packageLimit) throw new Error('PUBLISHED_APP_CONTENT_TOO_LARGE');
  const { id, kind, version, minimumContentVersion } = value;
  const sha256 = digest(bytes);
  return { bytes, entry: { id, kind, version, minimumContentVersion, sha256, byteCount: bytes.length }, etag: `"${sha256}"` };
}

function matchesETag(header, etag) {
  return typeof header === 'string' && header.split(',').some(value => {
    const candidate = value.trim();
    return candidate === '*' || candidate.replace(/^W\//, '') === etag;
  });
}

// Deployment-only JSON is bundled into server.mjs. No filesystem path, user input,
// credentials or writable upload endpoint can change the public catalog.
export function createAppContentAPI(content = publishedContent) {
  if (!Array.isArray(content) || content.length > 32) throw new Error('INVALID_PUBLISHED_APP_CONTENT');
  const packages = new Map();
  let totalBytes = 0;
  for (const value of content) {
    const packet = encodedPackage(value);
    if (packages.has(packet.entry.id)) throw new Error('DUPLICATE_PUBLISHED_APP_CONTENT');
    totalBytes += packet.bytes.length;
    if (totalBytes > catalogLimit) throw new Error('PUBLISHED_APP_CONTENT_CATALOG_TOO_LARGE');
    packages.set(packet.entry.id, packet);
  }
  const entries = [...packages.values()].map(value => value.entry).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const revision = digest(Buffer.from(JSON.stringify(entries), 'utf8'));
  const manifest = Buffer.from(JSON.stringify({ protocol: appContentProtocol, revision, entries }), 'utf8');
  const manifestETag = `"${digest(manifest)}"`;
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=300, must-revalidate',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  function failure(response, status, code, extraHeaders = {}) {
    response.writeHead(status, { ...headers, 'Cache-Control': 'no-store', ...extraHeaders });
    response.end(JSON.stringify({ error: code }));
  }
  return function appContentAPI(request, response, path) {
    if (path !== appContentPath && !path.startsWith(appContentPath + '/')) return false;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // Discard a possible body without buffering it. This channel is read-only.
      request.resume();
      failure(response, 405, 'APP_CONTENT_READ_ONLY', { Allow: 'GET, HEAD' });
      return true;
    }
    let bytes = manifest, etag = manifestETag;
    if (path !== appContentPath) {
      const id = path.slice(appContentPath.length + 1);
      const packet = identifier.test(id) ? packages.get(id) : undefined;
      if (!packet) { failure(response, 404, 'APP_CONTENT_NOT_FOUND'); return true; }
      ({ bytes, etag } = packet);
    }
    if (matchesETag(request.headers['if-none-match'], etag)) {
      response.writeHead(304, { ...headers, ETag: etag });
      response.end();
      return true;
    }
    response.writeHead(200, { ...headers, ETag: etag, 'Content-Length': bytes.length });
    response.end(request.method === 'HEAD' ? undefined : bytes);
    return true;
  };
}
