/**
 * Cross-platform `Math.exp`, `Math.log`, `Math.sin` and friends for everything that feeds the
 * simulation.
 *
 * V8 evaluates these with its own C++ port of fdlibm (src/base/ieee754.cc), so every platform runs
 * the same algorithm, but not the same arithmetic: on arm64 the compiler contracts `a * b + c`
 * into fused multiply-adds, which x86-64 builds cannot emit. For the same input, an Apple silicon
 * Mac and Linux CI then disagree in the last bit of roughly one `Math.log` in fifty. Golden hashes
 * round that away, but a run is a chain of dependent decisions: one such bit flipped which way a
 * threshold went in scenario 110 at CEO on seed 1, and its pinned output forked between a Mac and
 * CI.
 *
 * JavaScript arithmetic never fuses, so this line-for-line port of the fdlibm functions V8 ships
 * (Node 24.14.0) returns exactly what x86-64 `Math` returns, on every machine. Only `pow` lives
 * elsewhere, in helpers/Pow, because V8 hands it to the C library instead. `Math.sqrt`, `abs`,
 * `floor`, `round`, `trunc`, `min`, `max` and `hypot` are exact or correctly rounded and stay safe.
 *
 * Copyright (C) 1993-2004 by Sun Microsystems, Inc. All rights reserved. Developed at SunSoft, a
 * Sun Microsystems, Inc. business. Permission to use, copy, modify, and distribute this software
 * is freely granted, provided that this notice is preserved.
 */

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;
const LO = 1 - HI;

/** The sign and exponent word of x, as a signed 32 bit integer like fdlibm's. */
function highWord(x: number): number {
  f64[0] = x;
  return u32[HI] | 0;
}
/** The low 32 bits of x's significand, unsigned. */
function lowWord(x: number): number {
  f64[0] = x;
  return u32[LO];
}
function fromWords(hi: number, lo: number): number {
  u32[HI] = hi;
  u32[LO] = lo;
  return f64[0];
}
function withHighWord(x: number, hi: number): number {
  f64[0] = x;
  u32[HI] = hi;
  return f64[0];
}
function withLowWord(x: number, lo: number): number {
  f64[0] = x;
  u32[LO] = lo;
  return f64[0];
}

/** x * 2^n in two steps, so neither power of two over- or underflows on its own. */
function scalbn(x: number, n: number): number {
  const half = Math.trunc(n / 2);
  return (
    x *
    fromWords((half + 1023) << 20, 0) *
    fromWords((n - half + 1023) << 20, 0)
  );
}

// 396 hex digits (476 decimal) of 2/pi, 24 bits per entry
const TWO_OVER_PI = [
  0xa2f983, 0x6e4e44, 0x1529fc, 0x2757d1, 0xf534dd, 0xc0db62, 0x95993c,
  0x439041, 0xfe5163, 0xabdebb, 0xc561b7, 0x246e3a, 0x424dd2, 0xe00649,
  0x2eea09, 0xd1921c, 0xfe1deb, 0x1cb129, 0xa73ee8, 0x8235f5, 0x2ebb44,
  0x84e99c, 0x7026b4, 0x5f7e41, 0x3991d6, 0x398353, 0x39f49c, 0x845f8b,
  0xbdf928, 0x3b1ff8, 0x97ffde, 0x05980f, 0xef2f11, 0x8b5a0a, 0x6d1f6d,
  0x367ecf, 0x27cb09, 0xb74f46, 0x3f669e, 0x5fea2d, 0x7527ba, 0xc7ebe5,
  0xf17b3d, 0x0739f7, 0x8a5292, 0xea6bfb, 0x5fb11f, 0x8d5d08, 0x560330,
  0x46fc7b, 0x6babf0, 0xcfbc20, 0x9af436, 0x1da9e3, 0x91615e, 0xe61b08,
  0x659985, 0x5f14a0, 0x68408d, 0xffd880, 0x4d7327, 0x310606, 0x1556ca,
  0x73a8c9, 0x60e27b, 0xc08c6b,
];
// High words of n * pi/2 for n = 1..32
const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c,
  0x4025fdbb, 0x402921fb, 0x402c463a, 0x402f6a7a, 0x4031475c, 0x4032d97c,
  0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a,
  0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c,
  0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb, 0x4046c6cb, 0x40478fdb,
  0x404858eb, 0x404921fb,
];
const INVPIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.0771005063039659766e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.0222662487111664558e-21;
const PIO2_3T = 8.47842766036889956997e-32;
const TWO24 = 1.6777216e7;
const TWON24 = 5.9604644775390625e-8;
// pi/2 in 24 bit pieces (__kernel_rem_pio2's PIo2)
const PIO2 = [
  1.57079625129699707031, 7.54978941586159635335e-8, 5.39030252995776476554e-15,
  3.28200341580791294123e-22, 1.27065575308067607349e-29,
  1.22933308981111328932e-36, 2.73370053816464559624e-44,
  2.16741683877804819444e-51,
];

const remainder = new Float64Array(2);
const reduceX = new Float64Array(3);
const kernelF = new Float64Array(20);
const kernelQ = new Float64Array(20);
const kernelFq = new Float64Array(20);
const kernelIq = new Int32Array(20);

/** __kernel_rem_pio2 at double precision (prec 2), for |x| beyond 2^19 * pi/2. */
function kernelRemPio2(
  x: Float64Array,
  y: Float64Array,
  e0: number,
  nx: number,
): number {
  const f = kernelF;
  const q = kernelQ;
  const fq = kernelFq;
  const iq = kernelIq;
  const jk = 4;
  const jp = jk;
  const jx = nx - 1;
  const jv = Math.max(0, Math.trunc((e0 - 3) / 24));
  let q0 = e0 - 24 * (jv + 1);

  for (let i = 0, j = jv - jx; i <= jx + jk; i++, j++)
    f[i] = j < 0 ? 0 : TWO_OVER_PI[j];
  for (let i = 0; i <= jk; i++) {
    let fw = 0;
    for (let j = 0; j <= jx; j++) fw += x[j] * f[jx + i - j];
    q[i] = fw;
  }

  let jz = jk;
  let z: number;
  let n: number;
  let ih: number;
  for (;;) {
    // Distill q[] into iq[] reversingly
    z = q[jz];
    for (let i = 0, j = jz; j > 0; i++, j--) {
      const fw = Math.trunc(TWON24 * z);
      iq[i] = z - TWO24 * fw;
      z = q[j - 1] + fw;
    }
    z = scalbn(z, q0);
    z -= 8 * Math.floor(z * 0.125);
    n = Math.trunc(z);
    z -= n;
    ih = 0;
    if (q0 > 0) {
      const i = iq[jz - 1] >> (24 - q0);
      n += i;
      iq[jz - 1] -= i << (24 - q0);
      ih = iq[jz - 1] >> (23 - q0);
    } else if (q0 === 0) {
      ih = iq[jz - 1] >> 23;
    } else if (z >= 0.5) {
      ih = 2;
    }

    if (ih > 0) {
      n += 1;
      let carry = 0;
      for (let i = 0; i < jz; i++) {
        const j = iq[i];
        if (carry === 0) {
          if (j !== 0) {
            carry = 1;
            iq[i] = 0x1000000 - j;
          }
        } else {
          iq[i] = 0xffffff - j;
        }
      }
      if (q0 === 1) iq[jz - 1] &= 0x7fffff;
      else if (q0 === 2) iq[jz - 1] &= 0x3fffff;
      if (ih === 2) {
        z = 1 - z;
        if (carry !== 0) z -= scalbn(1, q0);
      }
    }

    if (z !== 0) break;
    let j = 0;
    for (let i = jz - 1; i >= jk; i--) j |= iq[i];
    if (j !== 0) break;
    // Recompute with more terms
    let k = 1;
    while (jk >= k && iq[jk - k] === 0) k++;
    for (let i = jz + 1; i <= jz + k; i++) {
      f[jx + i] = TWO_OVER_PI[jv + i];
      let fw = 0;
      for (let jj = 0; jj <= jx; jj++) fw += x[jj] * f[jx + i - jj];
      q[i] = fw;
    }
    jz += k;
  }

  // Chop off zero terms
  if (z === 0) {
    jz -= 1;
    q0 -= 24;
    while (iq[jz] === 0) {
      jz--;
      q0 -= 24;
    }
  } else {
    // Break z into 24 bit pieces if necessary
    z = scalbn(z, -q0);
    if (z >= TWO24) {
      const fw = Math.trunc(TWON24 * z);
      iq[jz] = z - TWO24 * fw;
      jz += 1;
      q0 += 24;
      iq[jz] = fw;
    } else {
      iq[jz] = z;
    }
  }

  let fw = scalbn(1, q0);
  for (let i = jz; i >= 0; i--) {
    q[i] = fw * iq[i];
    fw *= TWON24;
  }
  for (let i = jz; i >= 0; i--) {
    fw = 0;
    for (let k = 0; k <= jp && k <= jz - i; k++) fw += PIO2[k] * q[i + k];
    fq[jz - i] = fw;
  }

  fw = 0;
  for (let i = jz; i >= 0; i--) fw += fq[i];
  y[0] = ih === 0 ? fw : -fw;
  fw = fq[0] - fw;
  for (let i = 1; i <= jz; i++) fw += fq[i];
  y[1] = ih === 0 ? fw : -fw;
  return n & 7;
}

/** x rem pi/2 as y[0] + y[1]; returns the quadrant count. */
function remPio2(x: number, y: Float64Array): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    y[0] = x;
    y[1] = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    // |x| < 3pi/4, special case with n = +-1
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) {
        y[0] = z - PIO2_1T;
        y[1] = z - y[0] - PIO2_1T;
      } else {
        z -= PIO2_2;
        y[0] = z - PIO2_2T;
        y[1] = z - y[0] - PIO2_2T;
      }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) {
      y[0] = z + PIO2_1T;
      y[1] = z - y[0] + PIO2_1T;
    } else {
      z += PIO2_2;
      y[0] = z + PIO2_2T;
      y[1] = z - y[0] + PIO2_2T;
    }
    return -1;
  }
  if (ix <= 0x413921fb) {
    // |x| ~<= 2^19 * pi/2, medium size
    const t = Math.abs(x);
    const n = Math.trunc(t * INVPIO2 + 0.5);
    const fn = n;
    let r = t - fn * PIO2_1;
    let w = fn * PIO2_1T;
    if (n < 32 && ix !== NPIO2_HW[n - 1]) {
      y[0] = r - w;
    } else {
      const j = ix >> 20;
      y[0] = r - w;
      let i = j - ((highWord(y[0]) >> 20) & 0x7ff);
      if (i > 16) {
        // Second iteration, good to 118 bits
        let tt = r;
        w = fn * PIO2_2;
        r = tt - w;
        w = fn * PIO2_2T - (tt - r - w);
        y[0] = r - w;
        i = j - ((highWord(y[0]) >> 20) & 0x7ff);
        if (i > 49) {
          // Third iteration, 151 bits
          tt = r;
          w = fn * PIO2_3;
          r = tt - w;
          w = fn * PIO2_3T - (tt - r - w);
          y[0] = r - w;
        }
      }
    }
    y[1] = r - y[0] - w;
    if (hx < 0) {
      y[0] = -y[0];
      y[1] = -y[1];
      return -n;
    }
    return n;
  }
  if (ix >= 0x7ff00000) {
    y[0] = y[1] = x - x;
    return 0;
  }
  // Large arguments: z = scalbn(|x|, ilogb(x) - 23)
  const e0 = (ix >> 20) - 1046;
  let z = fromWords(ix - (e0 << 20), lowWord(x));
  for (let i = 0; i < 2; i++) {
    reduceX[i] = Math.trunc(z);
    z = (z - reduceX[i]) * TWO24;
  }
  reduceX[2] = z;
  let nx = 3;
  while (reduceX[nx - 1] === 0) nx--;
  const n = kernelRemPio2(reduceX, y, e0, nx);
  if (hx < 0) {
    y[0] = -y[0];
    y[1] = -y[1];
    return -n;
  }
  return n;
}

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

/** cos on [-pi/4, pi/4], with y the tail of x. */
function kernelCos(x: number, y: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const iz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (iz - (z * r - x * y));
}

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

/** sin on [-pi/4, pi/4], with y the tail of x when iy is 1. */
function kernelSin(x: number, y: number, iy: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) return x;
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const T = [
  3.33333333333334091986e-1, 1.33333333333201242699e-1,
  5.39682539762260521377e-2, 2.18694882948595424599e-2,
  8.86323982359930005737e-3, 3.59207910759131235356e-3,
  1.45620945432529025516e-3, 5.88041240820264096874e-4,
  2.46463134818469906812e-4, 7.817944429395570923e-5, 7.14072491382608190305e-5,
  -1.85586374855275456654e-5, 2.59073051863633712884e-5,
];
const PIO4 = 7.85398163397448278999e-1;
const PIO4LO = 3.06161699786838301793e-17;

/** tan on [-pi/4, pi/4] when iy is 1, else -1/tan. */
function kernelTan(x: number, y: number, iy: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix < 0x3e300000) {
    if ((ix | lowWord(x) | (iy + 1)) === 0) return 1 / Math.abs(x);
    if (iy === 1) return x;
    // -1 / (x + y), carefully
    const w = x + y;
    const z = withLowWord(w, 0);
    const v = y - (z - x);
    const a = -1 / w;
    const t = withLowWord(a, 0);
    const s = 1 + t * z;
    return t + a * (s + t * v);
  }
  if (ix >= 0x3fe59428) {
    // |x| >= 0.6744
    if (hx < 0) {
      x = -x;
      y = -y;
    }
    const z = PIO4 - x;
    const w = PIO4LO - y;
    x = z + w;
    y = 0;
  }
  const z = x * x;
  const w = z * z;
  let r = T[1] + w * (T[3] + w * (T[5] + w * (T[7] + w * (T[9] + w * T[11]))));
  let v =
    z * (T[2] + w * (T[4] + w * (T[6] + w * (T[8] + w * (T[10] + w * T[12])))));
  const s = z * x;
  r = y + z * (s * (r + v) + y);
  r += T[0] * s;
  const sum = x + r;
  if (ix >= 0x3fe59428) {
    v = iy;
    return (
      (1 - ((hx >> 30) & 2)) * (v - 2 * (x - ((sum * sum) / (sum + v) - r)))
    );
  }
  if (iy === 1) return sum;
  // -1 / (x + r), accurately
  const zz = withLowWord(sum, 0);
  v = r - (zz - x);
  const a = -1 / sum;
  const t = withLowWord(a, 0);
  const ss = 1 + t * zz;
  return t + a * (ss + t * v);
}

/** Math.sin, identical on every platform. */
export function sin(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x, remainder);
  switch (n & 3) {
    case 0:
      return kernelSin(remainder[0], remainder[1], 1);
    case 1:
      return kernelCos(remainder[0], remainder[1]);
    case 2:
      return -kernelSin(remainder[0], remainder[1], 1);
    default:
      return -kernelCos(remainder[0], remainder[1]);
  }
}

/** Math.cos, identical on every platform. */
export function cos(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x, remainder);
  switch (n & 3) {
    case 0:
      return kernelCos(remainder[0], remainder[1]);
    case 1:
      return -kernelSin(remainder[0], remainder[1], 1);
    case 2:
      return -kernelCos(remainder[0], remainder[1]);
    default:
      return kernelSin(remainder[0], remainder[1], 1);
  }
}

/** Math.tan, identical on every platform. */
export function tan(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelTan(x, 0, 1);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x, remainder);
  return kernelTan(remainder[0], remainder[1], 1 - ((n & 1) << 1));
}

const PI = 3.141592653589793116;
const PIO2_HI = 1.570796326794896558;
const PIO2_LO = 6.12323399573676603587e-17;
const PIO4_HI = 7.85398163397448278999e-1;
const PS0 = 1.66666666666666657415e-1;
const PS1 = -3.25565818622400915405e-1;
const PS2 = 2.01212532134862925881e-1;
const PS3 = -4.00555345006794114027e-2;
const PS4 = 7.91534994289814532176e-4;
const PS5 = 3.4793310759602116757e-5;
const QS1 = -2.40339491173441421878;
const QS2 = 2.02094576023350569471;
const QS3 = -6.8828397160545329303e-1;
const QS4 = 7.70381505559019352791e-2;

/** Math.asin, identical on every platform. */
export function asin(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  let t = 0;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | lowWord(x)) === 0)
      return x * PIO2_HI + x * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix < 0x3e400000) return x;
    t = x * x;
    const p =
      t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
    const q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
    const w = p / q;
    return x + x * w;
  }
  let w = 1 - Math.abs(x);
  t = w * 0.5;
  let p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
  let q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
  const s = Math.sqrt(t);
  if (ix >= 0x3fef3333) {
    // |x| > 0.975
    w = p / q;
    t = PIO2_HI - (2 * (s + s * w) - PIO2_LO);
  } else {
    w = withLowWord(s, 0);
    const c = (t - w * w) / (s + w);
    const r = p / q;
    p = 2 * s * r - (PIO2_LO - 2 * c);
    q = PIO4_HI - 2 * w;
    t = PIO4_HI - (p - q);
  }
  return hx > 0 ? t : -t;
}

/** Math.acos, identical on every platform. */
export function acos(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | lowWord(x)) === 0)
      return hx > 0 ? 0 : PI + 2 * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix <= 0x3c600000) return PIO2_HI + PIO2_LO;
    const z = x * x;
    const p =
      z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))));
    const q = 1 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)));
    const r = p / q;
    return PIO2_HI - (x - (PIO2_LO - x * r));
  }
  if (hx < 0) {
    // x < -0.5
    const z = (1 + x) * 0.5;
    const p =
      z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))));
    const q = 1 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)));
    const s = Math.sqrt(z);
    const r = p / q;
    const w = r * s - PIO2_LO;
    return PI - 2 * (s + w);
  }
  // x > 0.5
  const z = (1 - x) * 0.5;
  const s = Math.sqrt(z);
  const df = withLowWord(s, 0);
  const c = (z - df * df) / (s + df);
  const p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))));
  const q = 1 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)));
  const r = p / q;
  const w = r * s + c;
  return 2 * (df + w);
}

const ATANHI = [
  4.63647609000806093515e-1, 7.85398163397448278999e-1,
  9.82793723247329054082e-1, 1.570796326794896558,
];
const ATANLO = [
  2.26987774529616870924e-17, 3.06161699786838301793e-17,
  1.39033110312309984516e-17, 6.12323399573676603587e-17,
];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1,
  1.42857142725034663711e-1, -1.1111110405462355788e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2,
  6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.6531572744216915527e-2,
  1.62858201153657823623e-2,
];

/** Math.atan, identical on every platform. */
export function atan(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  let id: number;
  if (ix >= 0x44100000) {
    // |x| >= 2^66
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lowWord(x) !== 0))
      return x + x;
    return hx > 0 ? ATANHI[3] + ATANLO[3] : -ATANHI[3] - ATANLO[3];
  }
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375
    if (ix < 0x3e400000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 =
    z *
    (AT[0] +
      w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const result = ATANHI[id] - (x * (s1 + s2) - ATANLO[id] - x);
  return hx < 0 ? -result : result;
}

const TINY = 1.0e-300;
const PI_O_4 = 7.85398163397448279e-1;
const PI_O_2 = 1.570796326794896558;
const PI_LO = 1.2246467991473531772e-16;

/** Math.atan2, identical on every platform. */
export function atan2(y: number, x: number): number {
  const hx = highWord(x);
  const lx = lowWord(x);
  const ix = hx & 0x7fffffff;
  const hy = highWord(y);
  const ly = lowWord(y);
  const iy = hy & 0x7fffffff;
  if (
    (ix | ((lx | -lx) >>> 31)) > 0x7ff00000 ||
    (iy | ((ly | -ly) >>> 31)) > 0x7ff00000
  )
    return x + y;
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y);
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2);

  if ((iy | ly) === 0) {
    switch (m) {
      case 0:
      case 1:
        return y;
      case 2:
        return PI + TINY;
      default:
        return -PI - TINY;
    }
  }
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0:
          return PI_O_4 + TINY;
        case 1:
          return -PI_O_4 - TINY;
        case 2:
          return 3 * PI_O_4 + TINY;
        default:
          return -3 * PI_O_4 - TINY;
      }
    }
    switch (m) {
      case 0:
        return 0;
      case 1:
        return -0;
      case 2:
        return PI + TINY;
      default:
        return -PI - TINY;
    }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY;

  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) {
    // |y/x| > 2^60
    z = PI_O_2 + 0.5 * PI_LO;
    m &= 1;
  } else if (hx < 0 && k < -60) {
    z = 0;
  } else {
    z = atan(Math.abs(y / x));
  }
  switch (m) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return PI - (z - PI_LO);
    default:
      return z - PI_LO - PI;
  }
}

const O_THRESHOLD = 7.09782712893383973096e2;
const U_THRESHOLD = -7.4513321910194110842e2;
const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INVLN2 = 1.442695040888963387;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;
const E = 2.718281828459045;
const TWOM1000 = 9.3326361850321887899e-302;
const TWO1023 = 8.988465674311579539e307;

/** Math.exp, identical on every platform. */
export function exp(x: number): number {
  let hx = highWord(x);
  const xsb = (hx >>> 31) & 1;
  hx &= 0x7fffffff;
  if (hx >= 0x40862e42) {
    // |x| >= 709.78...
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | lowWord(x)) !== 0) return x + x;
      return xsb === 0 ? x : 0;
    }
    if (x > O_THRESHOLD) return Infinity;
    if (x < U_THRESHOLD) return 0;
  }

  let hi = 0;
  let lo = 0;
  let k = 0;
  if (hx > 0x3fd62e42) {
    // |x| > 0.5 ln2
    if (hx < 0x3ff0a2b2) {
      // and |x| < 1.5 ln2
      if (x === 1) return E;
      hi = x - (xsb ? -LN2_HI : LN2_HI);
      lo = xsb ? -LN2_LO : LN2_LO;
      k = 1 - xsb - xsb;
    } else {
      k = Math.trunc(INVLN2 * x + (xsb ? -0.5 : 0.5));
      hi = x - k * LN2_HI;
      lo = k * LN2_LO;
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    // |x| < 2^-28
    return 1 + x;
  }

  const t = x * x;
  const twopk = fromWords(0x3ff00000 + ((k >= -1021 ? k : k + 1000) << 20), 0);
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - (lo - (x * c) / (2 - c) - hi);
  if (k >= -1021) return k === 1024 ? y * 2 * TWO1023 : y * twopk;
  return y * twopk * TWOM1000;
}

const TWO54 = 1.8014398509481984e16;
const LG1 = 6.66666666666673513e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

/** Math.log, identical on every platform. */
export function log(x: number): number {
  let hx = highWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    // x < 2^-1022
    if (((hx & 0x7fffffff) | lowWord(x)) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    hx = highWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  // Normalize x or x/2
  x = withHighWord(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  const f = x - 1;
  const dk = k;
  if ((0x000fffff & (2 + hx)) < 3) {
    // -2^-20 <= f < 2^-20
    if (f === 0) return k === 0 ? 0 : dk * LN2_HI + dk * LN2_LO;
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    return dk * LN2_HI - (R - dk * LN2_LO - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * LN2_HI - (hfsq - (s * (hfsq + R) + dk * LN2_LO) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * LN2_HI - (s * (f - R) - dk * LN2_LO - f);
}

/** Math.log1p, identical on every platform. */
export function log1p(x: number): number {
  const hx = highWord(x);
  const ax = hx & 0x7fffffff;
  let k = 1;
  let f = 0;
  let hu = 0;
  let c = 0;
  if (hx < 0x3fda827a) {
    // 1 + x < sqrt(2)+
    if (ax >= 0x3ff00000) return x === -1 ? -Infinity : NaN;
    if (ax < 0x3e200000) {
      // |x| < 2^-29
      if (ax < 0x3c900000) return x;
      return x - x * x * 0.5;
    }
    if (hx > 0 || hx <= (0xbfd2bec4 | 0)) {
      // sqrt(2)/2- <= 1 + x < sqrt(2)+
      k = 0;
      f = x;
      hu = 1;
    }
  }
  if (hx >= 0x7ff00000) return x + x;
  if (k !== 0) {
    let u: number;
    if (hx < 0x43400000) {
      u = 1 + x;
      hu = highWord(u);
      k = (hu >> 20) - 1023;
      // Correction term
      c = k > 0 ? 1 - (u - x) : x - (u - 1);
      c /= u;
    } else {
      u = x;
      hu = highWord(u);
      k = (hu >> 20) - 1023;
      c = 0;
    }
    hu &= 0x000fffff;
    if (hu < 0x6a09e) {
      u = withHighWord(u, hu | 0x3ff00000);
    } else {
      k += 1;
      u = withHighWord(u, hu | 0x3fe00000);
      hu = (0x00100000 - hu) >> 2;
    }
    f = u - 1;
  }
  const hfsq = 0.5 * f * f;
  if (hu === 0) {
    // |f| < 2^-20
    if (f === 0) {
      if (k === 0) return 0;
      c += k * LN2_LO;
      return k * LN2_HI + c;
    }
    const R = hfsq * (1 - 0.66666666666666666 * f);
    if (k === 0) return f - R;
    return k * LN2_HI - (R - (k * LN2_LO + c) - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  const R =
    z *
    (LG1 + z * (LG2 + z * (LG3 + z * (LG4 + z * (LG5 + z * (LG6 + z * LG7))))));
  if (k === 0) return f - (hfsq - s * (hfsq + R));
  return k * LN2_HI - (hfsq - (s * (hfsq + R) + (k * LN2_LO + c)) - f);
}

const IVLN10 = 4.34294481903251816668e-1;
const LOG10_2HI = 3.01029995663611771306e-1;
const LOG10_2LO = 3.69423907715893078616e-13;

/** Math.log10, identical on every platform. */
export function log10(x: number): number {
  let hx = highWord(x);
  let lx = lowWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    // x < 2^-1022
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    hx = highWord(x);
    lx = lowWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  if (hx === 0x3ff00000 && lx === 0) return 0;
  k += (hx >> 20) - 1023;
  const i = (k & 0x80000000) >>> 31;
  hx = (hx & 0x000fffff) | ((0x3ff - i) << 20);
  const y = k + i;
  x = fromWords(hx, lx);
  const z = y * LOG10_2LO + IVLN10 * log(x);
  return z + y * LOG10_2HI;
}
