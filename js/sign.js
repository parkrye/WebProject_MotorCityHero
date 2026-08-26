// HMAC-SHA256. 랭킹 기록에 서명을 붙이는 데만 쓴다.
//
// 브라우저 기본 제공인 crypto.subtle 은 "보안 컨텍스트"(https 또는 localhost)에서만
// 존재한다. 이 게임은 같은 공유기의 폰에서 http://192.168.x.x 로 들어오는 게 정상
// 사용법이라 그쪽에서는 undefined 가 된다. 그래서 직접 구현한다.
//
// 열쇠가 클라이언트에 있는 이상 이건 암호학적 보증이 아니라 "손으로 요청을 만들기
// 어렵게 만드는 장치"다. 실제 방어는 서버의 세션 토큰 · 타당성 검증이 한다.

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_BLOCK = 64;

function rotr32(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/** @param {Uint8Array} bytes @returns {Uint8Array} 32바이트 다이제스트 */
function sha256Bytes(bytes) {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  // 뒤에 0x80 을 붙이고 길이(8바이트)가 들어갈 자리까지 64바이트 배수로 채운다.
  const padded = new Uint8Array((Math.floor((bytes.length + 8) / SHA256_BLOCK) + 1) * SHA256_BLOCK);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += SHA256_BLOCK) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = (rotr32(x, 7) ^ rotr32(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr32(y, 17) ^ rotr32(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const s1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    const round = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i += 1) h[i] = (h[i] + round[i]) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) outView.setUint32(i * 4, h[i]);
  return out;
}

function toHex(bytes) {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * @param {string} key      서버가 세션과 함께 내려준 열쇠
 * @param {string} message  서명할 정규화 문자열
 * @returns {string} 소문자 16진 다이제스트
 */
function hmacSha256Hex(key, message) {
  const encoder = new TextEncoder();
  let keyBytes = encoder.encode(key);
  if (keyBytes.length > SHA256_BLOCK) keyBytes = sha256Bytes(keyBytes);

  const messageBytes = encoder.encode(message);
  const inner = new Uint8Array(SHA256_BLOCK + messageBytes.length);
  const outer = new Uint8Array(SHA256_BLOCK + 32);

  for (let i = 0; i < SHA256_BLOCK; i += 1) {
    const byte = keyBytes[i] ?? 0;
    inner[i] = byte ^ 0x36;
    outer[i] = byte ^ 0x5c;
  }

  inner.set(messageBytes, SHA256_BLOCK);
  outer.set(sha256Bytes(inner), SHA256_BLOCK);
  return toHex(sha256Bytes(outer));
}
