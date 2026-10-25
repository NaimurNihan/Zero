import { createHash } from "node:crypto";
import { MsEdgeTTS } from "msedge-tts";

const WINDOWS_FILE_TIME_EPOCH_SECONDS = 11_644_473_600n;
const TICKS_PER_SECOND = 10_000_000n;
const TOKEN_WINDOW_SECONDS = 300n;
const EDGE_TTS_V2_VERSION = "2-143.0.3650.96";
const EDGE_TTS_V2_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

const PREFIX = Buffer.from(
  "Copyright (C) Microsoft Corporation. All rights reserved.",
  "ascii",
);

const CS64_COEFFICIENTS: ReadonlyArray<readonly [number, number]> = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];

const multiply32 = Math.imul;

function rotate16(value: number): number {
  return ((value << 16) | (value >>> 16)) >>> 0;
}

function createCs64Digest(data: Buffer, shaDigest: Buffer): Buffer {
  const keyA = (shaDigest.readUInt32LE(0) | 1) >>> 0;
  const keyB = (shaDigest.readUInt32LE(4) | 1) >>> 0;
  const factors = [
    multiply32(keyA, 0x82893933) >>> 0,
    multiply32(keyB, 0x82893933) >>> 0,
  ];

  const terms = CS64_COEFFICIENTS.map(
    ([coefficient], index) => multiply32(coefficient, factors[index % 2]) >>> 0,
  );
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset);

  const padded = Buffer.alloc(Math.ceil((data.length + 1) / 8) * 8);
  padded.set(data, 1);

  for (let index = 0; index < padded.length / 4; index += 1) {
    const word = padded.readUInt32LE(index * 4);
    let term = multiply32(word, index % 2 === 0 ? keyA : keyB);
    let offset = multiply32(
      rotate16(word),
      index % 2 === 0 ? 0xef0569fb : 0xc31713db,
    );

    if (index === 0) {
      term = (term + multiply32(0xf2f90b1a, factors[0])) >>> 0;
      offset = (offset + 0x0b1a0000) >>> 0;
    }

    terms.push(term >>> 0);
    offsets.push(offset >>> 0);
  }

  let swapAccumulator = 0;
  let swapLast = 0;
  let state = 0;
  let accumulator = 0;

  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index];
    const y = terms[index + 1];

    let value = rotate16((offsets[index] + x) >>> 0);
    let q = multiply32(value, 0x76f50f34);
    swapAccumulator += (multiply32(rotate16(q), 0xc3efea97) + q) >>> 0;

    value = rotate16((offsets[index + 1] + y) >>> 0);
    q = multiply32(value, 0x1881ce3c);
    swapLast = (multiply32(rotate16(q), 0x35bd1ec9) + q) >>> 0;
    swapAccumulator = (swapAccumulator + swapLast) >>> 0;

    state = (multiply32(state, keyA) + x) >>> 0;

    for (const coefficient of [
      0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83,
    ]) {
      state = multiply32(rotate16(state), coefficient) >>> 0;
    }

    accumulator += state;

    value = (multiply32(state, keyB) + y) >>> 0;
    value = multiply32(rotate16(value), 0xa27416f5) >>> 0;
    value = multiply32(rotate16(value), 0xd38396ff) >>> 0;
    state =
      multiply32(
        rotate16(multiply32(rotate16(value), 0x7c932b89)),
        0xbfa49f69,
      ) >>> 0;

    accumulator = (accumulator + state) >>> 0;
  }

  const result = Buffer.allocUnsafe(8);
  result.writeUInt32LE((swapLast ^ state) >>> 0, 0);
  result.writeUInt32LE((swapAccumulator ^ accumulator) >>> 0, 4);
  return result;
}

export function generateSecMsGecV2(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) {
    throw new TypeError("unixSeconds must be finite");
  }

  const epochSeconds =
    BigInt(Math.floor(unixSeconds)) + WINDOWS_FILE_TIME_EPOCH_SECONDS;
  const roundedSeconds = epochSeconds - (epochSeconds % TOKEN_WINDOW_SECONDS);
  const ticks = roundedSeconds * TICKS_PER_SECOND;

  const runtime = MsEdgeTTS as unknown as {
    TRUSTED_CLIENT_TOKEN: string;
  };
  const data = Buffer.from(`${ticks}${runtime.TRUSTED_CLIENT_TOKEN}`, "ascii");
  const shaDigest = createHash("sha256").update(PREFIX).update(data).digest();
  const cs64Digest = createCs64Digest(data, shaDigest);

  return `${cs64Digest.toString("hex").toUpperCase()}-${shaDigest
    .toString("hex")
    .toUpperCase()}`;
}

/**
 * The published msedge-tts client still sends Microsoft’s retired v1 token.
 * Replace only its private URL builder while keeping its existing audio stream
 * handling and SSML generation.
 */
export function configureEdgeTtsV2Handshake(): void {
  const runtime = MsEdgeTTS as unknown as {
    TRUSTED_CLIENT_TOKEN: string;
    _clockOffsetMs: number;
    generateUUID(): string;
    getSynthUrl(): Promise<string>;
  };

  runtime.getSynthUrl = async () => {
    const requestId = runtime.generateUUID();
    const token = generateSecMsGecV2(
      (Date.now() + runtime._clockOffsetMs) / 1000,
    );

    return `${EDGE_TTS_V2_URL}?TrustedClientToken=${runtime.TRUSTED_CLIENT_TOKEN}&ConnectionId=${requestId}&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=${EDGE_TTS_V2_VERSION}`;
  };
}
