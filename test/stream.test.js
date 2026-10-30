'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DiscordDrive } = require('../core/drive');
const { rangeResponse, parseRange, STREAM_SPAN } = require('../core/stream');
const { createFakeDiscord, createMemoryFiles, randomBytes } = require('./fakes');

async function driveWithFile(size) {
  const discord = createFakeDiscord();
  const local = createMemoryFiles();
  const drive = new DiscordDrive({ api: discord.api, files: local.adapter });
  await drive.connect('token', '123456789012345678', 10, 4);
  drive.chunkSize = 1000;
  const data = randomBytes(size, 5);
  local.put('/clip.mp4', data);
  const entry = await drive.upload('/clip.mp4', '');
  return { drive, data, entry };
}

test('parseRange handles open, closed and suffix ranges', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange(null, 10 * STREAM_SPAN), { start: 0, end: STREAM_SPAN - 1 });
  assert.deepEqual(parseRange('bytes=0-', 10 * STREAM_SPAN), { start: 0, end: STREAM_SPAN - 1 });
});

test('rangeResponse answers 206 with the right bytes and headers', async () => {
  const { drive, data, entry } = await driveWithFile(3500);
  const res = rangeResponse(drive, entry.id, 'bytes=900-2100', 'video/mp4');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 900-2100/3500');
  assert.equal(res.headers.get('content-length'), '1201');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), data.slice(900, 2101));
});

test('rangeResponse rejects ranges past the end and unknown files', async () => {
  const { drive, entry } = await driveWithFile(100);
  assert.equal(rangeResponse(drive, entry.id, 'bytes=100-', 'video/mp4').status, 416);
  assert.equal(rangeResponse(drive, 'nope', 'bytes=0-', 'video/mp4').status, 404);
});
