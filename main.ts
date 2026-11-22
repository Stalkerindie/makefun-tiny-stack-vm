// Tiny stack VM: a faithful interpreter of make.fun's tiny stack ISA v1
// (kit: generator/subject/ISA.md). For every /input/<id>/ program it writes
// /output/<id>/stdout.bin (exactly the bytes the program wrote) and
// /output/<id>/exit.txt (its exit code). Node 22, no dependencies.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// [opcode, pops, pushes, immediate bytes] for every valid opcode.
const SPEC = [
  [0x00, 0, 0, 0], [0x01, 0, 1, 1], [0x02, 0, 1, 4], [0x03, 1, 0, 0],
  [0x04, 1, 2, 0], [0x05, 2, 2, 0], [0x06, 2, 3, 0], [0x07, 3, 3, 0],
  [0x10, 2, 1, 0], [0x11, 2, 1, 0], [0x12, 2, 1, 0], [0x13, 2, 1, 0],
  [0x14, 2, 1, 0], [0x15, 2, 1, 0], [0x16, 2, 1, 0], [0x17, 1, 1, 0],
  [0x18, 2, 1, 0], [0x19, 2, 1, 0], [0x1a, 2, 1, 0], [0x1b, 1, 1, 0],
  [0x1c, 2, 1, 0], [0x1d, 2, 1, 0], [0x1e, 2, 1, 0], [0x20, 2, 1, 0],
  [0x21, 2, 1, 0], [0x22, 2, 1, 0], [0x30, 0, 0, 2], [0x31, 1, 0, 2],
  [0x32, 1, 0, 2], [0x33, 0, 0, 2], [0x34, 0, 0, 0], [0x40, 1, 1, 0],
  [0x41, 2, 0, 0], [0x50, 1, 0, 0], [0x51, 1, 0, 0], [0x52, 0, 1, 0],
  [0x53, 1, 0, 0],
];
const OK = new Uint8Array(256), PO = new Uint8Array(256), PU = new Uint8Array(256), IM = new Uint8Array(256);
for (const [o, a, b, c] of SPEC) { OK[o] = 1; PO[o] = a; PU[o] = b; IM[o] = c; }

const enc = new TextEncoder();

// Runs one program on its input bytes; returns [stdout bytes, exit code].
// Traps end the run at once with the trap's code, keeping prior output.
function run(p, inp) {
  const n = p.length;
  const D = new Int32Array(256), C = new Int32Array(64), M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let sp = 0, cp = 0, pc = 0, ip = 0, st = 0, ol = 0;
  for (;;) {
    if (st === 1000000) return [out.subarray(0, ol), 10];
    if (pc < 0 || pc >= n) return [out.subarray(0, ol), 9];
    const o = p[pc];
    if (!OK[o]) return [out.subarray(0, ol), 5];
    const m = IM[o];
    if (pc + m >= n) return [out.subarray(0, ol), 9];
    st++;
    const nx = pc + 1 + m;
    if (sp < PO[o]) return [out.subarray(0, ol), 2];
    if (sp - PO[o] + PU[o] > 256) return [out.subarray(0, ol), 3];
    pc = nx;
    switch (o) {
      case 0x00: return [out.subarray(0, ol), 0];
      case 0x01: D[sp++] = (p[nx - 1] << 24) >> 24; break;
      case 0x02: D[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp - 1]; sp++; break;
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;
      case 0x07: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 0x17: D[sp - 1] = -D[sp - 1] | 0; break;
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        let take = o === 0x30;
        if (!take) { const v = D[--sp]; take = o === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = nx + rel;
        break;
      }
      case 0x33:
        if (cp === 64) return [out.subarray(0, ol), 7];
        C[cp++] = nx; pc = p[nx - 2] | (p[nx - 1] << 8); break;
      case 0x34:
        if (cp === 0) return [out.subarray(0, ol), 8];
        pc = C[--cp]; break;
      case 0x40: {
        const a = D[sp - 1];
        if (a < 0 || a >= 256) return [out.subarray(0, ol), 6];
        D[sp - 1] = M[a]; break;
      }
      case 0x41: {
        const a = D[sp - 1], v = D[sp - 2];
        if (a < 0 || a >= 256) return [out.subarray(0, ol), 6];
        sp -= 2; M[a] = v; break;
      }
      case 0x50: {
        const b = enc.encode(String(D[sp - 1]));
        if (ol + b.length > 65536) return [out.subarray(0, ol), 11];
        sp--; out.set(b, ol); ol += b.length; break;
      }
      case 0x51:
        if (ol + 1 > 65536) return [out.subarray(0, ol), 11];
        out[ol++] = D[--sp] & 255; break;
      case 0x52: D[sp++] = ip < inp.length ? inp[ip++] : -1; break;
      case 0x53: return [out.subarray(0, ol), D[--sp] & 255];
      default: {
        // Binary ops 0x10-0x16, 0x18-0x1a, 0x1c-0x1e, 0x20-0x22.
        const b = D[sp - 1], a = D[sp - 2];
        let r;
        if (o === 0x10) r = (a + b) | 0;
        else if (o === 0x11) r = (a - b) | 0;
        else if (o === 0x12) r = Math.imul(a, b);
        else if (o === 0x13) { if (!b) return [out.subarray(0, ol), 4]; r = a === -2147483648 && b === -1 ? a : (a / b) | 0; }
        else if (o === 0x14) { if (!b) return [out.subarray(0, ol), 4]; r = b === -1 ? 0 : (a % b) | 0; }
        else if (o === 0x15) { if (!b) return [out.subarray(0, ol), 4]; r = Math.floor((a >>> 0) / (b >>> 0)) | 0; }
        else if (o === 0x16) { if (!b) return [out.subarray(0, ol), 4]; r = ((a >>> 0) % (b >>> 0)) | 0; }
        else if (o === 0x18) r = a & b;
        else if (o === 0x19) r = a | b;
        else if (o === 0x1a) r = a ^ b;
        else if (o === 0x1c) r = a << (b & 31);
        else if (o === 0x1d) r = a >> (b & 31);
        else if (o === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (o === 0x20) r = a === b ? 1 : 0;
        else if (o === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2; D[sp++] = r;
      }
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const [out, code] = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), out);
  writeFileSync(join(O, id, 'exit.txt'), code + '\n');
}
