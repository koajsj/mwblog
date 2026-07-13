const SBOX = new Uint8Array([
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
]);

const encoder = new TextEncoder();
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

function xtime(value) {
  return ((value << 1) ^ ((value & 0x80) ? 0x1b : 0)) & 0xff;
}

export function expandAes256Key(key) {
  if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error("AES-256 requires a 32-byte key.");
  const expanded = new Uint8Array(240);
  expanded.set(key);
  let generated = 32;
  let rcon = 1;
  const temp = new Uint8Array(4);
  while (generated < expanded.length) {
    temp.set(expanded.subarray(generated - 4, generated));
    if (generated % 32 === 0) {
      const first = temp[0];
      temp[0] = SBOX[temp[1]] ^ rcon;
      temp[1] = SBOX[temp[2]];
      temp[2] = SBOX[temp[3]];
      temp[3] = SBOX[first];
      rcon = xtime(rcon);
    } else if (generated % 32 === 16) {
      for (let index = 0; index < 4; index += 1) temp[index] = SBOX[temp[index]];
    }
    for (let index = 0; index < 4; index += 1) {
      expanded[generated] = expanded[generated - 32] ^ temp[index];
      generated += 1;
    }
  }
  return expanded;
}

function addRoundKey(state, expanded, round) {
  const offset = round * 16;
  for (let index = 0; index < 16; index += 1) state[index] ^= expanded[offset + index];
}

function shiftRows(state) {
  const copy = state.slice();
  state[1]=copy[5]; state[5]=copy[9]; state[9]=copy[13]; state[13]=copy[1];
  state[2]=copy[10]; state[6]=copy[14]; state[10]=copy[2]; state[14]=copy[6];
  state[3]=copy[15]; state[7]=copy[3]; state[11]=copy[7]; state[15]=copy[11];
}

function mixColumns(state) {
  for (let column = 0; column < 4; column += 1) {
    const offset = column * 4;
    const a0 = state[offset];
    const a1 = state[offset + 1];
    const a2 = state[offset + 2];
    const a3 = state[offset + 3];
    const all = a0 ^ a1 ^ a2 ^ a3;
    state[offset] ^= all ^ xtime(a0 ^ a1);
    state[offset + 1] ^= all ^ xtime(a1 ^ a2);
    state[offset + 2] ^= all ^ xtime(a2 ^ a3);
    state[offset + 3] ^= all ^ xtime(a3 ^ a0);
  }
}

export function encryptAes256Block(block, expandedKey) {
  if (!(block instanceof Uint8Array) || block.length !== 16) throw new Error("AES block must be 16 bytes.");
  const state = block.slice();
  addRoundKey(state, expandedKey, 0);
  for (let round = 1; round < 14; round += 1) {
    for (let index = 0; index < 16; index += 1) state[index] = SBOX[state[index]];
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, expandedKey, round);
  }
  for (let index = 0; index < 16; index += 1) state[index] = SBOX[state[index]];
  shiftRows(state);
  addRoundKey(state, expandedKey, 14);
  return state;
}

function encryptWinZipCtr(input, key) {
  const output = new Uint8Array(input.length);
  const expanded = expandAes256Key(key);
  const counter = new Uint8Array(16);
  let blockNumber = 1;
  for (let offset = 0; offset < input.length; offset += 16) {
    counter.fill(0);
    let value = blockNumber;
    for (let index = 0; index < 8 && value > 0; index += 1) {
      counter[index] = value & 0xff;
      value = Math.floor(value / 256);
    }
    const stream = encryptAes256Block(counter, expanded);
    const length = Math.min(16, input.length - offset);
    for (let index = 0; index < length; index += 1) output[offset + index] = input[offset + index] ^ stream[index];
    blockNumber += 1;
  }
  expanded.fill(0);
  return output;
}

function write16(view, offset, value) { view.setUint16(offset, value, true); }
function write32(view, offset, value) { view.setUint32(offset, value, true); }

function aesExtra() {
  const bytes = new Uint8Array(11);
  const view = new DataView(bytes.buffer);
  write16(view, 0, 0x9901);
  write16(view, 2, 7);
  write16(view, 4, 2);
  bytes[6] = 0x41;
  bytes[7] = 0x45;
  bytes[8] = 3;
  write16(view, 9, 0);
  return bytes;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

async function encryptEntry(data, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-1", salt, iterations: 1000 }, baseKey, 528));
  const encryptionKey = derived.slice(0, 32);
  const authenticationKey = derived.slice(32, 64);
  const verification = derived.slice(64, 66);
  const ciphertext = encryptWinZipCtr(data, encryptionKey);
  const hmacKey = await crypto.subtle.importKey("raw", authenticationKey, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const authentication = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, ciphertext)).slice(0, 10);
  encryptionKey.fill(0);
  authenticationKey.fill(0);
  derived.fill(0);
  return { salt, verification, ciphertext, authentication };
}

function localHeader(name, encryptedSize, plainSize, date) {
  const extra = aesExtra();
  const bytes = new Uint8Array(30 + name.length + extra.length);
  const view = new DataView(bytes.buffer);
  const stamp = dosDateTime(date);
  write32(view, 0, 0x04034b50);
  write16(view, 4, 51);
  write16(view, 6, 0x0801);
  write16(view, 8, 99);
  write16(view, 10, stamp.time);
  write16(view, 12, stamp.date);
  write32(view, 14, 0);
  write32(view, 18, encryptedSize);
  write32(view, 22, plainSize);
  write16(view, 26, name.length);
  write16(view, 28, extra.length);
  bytes.set(name, 30);
  bytes.set(extra, 30 + name.length);
  return bytes;
}

function centralHeader(name, encryptedSize, plainSize, date, offset) {
  const extra = aesExtra();
  const bytes = new Uint8Array(46 + name.length + extra.length);
  const view = new DataView(bytes.buffer);
  const stamp = dosDateTime(date);
  write32(view, 0, 0x02014b50);
  write16(view, 4, 51);
  write16(view, 6, 51);
  write16(view, 8, 0x0801);
  write16(view, 10, 99);
  write16(view, 12, stamp.time);
  write16(view, 14, stamp.date);
  write32(view, 16, 0);
  write32(view, 20, encryptedSize);
  write32(view, 24, plainSize);
  write16(view, 28, name.length);
  write16(view, 30, extra.length);
  write32(view, 42, offset);
  bytes.set(name, 46);
  bytes.set(extra, 46 + name.length);
  return bytes;
}

function endRecord(entries, centralSize, centralOffset) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  write32(view, 0, 0x06054b50);
  write16(view, 8, entries);
  write16(view, 10, entries);
  write32(view, 12, centralSize);
  write32(view, 16, centralOffset);
  return bytes;
}

export async function createAesZip(files, password, onProgress) {
  if (!Array.isArray(files) || !files.length) throw new Error("There is nothing to export.");
  if (typeof password !== "string" || password.length < 12) throw new Error("Archive password must be at least 12 characters.");
  const total = files.reduce((sum, file) => sum + file.data.byteLength, 0);
  if (total > MAX_ARCHIVE_BYTES) throw new Error("Readable export is limited to 512 MB per archive. Export after removing unusually large files.");

  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const name = encoder.encode(String(file.name || "file").replaceAll("\\", "/"));
    if (!name.length || name.length > 65535 || file.data.byteLength > 0xffffffff) throw new Error("An export filename or file is too large.");
    const encrypted = await encryptEntry(file.data, password);
    const encryptedSize = encrypted.salt.length + encrypted.verification.length + encrypted.ciphertext.length + encrypted.authentication.length;
    const header = localHeader(name, encryptedSize, file.data.length, now);
    parts.push(header, encrypted.salt, encrypted.verification, encrypted.ciphertext, encrypted.authentication);
    central.push(centralHeader(name, encryptedSize, file.data.length, now, offset));
    offset += header.length + encryptedSize;
    if (onProgress) onProgress(index + 1, files.length);
  }
  const centralOffset = offset;
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  parts.push(...central, endRecord(files.length, centralSize, centralOffset));
  return new Blob(parts, { type: "application/zip" });
}
