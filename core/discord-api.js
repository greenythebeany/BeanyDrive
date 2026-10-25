'use strict';

// Talking to Discord over REST. No gateway connection: every operation used here
// — sending, fetching, deleting and pinning channel messages — has a REST
// endpoint, and REST message fetches always include full content regardless of
// the privileged Message Content Intent (that restriction only applies to
// gateway-dispatched events).
//
// `fetchImpl` is injectable because Android can't use the WebView's fetch for
// this: the request would be subject to CORS and the response to the origin's
// rules, so the Capacitor build passes a native-backed implementation instead.

const API_BASE = 'https://discord.com/api/v10';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tierLimitBytes(premiumTier) {
  if (premiumTier === 3) return 100 * 1024 * 1024;
  if (premiumTier === 2) return 50 * 1024 * 1024;
  return 10 * 1024 * 1024; // tier 0/1: current Discord baseline upload limit
}

// Reads a response body exactly once and fully, then parses it if it happens to
// be JSON. Discord's own errors are JSON, but the ones that come from Cloudflare
// in front of it (429s under load, 5xx) are HTML — and res.json() on those
// rejects partway through, leaving the response stream half-read.
async function readBody(res) {
  let text = '';
  try { text = await res.text(); } catch (e) { /* connection died mid-body */ }
  try { return { text, data: text ? JSON.parse(text) : {} }; } catch (e) { return { text, data: {} }; }
}

async function responseError(res) {
  const { text, data } = await readBody(res);
  // Fall back to a snippet of a non-JSON body — "Discord API error 429" alone
  // hides whether it came from Discord or the proxy in front of it.
  const snippet = text ? text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const err = new Error(data.message || snippet || `Discord API error ${res.status}`);
  err.status = res.status;
  err.code = data.code;
  return err;
}

// Discord rate-limits per route, where a route is the method plus the path with
// its major parameter (the channel) kept and every other id collapsed. Message
// ids differ on every chunk but all share one bucket.
function routeKey(method, pathname) {
  const path = pathname.split('?')[0].replace(/\d{15,}/g, (id, off) => (off === '/channels/'.length && pathname.startsWith('/channels/') ? id : ':id'));
  return `${method} ${path}`;
}

function createApi({ fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));

  // Waits for a route whose bucket is spent before sending, using the
  // X-RateLimit headers of the previous response. Parallel chunk workers then
  // queue up client-side instead of firing into a 429 and backing off blind —
  // Discord counts repeated 429s against the bot, and a blind retry waits
  // longer than the bucket actually needed.
  const blockedUntil = new Map(); // route → epoch ms
  let globalUntil = 0;

  async function waitForRoute(route) {
    for (;;) {
      const until = Math.max(globalUntil, blockedUntil.get(route) || 0);
      const wait = until - Date.now();
      if (wait <= 0) return;
      await sleep(wait + 25);
    }
  }

  function noteLimits(route, res) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const resetAfter = parseFloat(res.headers.get('x-ratelimit-reset-after'));
    if (remaining !== null && Number(remaining) <= 0 && Number.isFinite(resetAfter)) {
      blockedUntil.set(route, Date.now() + Math.ceil(resetAfter * 1000));
    }
  }

  async function request(token, pathname, opts = {}) {
    const headers = Object.assign({ Authorization: `Bot ${token}` }, opts.headers || {});
    const route = routeKey(opts.method || 'GET', pathname);
    let attempt = 0;
    for (;;) {
      await waitForRoute(route);
      if (opts.signal && opts.signal.aborted) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      const res = await doFetch(`${API_BASE}${pathname}`, { ...opts, headers });
      noteLimits(route, res);
      if (res.status === 429) {
        attempt += 1;
        // Read the body before deciding, so it's drained either way — a 429 whose
        // body is never consumed is the one response we produce a lot of.
        const { text, data } = await readBody(res);
        if (attempt > 5) {
          const err = new Error(data.message || 'Discord API error 429 (rate limited)');
          err.status = 429;
          err.code = data.code;
          err.body = text.slice(0, 200);
          throw err;
        }
        const retryMs = Math.ceil((data.retry_after || 1) * 1000);
        if (data.global) globalUntil = Date.now() + retryMs;
        else blockedUntil.set(route, Date.now() + retryMs);
        continue;
      }
      if (!res.ok) throw await responseError(res);
      if (res.status === 204) return null;
      const ct = res.headers.get('content-type') || '';
      return ct.includes('application/json') ? res.json() : res.text();
    }
  }

  // Attachment downloads go straight to Discord's CDN, not the API — no bot
  // token, no rate-limit dance, but the same injected transport.
  //
  // `responseType` is stated rather than inferred: a transport that guesses
  // binary-vs-text from the URL gets metadata wrong, since the metadata index
  // is itself an attachment. Plain fetch ignores the extra init field.
  async function fetchBinary(url) {
    const res = await doFetch(url, { responseType: 'arraybuffer' });
    if (!res.ok) throw new Error(`Attachment download failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function fetchText(url) {
    const res = await doFetch(url, { responseType: 'text' });
    if (!res.ok) throw new Error(`Attachment download failed (${res.status})`);
    return res.text();
  }

  async function testConnection(token, channelId) {
    const channel = await request(token, `/channels/${channelId}`);
    if (channel.type !== 0) throw new Error('Configured channel is not a text channel');
    const guild = await request(token, `/guilds/${channel.guild_id}`);
    return { channelName: channel.name, guildName: guild.name };
  }

  return { request, fetchBinary, fetchText, testConnection };
}

module.exports = { createApi, tierLimitBytes, readBody, responseError, API_BASE };
