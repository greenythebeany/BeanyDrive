'use strict';

// The transport the core uses on Android.
//
// The WebView's own fetch can't be used against Discord: the page is served
// from Capacitor's local scheme, so every API call is a cross-origin request
// subject to CORS, and Discord doesn't grant it. CapacitorHttp performs the
// request in native code instead, where CORS doesn't apply.
//
// The catch is the bridge: on Android, request and response bodies cross it as
// strings, so binary has to be base64 and a 10 MB chunk becomes a ~13.3 MB
// string in each direction. That's tolerable for the API calls and metadata
// this file handles, and it is NOT how chunk uploads should be done — those
// belong in a native plugin that never puts the payload on the bridge. This
// adapter exposes only what browsing and downloading need.

const { CapacitorHttp } = require('@capacitor/core');

function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// A fetch-shaped wrapper over the native response, so core/discord-api.js can't
// tell the difference. Only the parts the core actually calls are implemented.
function toResponse(native) {
  const headers = new Map(
    Object.entries(native.headers || {}).map(([k, v]) => [String(k).toLowerCase(), v])
  );
  const status = native.status;
  const data = native.data;

  const asText = () => {
    if (data == null) return '';
    return typeof data === 'string' ? data : JSON.stringify(data);
  };

  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
    text: async () => asText(),
    json: async () => (typeof data === 'string' ? JSON.parse(data) : data),
    arrayBuffer: async () => {
      // responseType 'arraybuffer' comes back base64-encoded across the bridge.
      const bytes = typeof data === 'string' ? base64ToBytes(data) : new Uint8Array(data || []);
      return bytes.buffer;
    },
  };
}

// FormData can't cross the bridge, so the one multipart caller in the core
// (metadata save) is handled by serialising it here. Chunk uploads must not go
// through this path — see the note at the top.
async function serializeBody(body) {
  if (body == null) return { data: undefined, headers: {} };
  if (typeof body === 'string') return { data: body, headers: {} };
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const serialized = new Response(body);
    const contentType = serialized.headers.get('content-type');
    const buf = new Uint8Array(await serialized.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    return {
      data: btoa(binary),
      headers: { 'Content-Type': contentType },
      dataType: 'file',
    };
  }
  throw new Error('Unsupported request body for the native transport');
}

// Drop-in for global fetch, limited to what the core asks of it.
async function nativeFetch(url, opts = {}) {
  const { data, headers: bodyHeaders, dataType } = await serializeBody(opts.body);
  const isBinary = /\/attachments\//.test(url) || /cdn\.discordapp\.com/.test(url);

  if (opts.signal && opts.signal.aborted) {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  }

  const native = await CapacitorHttp.request({
    url,
    method: opts.method || 'GET',
    headers: Object.assign({}, opts.headers || {}, bodyHeaders || {}),
    data,
    dataType,
    responseType: isBinary ? 'arraybuffer' : 'text',
    connectTimeout: 30000,
    readTimeout: 120000,
  });

  return toResponse(native);
}

module.exports = { nativeFetch, base64ToBytes };
