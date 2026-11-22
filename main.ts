// Tiny stack VM: a faithful interpreter of make.fun's tiny stack ISA v1.
// For every /input/<id>/ program writes /output/<id>/stdout.bin + exit.txt.
// Node 22, no dependencies.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Per-opcode shape from the byte (pops, pushes, immediate bytes).
const valid = (o) => o < 8 || (o > 15 && o < 35) || (o > 47 && o < 53) || o === 64 || o === 65 || (o > 79 && o < 84);
const pops = (o) => o === 7 ? 3 : (o === 5 || o === 6 || (o >= 16 && o <= 22) || (o >= 24 && o <= 26) || (o >= 28 && o <= 30) || (o >= 32 && o <= 34) || o === 65) ? 2 : (o < 3 || o === 48 || o === 51 || o === 52 || o === 82) ? 0 : 1;
const pushes = (o) => (o === 4 || o === 5) ? 2 : (o === 6 || o === 7) ? 3 : (o === 1 || o === 2 || o === 82 || (o >= 16 && o <= 34) || o === 64) ? 1 : 0;
const imm = (o) => o === 1 ? 1 : o === 2 ? 4 : (o >= 48 && o <= 51) ? 2 : 0;

const tmp = new Uint8Array(12); // scratch for PRINT's decimal digits
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
    if (!valid(o)) return [out.subarray(0, ol), 5];
    const m = imm(o);
    if (pc + m >= n) return [out.subarray(0, ol), 9];
    st++;
    const nx = pc + 1 + m;
    const po = pops(o), pu = pushes(o);
    if (sp < po) return [out.subarray(0, ol), 2];
    if (sp - po + pu > 256) return [out.subarray(0, ol), 3];
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
        // PRINT: decimal without allocating (itoa into scratch, one copy).
        const v = D[sp - 1];
        let u = v < 0 ? -v : v, k = 12;
        if (u === 0) tmp[--k] = 48;
        while (u > 0) { tmp[--k] = 48 + (u % 10); u = (u / 10) | 0; }
        if (v < 0) tmp[--k] = 45;
        if (ol + (12 - k) > 65536) return [out.subarray(0, ol), 11];
        sp--; out.set(tmp.subarray(k), ol); ol += 12 - k; break;
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
