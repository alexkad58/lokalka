import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { decode, encode, Decoder } from '../shared/txqr.js';

function createRandomBytes(size) {
  return new Uint8Array(randomBytes(size));
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = (index * 17 + 5) % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

test('TXQR restores random bytes after shuffle and frame loss', () => {
  const source = createRandomBytes(8192);
  const frames = encode(source, {
    chunkSize: 256,
    redundancy: 0.75,
    sessionId: 'test-session'
  });

  const transmitted = shuffle(frames).filter((_, index) => index % 4 !== 0);
  const restored = decode(transmitted);

  assert.deepEqual([...restored], [...source]);
});

test('TXQR decoder accepts frames incrementally and ignores duplicates', () => {
  const source = createRandomBytes(1025);
  const frames = encode(source, { chunkSize: 128, redundancy: 1, sessionId: 'incremental' });
  const decoder = new Decoder();

  for (const frame of [...frames.slice(0, 2), frames[0], ...frames.slice(2)]) {
    decoder.addFrame(frame);
  }

  assert.equal(decoder.isComplete(), true);
  assert.deepEqual([...decoder.data()], [...source]);
});

test('TXQR rejects incomplete transfers', () => {
  const frames = encode(createRandomBytes(2048), { chunkSize: 128, redundancy: 0.5, sessionId: 'incomplete' });
  assert.throws(() => decode(frames.slice(0, 2)), /incomplete/i);
});