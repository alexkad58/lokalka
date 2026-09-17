const PROTOCOL_VERSION = 'TXQR1';
const DEFAULT_CHUNK_SIZE = 700;
const DEFAULT_REDUNDANCY = 0.5;
const MAX_CHUNK_SIZE = 4096;

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint16Array(256);

let fieldValue = 1;
for (let index = 0; index < 255; index += 1) {
  GF_EXP[index] = fieldValue;
  GF_LOG[fieldValue] = index;
  fieldValue <<= 1;
  if (fieldValue & 0x100) fieldValue ^= 0x11d;
}
for (let index = 255; index < GF_EXP.length; index += 1) {
  GF_EXP[index] = GF_EXP[index - 255];
}

function multiplyGf(left, right) {
  if (left === 0 || right === 0) return 0;
  return GF_EXP[GF_LOG[left] + GF_LOG[right]];
}

function inverseGf(value) {
  if (!value) throw new Error('Cannot invert zero in GF(256)');
  return GF_EXP[255 - GF_LOG[value]];
}

function xorInto(target, source, multiplier = 1) {
  if (multiplier === 0) return;
  for (let index = 0; index < target.length; index += 1) {
    target[index] ^= multiplier === 1
      ? source[index]
      : multiplyGf(source[index], multiplier);
  }
}

function hash32(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function parityCoefficient(sessionId, parityIndex, dataIndex) {
  const hash = hash32(`${sessionId}:${parityIndex}:${dataIndex}`);
  return (hash & 0xff) || 1;
}

function randomSessionId() {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const base64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  return Uint8Array.from(Buffer.from(padded, 'base64'));
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('TXQR data must be a Uint8Array or ArrayBuffer');
}

function parseFrame(frame) {
  const parts = String(frame || '').split('|');
  if (parts.length !== 2) throw new Error('Invalid TXQR frame');

  const header = parts[0].split(':');
  if (header.length !== 7 || header[0] !== PROTOCOL_VERSION) {
    throw new Error('Invalid TXQR frame header');
  }

  const [, sessionId, sizeText, chunkSizeText, dataCountText, parityCountText, indexText] = header;
  const size = Number(sizeText);
  const chunkSize = Number(chunkSizeText);
  const dataCount = Number(dataCountText);
  const parityCount = Number(parityCountText);
  const index = Number(indexText);

  if (![size, chunkSize, dataCount, parityCount, index].every(Number.isSafeInteger)
    || size < 0 || chunkSize < 1 || dataCount < 1 || parityCount < 1
    || index < 0 || index >= dataCount + parityCount) {
    throw new Error('Invalid TXQR frame metadata');
  }

  return {
    sessionId,
    size,
    chunkSize,
    dataCount,
    parityCount,
    index,
    payload: base64UrlToBytes(parts[1])
  };
}

function assertCompatibleMetadata(left, right) {
  for (const key of ['sessionId', 'size', 'chunkSize', 'dataCount', 'parityCount']) {
    if (left[key] !== right[key]) throw new Error('TXQR frames belong to different transfers');
  }
}

export function encode(data, options = {}) {
  const bytes = toUint8Array(data);
  const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
  const redundancy = options.redundancy ?? DEFAULT_REDUNDANCY;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 32 || chunkSize > MAX_CHUNK_SIZE) {
    throw new RangeError(`TXQR chunkSize must be between 32 and ${MAX_CHUNK_SIZE}`);
  }
  if (!Number.isFinite(redundancy) || redundancy <= 0) throw new RangeError('TXQR redundancy must be positive');

  const dataCount = Math.max(1, Math.ceil(bytes.length / chunkSize));
  const parityCount = Math.max(1, Math.ceil(dataCount * redundancy));
  const sessionId = options.sessionId || randomSessionId();
  const frames = [];
  const prefix = `${PROTOCOL_VERSION}:${sessionId}:${bytes.length}:${chunkSize}:${dataCount}:${parityCount}`;

  for (let dataIndex = 0; dataIndex < dataCount; dataIndex += 1) {
    const chunk = new Uint8Array(chunkSize);
    chunk.set(bytes.subarray(dataIndex * chunkSize, (dataIndex + 1) * chunkSize));
    frames.push(`${prefix}:${dataIndex}|${bytesToBase64Url(chunk)}`);
  }

  for (let parityIndex = 0; parityIndex < parityCount; parityIndex += 1) {
    const parity = new Uint8Array(chunkSize);
    for (let dataIndex = 0; dataIndex < dataCount; dataIndex += 1) {
      const chunk = bytes.subarray(dataIndex * chunkSize, (dataIndex + 1) * chunkSize);
      xorInto(parity, chunk, parityCoefficient(sessionId, parityIndex, dataIndex));
    }
    frames.push(`${prefix}:${dataCount + parityIndex}|${bytesToBase64Url(parity)}`);
  }

  return frames;
}

export class Decoder {
  constructor() {
    this.metadata = null;
    this.dataFrames = new Map();
    this.parityFrames = new Map();
    this.decoded = null;
  }

  addFrame(frame) {
    const parsed = parseFrame(frame);
    if (this.metadata) assertCompatibleMetadata(this.metadata, parsed);
    else this.metadata = parsed;
    if (parsed.payload.length !== parsed.chunkSize) throw new Error('Invalid TXQR payload length');

    if (parsed.index < parsed.dataCount) this.dataFrames.set(parsed.index, parsed.payload);
    else this.parityFrames.set(parsed.index - parsed.dataCount, parsed.payload);
    this.decoded = null;
    return this.isComplete();
  }

  isComplete() {
    return Boolean(this.decoded || this.#tryDecode());
  }

  data() {
    if (!this.isComplete()) throw new Error('TXQR transfer is incomplete');
    return this.decoded;
  }

  progress() {
    if (!this.metadata) return { received: 0, required: 0, percent: 0 };
    const required = this.metadata.dataCount;
    const received = Math.min(required, this.dataFrames.size + this.parityFrames.size);
    return {
      received,
      required,
      percent: Math.round((received / required) * 100)
    };
  }

  #tryDecode() {
    if (!this.metadata) return false;
    const { dataCount, chunkSize, size, sessionId } = this.metadata;
    const missing = [];
    for (let index = 0; index < dataCount; index += 1) {
      if (!this.dataFrames.has(index)) missing.push(index);
    }

    if (!missing.length) {
      this.decoded = joinChunks(this.dataFrames, dataCount, chunkSize, size);
      return true;
    }
    if (this.parityFrames.size < missing.length) return false;

    const rows = [];
    for (const [parityIndex, parity] of this.parityFrames) {
      const coefficients = new Uint8Array(missing.length);
      const right = new Uint8Array(parity);
      for (let missingIndex = 0; missingIndex < missing.length; missingIndex += 1) {
        const dataIndex = missing[missingIndex];
        coefficients[missingIndex] = parityCoefficient(sessionId, parityIndex, dataIndex);
      }
      for (const [knownIndex, knownChunk] of this.dataFrames) {
        xorInto(right, knownChunk, parityCoefficient(sessionId, parityIndex, knownIndex));
      }
      rows.push({ coefficients, right });
    }

    const solutions = solveRows(rows, missing.length);
    if (!solutions) return false;
    solutions.forEach((chunk, index) => this.dataFrames.set(missing[index], chunk));
    this.decoded = joinChunks(this.dataFrames, dataCount, chunkSize, size);
    return true;
  }
}

function solveRows(rows, variableCount) {
  let pivotRow = 0;
  const pivotColumns = [];

  for (let column = 0; column < variableCount && pivotRow < rows.length; column += 1) {
    const candidate = rows.findIndex((row, index) => index >= pivotRow && row.coefficients[column]);
    if (candidate === -1) continue;
    [rows[pivotRow], rows[candidate]] = [rows[candidate], rows[pivotRow]];

    const pivot = rows[pivotRow];
    const scale = inverseGf(pivot.coefficients[column]);
    for (let index = column; index < variableCount; index += 1) {
      pivot.coefficients[index] = multiplyGf(pivot.coefficients[index], scale);
    }
    for (let index = 0; index < pivot.right.length; index += 1) {
      pivot.right[index] = multiplyGf(pivot.right[index], scale);
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      if (rowIndex === pivotRow) continue;
      const row = rows[rowIndex];
      const factor = row.coefficients[column];
      if (!factor) continue;
      for (let index = column; index < variableCount; index += 1) {
        row.coefficients[index] ^= multiplyGf(pivot.coefficients[index], factor);
      }
      xorInto(row.right, pivot.right, factor);
    }

    pivotColumns.push(column);
    pivotRow += 1;
  }

  if (pivotColumns.length !== variableCount) return null;
  return pivotColumns.map((column, rowIndex) => new Uint8Array(rows[rowIndex].right));
}

function joinChunks(chunks, dataCount, chunkSize, size) {
  const output = new Uint8Array(size);
  for (let index = 0; index < dataCount; index += 1) {
    const offset = index * chunkSize;
    output.set(chunks.get(index).subarray(0, Math.min(chunkSize, size - offset)), offset);
  }
  return output;
}

export function decode(frames) {
  const decoder = new Decoder();
  for (const frame of frames) decoder.addFrame(frame);
  return decoder.data();
}

export const txqr = { encode, decode, Decoder };