'use strict';

// The transport the core uses on Android.
//
// Discord's CORS policy is asymmetric, which decides the whole design here.
// Measured from a browser origin:
//
//   GET                      allowed
//   GET + Authorization      allowed (preflight passes)
//   POST/DELETE + Auth       BLOCKED (preflight fails)
//
// So reads — metadata, message lookups, CDN chunk downloads — go through the
// WebView's own fetch, which gives real binary and real streaming with nothing
// crossing the JS bridge. Only writes need the native path, where the body has
// to be base64 because Android's bridge carries strings.
//
// This split is also why CapacitorHttp must NOT be enabled globally in
// capacitor.config.json: that patches window.fetch to route everything through
// native, which would drag reads back onto the bridge and re-break binary.

const { CapacitorHttp } = require('@capacitor/core');

function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000; // chunked to stay under the argument limit
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

// A fetch-shaped wrapper over the native response, so core/discord-api.js can't
// tell which path a request took. Only what the core calls is implemented.
function toResponse(native) {
  const headers = new Map(
    Object.entries(native.headers || {}).map(([k, v]) => [String(k).toLowerCase(), v])
  );
  const status = native.status;
  const data = native.data;
  const asText = () => (data == null ? '' : (typeof data === 'string' ? data : JSON.stringify(data)));

  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
    text: async () => asText(),
    json: async () => (typeof data === 'string' ? JSON.parse(data) : data),
    arrayBuffer: async () => base64ToBytes(asText()).buffer,
  };
}

// FormData can't cross the bridge, so it's serialised here — exactly as fetch
// would, via Response, which also produces the matching multipart boundary.
async function serializeBody(body) {
  if (body == null) return {};
  if (typeof body === 'string') return { data: body };
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const serialized = new Response(body);
    const contentType = serialized.headers.get('content-type');
    const bytes = new Uint8Array(await serialized.arrayBuffer());
    return { data: bytesToBase64(bytes), headers: { 'Content-Type': contentType }, dataType: 'file' };
  }
  throw new Error('Unsupported request body for the native transport');
}

function abortError() {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

// Drop-in for global fetch, routing by method per the CORS table above.
async function nativeFetch(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();

  if (method === 'GET') {
    // Straight through the WebView: real binary, no base64, no bridge.
    return fetch(url, opts);
  }

  if (opts.signal && opts.signal.aborted) throw abortError();

  const serialized = await serializeBody(opts.body);
  const request = CapacitorHttp.request({
    url,
    method,
    headers: Object.assign({}, opts.headers || {}, serialized.headers || {}),
    data: serialized.data,
    dataType: serialized.dataType,
    responseType: 'text',
    connectTimeout: 30000,
    readTimeout: 180000, // a 10 MB chunk on a phone connection
  });

  // CapacitorHttp has no cancellation of its own, so an abort stops the caller
  // waiting; the request itself finishes in the background. That's enough for
  // pause/cancel to feel immediate, and the chunk it was sending is either
  // recorded by the retry or cleaned up as an orphan.
  if (!opts.signal) return toResponse(await request);
  return toResponse(await Promise.race([
    request,
    new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(abortError()), { once: true })),
  ]));
}

module.exports = { nativeFetch, base64ToBytes, bytesToBase64 };
