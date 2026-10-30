'use strict';

// Answers an HTTP Range request for a drive file from the chunks that cover
// it, so a <video> starts playing, and seeks, without the whole file being
// downloaded first. Used by the desktop's app://bundle/stream/<id> handler;
// mobile/native/BeanyNativePlugin.java does the same in Java for Android.

// Most bytes answered for an open-ended range ("bytes=N-"), so a player's
// first request doesn't pull the whole file through.
const STREAM_SPAN = 4 * 1024 * 1024;

function parseRange(header, size) {
  const m = /bytes=(\d*)-(\d*)/.exec(header || '');
  let start = 0;
  let end = Math.min(size - 1, STREAM_SPAN - 1);
  if (m && m[1]) {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : Math.min(size - 1, start + STREAM_SPAN - 1);
  } else if (m && m[2]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  }
  return { start, end };
}

function rangeResponse(drive, fileId, rangeHeader, contentType) {
  const entry = drive.getEntry(fileId);
  if (!entry) return new Response('Not found', { status: 404 });
  const size = entry.size;
  const headers = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const { start, end } = parseRange(rangeHeader, size);
  if (size === 0 || start >= size || start > end) {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  }
  const iter = drive.readRange(fileId, start, end);
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iter.next();
        if (done) controller.close(); else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() { iter.return(); },
  });
  return new Response(body, {
    status: 206,
    headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
  });
}

module.exports = { rangeResponse, parseRange, STREAM_SPAN };
