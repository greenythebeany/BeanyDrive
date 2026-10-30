'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DiscordDrive, DriveLocked, BACKUP_MARKER } = require('../core/drive');
const { CHUNK_OVERHEAD } = require('../core/crypto');
const { createFakeDiscord, createMemoryFiles, createMemoryResumeStore, randomBytes } = require('./fakes');

const CHUNK = 1000;

async function setup({ resume = false } = {}) {
  const discord = createFakeDiscord();
  const local = createMemoryFiles();
  const drive = new DiscordDrive({ api: discord.api, files: local.adapter, resumeStore: resume ? createMemoryResumeStore() : null });
  await drive.connect('token', '123456789012345678', 10, 4);
  drive.chunkSize = CHUNK; // small chunks so a few KB spans several messages
  return { discord, local, drive };
}

async function roundTrip(drive, local, id) {
  await drive.download(id, `/out/${id}`);
  return local.get(`/out/${id}`);
}

test('uploads in chunks and downloads the same bytes', async () => {
  const { drive, local, discord } = await setup();
  const data = randomBytes(4500);
  local.put('/a.bin', data);
  const entry = await drive.upload('/a.bin', 'Docs');
  assert.equal(entry.chunks.length, 5);
  assert.equal(entry.chunkSize, CHUNK);
  assert.match(entry.hash, /^b8:[0-9a-f]{64}$/);
  assert.equal(discord.chunkMessages().length, 5);
  assert.deepEqual(await roundTrip(drive, local, entry.id), data);
  assert.deepEqual(await drive.fetchBytes(entry.id), data);
});

test('empty files upload as one empty chunk', async () => {
  const { drive, local } = await setup();
  local.put('/empty.txt', new Uint8Array(0));
  const entry = await drive.upload('/empty.txt', '');
  assert.equal(entry.chunks.length, 1);
  assert.equal((await drive.fetchBytes(entry.id)).length, 0);
});

test('a failed upload resumes, sending only the missing chunks', async () => {
  const { drive, local, discord } = await setup({ resume: true });
  local.put('/big.bin', randomBytes(6000, 7));
  let posts = 0;
  discord.failNext((m, p) => m === 'POST' && p.endsWith('/messages') && ++posts === 4, Object.assign(new Error('network down'), { status: 500 }));
  drive.uploadConcurrency = 1;
  await assert.rejects(drive.upload('/big.bin', ''), /network down/);
  const before = discord.chunkMessages().length;
  assert.equal(before, 3);
  const entry = await drive.upload('/big.bin', '');
  assert.equal(discord.chunkMessages().length, 6);
  assert.deepEqual(await drive.fetchBytes(entry.id), local.get('/big.bin'));
});

test('a 413 retries the file at half the chunk size', async () => {
  const { drive, local, discord } = await setup();
  local.put('/x.bin', randomBytes(3000, 3));
  discord.failNext((m, p) => m === 'POST' && p.endsWith('/messages'), Object.assign(new Error('too large'), { status: 413 }));
  drive.chunkSize = 2 * 1024 * 1024;
  const entry = await drive.upload('/x.bin', '');
  assert.equal(drive.chunkSize, 1024 * 1024);
  assert.deepEqual(await drive.fetchBytes(entry.id), local.get('/x.bin'));
});

test('duplicates are linked, not uploaded, and shared chunks survive deleting one copy', async () => {
  const { drive, local, discord } = await setup();
  const data = randomBytes(2500, 9);
  local.put('/one.bin', data);
  local.put('/two.bin', data.slice());
  const first = await drive.upload('/one.bin', 'A');
  const again = await drive.upload('/one.bin', 'A');
  assert.equal(again.deduplicated, 'existing');
  const linked = await drive.upload('/two.bin', 'B');
  assert.equal(linked.deduplicated, 'linked');
  assert.equal(discord.chunkMessages().length, 3);
  assert.equal(drive.metadata.files.length, 2);
  assert.deepEqual(linked.chunks, first.chunks);

  await drive.deleteFile(first.id);
  assert.equal(discord.chunkMessages().length, 3, 'chunks still used by the linked copy');
  assert.deepEqual(await drive.fetchBytes(linked.id), data);

  await drive.trashFile(linked.id);
  const res = await drive.emptyTrash();
  assert.deepEqual(res, { files: 1, chunks: 3 });
  assert.equal(discord.chunkMessages().length, 0);
});

test('encryption: chunks are sealed, names hidden, and the key is required', async () => {
  const { drive, local, discord } = await setup();
  const keyB64 = await drive.setupEncryption('correct horse battery');
  assert.ok(drive.metadata.encryption.wrapped);
  const data = new TextEncoder().encode('secret contents '.repeat(200));
  local.put('/secret-plans.txt', data);
  const entry = await drive.upload('/secret-plans.txt', '');
  assert.equal(entry.enc, 1);
  assert.equal(entry.chunkSize, CHUNK - CHUNK_OVERHEAD);

  for (const m of discord.chunkMessages()) {
    assert.ok(!m.content.includes('secret-plans'), 'label hides the name');
    assert.ok(!m.attachments[0].filename.includes('secret-plans'), 'filename hides the name');
    assert.ok(m.attachments[0].size <= CHUNK);
    const stored = new TextDecoder().decode(discord.blobs.get(m.attachments[0].url));
    assert.ok(!stored.includes('secret contents'), 'stored bytes are not plaintext');
  }
  assert.deepEqual(await drive.fetchBytes(entry.id), data);

  drive.lock();
  await assert.rejects(drive.fetchBytes(entry.id), DriveLocked);
  await assert.rejects(drive.unlock('wrong passphrase'), /Wrong passphrase/);
  assert.equal(await drive.unlockWithStoredKey(keyB64), true);
  assert.deepEqual(await drive.fetchBytes(entry.id), data);

  await drive.changePassphrase('a new passphrase');
  drive.lock();
  await assert.rejects(drive.unlock('correct horse battery'), /Wrong passphrase/);
  await drive.unlock('a new passphrase');
  assert.deepEqual(await drive.fetchBytes(entry.id), data, 'same data key after a passphrase change');
});

test('encrypted duplicates link and still decrypt', async () => {
  const { drive, local } = await setup();
  await drive.setupEncryption('passphrase-123');
  const data = randomBytes(2200, 4);
  local.put('/p.bin', data);
  local.put('/q.bin', data.slice());
  await drive.upload('/p.bin', 'A');
  const linked = await drive.upload('/q.bin', 'B');
  assert.equal(linked.deduplicated, 'linked');
  assert.deepEqual(await drive.fetchBytes(linked.id), data);
});

test('readRange returns exact byte ranges across chunk boundaries', async () => {
  const { drive, local } = await setup();
  const data = randomBytes(5300, 11);
  local.put('/v.mp4', data);
  const entry = await drive.upload('/v.mp4', '');
  const read = async (s, e) => {
    const parts = [];
    for await (const p of drive.readRange(entry.id, s, e)) parts.push(...p);
    return Uint8Array.from(parts);
  };
  assert.deepEqual(await read(0, 99), data.slice(0, 100));
  assert.deepEqual(await read(950, 2050), data.slice(950, 2051));
  assert.deepEqual(await read(5000, 99999), data.slice(5000));

  // Entries from before chunkSize was recorded fall back to the first chunk's size.
  delete entry.chunkSize;
  drive._chunkSizeCache.clear();
  assert.deepEqual(await read(1999, 3001), data.slice(1999, 3002));
});

test('readRange decrypts encrypted files', async () => {
  const { drive, local } = await setup();
  await drive.setupEncryption('passphrase-123');
  const data = randomBytes(4000, 12);
  local.put('/e.mp4', data);
  const entry = await drive.upload('/e.mp4', '');
  const parts = [];
  for await (const p of drive.readRange(entry.id, 1500, 3500)) parts.push(...p);
  assert.deepEqual(Uint8Array.from(parts), data.slice(1500, 3501));
});

test('index backups are kept at most once per interval and can be restored', async () => {
  const { drive, local, discord } = await setup();
  local.put('/1.txt', randomBytes(10, 1));
  await drive.upload('/1.txt', '');
  await drive.createFolder('First');
  await drive.createFolder('Second');
  assert.equal(drive.metadata.backups.length, 1, 'later saves within the interval replace, not back up');
  drive.metadata.backups[0].at -= 31 * 60 * 1000;
  await drive.createFolder('Third');
  assert.equal(drive.metadata.backups.length, 2);

  const pinned = [...discord.messages.values()].filter((m) => m.pinned);
  assert.equal(pinned.length, 1, 'only the live index stays pinned');
  for (const b of drive.metadata.backups) {
    assert.ok(discord.messages.get(b.id).content.startsWith(BACKUP_MARKER));
  }

  const firstBackup = drive.listBackups().at(-1);
  await drive.restoreBackup(firstBackup.id);
  assert.deepEqual(drive.metadata.folders, []);
  assert.equal(drive.metadata.files.length, 1);

  // A fresh load sees the restored index.
  await drive.loadMetadata();
  assert.deepEqual(drive.metadata.folders, []);
});

test('check drive finds broken files and orphans, and repairs them', async () => {
  const { drive, local, discord } = await setup();
  local.put('/keep.bin', randomBytes(2500, 21));
  local.put('/lost.bin', randomBytes(2500, 22));
  local.put('/broken.bin', randomBytes(2500, 23));
  const keep = await drive.upload('/keep.bin', 'Docs');
  const lost = await drive.upload('/lost.bin', 'Docs');
  const broken = await drive.upload('/broken.bin', 'Docs');

  // Lose one file from the index; delete a chunk of another by hand.
  drive.metadata.files = drive.metadata.files.filter((f) => f.id !== lost.id);
  await drive.saveMetadata();
  discord.messages.delete(broken.chunks[1]);

  const report = await drive.checkDrive();
  assert.deepEqual(report.broken.map((b) => b.id), [broken.id]);
  assert.equal(report.broken[0].missing, 1);
  assert.equal(report.orphans.length, 1);
  assert.equal(report.orphans[0].fileId, lost.id);
  assert.equal(report.orphans[0].name, 'lost.bin');
  assert.equal(report.orphans[0].complete, true);
  assert.equal(report.orphans[0].size, 2500);
  assert.ok(report.indexes.some((x) => x.live));

  assert.equal(await drive.recoverOrphans([lost.id]), 1);
  const back = drive.getEntry(lost.id);
  assert.equal(back.path, 'Recovered');
  assert.deepEqual(await drive.fetchBytes(lost.id), local.get('/lost.bin'));

  assert.equal(await drive.removeBroken([broken.id]), 1);
  assert.equal(drive.getEntry(broken.id), null);
  assert.ok(drive.getEntry(keep.id));
  const after = await drive.checkDrive();
  assert.equal(after.broken.length, 0);
  assert.equal(after.orphans.length, 0);
});

test('check drive rebuilds a drive whose index is gone', async () => {
  const { drive, local, discord } = await setup();
  await drive.setupEncryption('passphrase-123');
  local.put('/a.bin', randomBytes(1800, 31));
  const a = await drive.upload('/a.bin', '');
  for (const m of [...discord.messages.values()]) if (!/chunk/.test(m.content)) discord.messages.delete(m.id);
  const keyRaw = drive.keyRaw;
  await drive.loadMetadata();
  assert.equal(drive.metadata.files.length, 0);
  const report = await drive.checkDrive();
  assert.equal(report.orphans.length, 1);
  assert.equal(report.orphans[0].enc, true);
  assert.equal(report.orphans[0].size, 1800);
  await drive.recoverOrphans([a.id]);
  // The data key still decrypts it, given the same key on the device.
  drive.key = await require('../core/crypto').importDataKey(keyRaw);
  assert.deepEqual(await drive.fetchBytes(a.id), local.get('/a.bin'));
});

test('orphans can be deleted', async () => {
  const { drive, local, discord } = await setup();
  local.put('/z.bin', randomBytes(2100, 41));
  const z = await drive.upload('/z.bin', '');
  drive.metadata.files = [];
  await drive.saveMetadata();
  const report = await drive.checkDrive();
  assert.equal(report.orphans.length, 1);
  assert.equal(await drive.deleteOrphans([z.id]), 3);
  assert.equal(discord.chunkMessages().length, 0);
});
