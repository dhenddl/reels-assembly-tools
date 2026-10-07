// sfx-cuts.mjs — 장면 전환 효과음 트랙을 **코드로** 합성한다 (외부 음원 없음 · 같은 입력이면 같은 샘플)
//
// 재사용: ../../make-hook-sfx.mjs 의 synthWav()
//   hook   = 'typing' (2026-08-24 훅 효과음 채택안). 길이를 훅 끝 + 0.15s 로 주면 그 스크립트의 이음새 임팩트가
//            정확히 훅 → 첫 장면 컷에 떨어진다 (CUT = D − 0.15 로 설계돼 있다).
//   impact = 'impact' 의 첫 붐만 쓴다 (두 번째 붐 전에 자른다) — 결론 글자가 박히는 순간
// 새로 합성 (make-hook-sfx 에 짧은 컷 소리가 없어서):
//   tick   = 1650Hz 클릭(make-hook-sfx 의 click 과 같은 식) + 시드 고정 노이즈 휙 60ms — 하드컷마다
//   glitch = 30Hz 로 끊기는 비트크러시 노이즈 180ms — 등식이 깨지는 순간
// 덕킹: 말(어절 구간 ±20ms) 안에서는 duckDb(기본 −14dB) 로 낮춘다. 20ms 램프.
import { synthWav, SR } from '../../make-hook-sfx.mjs';

const TAU = Math.PI * 2;
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1; }
function wavToMono(buf) {   // make-hook-sfx 의 16bit 스테레오(좌우 같음) → Float32 모노
  const n = (buf.length - 44) / 4, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(44 + i * 4) / 32767;
  return out;
}
const SYN = {
  hook: (ms) => wavToMono(synthWav({ style: 'typing', ms, gain: 1.0 }).wav),
  impact: () => { const a = wavToMono(synthWav({ style: 'impact', ms: 900, gain: 1.0 }).wav); return a.subarray(0, Math.round(0.7 * SR)); },
  tick: () => {
    const n = Math.round(0.12 * SR), out = new Float32Array(n), rnd = lcg(0x2A);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const click = Math.sin(TAU * 1650 * t) * Math.exp(-t * 240);
      lp += 0.35 * (rnd() - lp);                                  // 한 극 저역통과 노이즈 = 휙
      const whoosh = lp * Math.sin(Math.PI * Math.min(1, t / 0.06)) * Math.exp(-t * 30);
      out[i] = 0.55 * click + 0.9 * whoosh;
    }
    return out;
  },
  glitch: () => {
    const n = Math.round(0.18 * SR), out = new Float32Array(n), rnd = lcg(0x1F);
    let held = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR, gate = Math.floor(t * 30) % 2 === 0 ? 1 : 0.15;
      if (i % 24 === 0) held = rnd();                              // 샘플 앤 홀드 = 비트크러시
      out[i] = Math.round(held * 6) / 6 * 0.5 * gate * Math.exp(-t * 6);
    }
    return out;
  },
};
export const SFX_KINDS = Object.keys(SYN);

/**
 * @param {{ totalS:number, events:{t:number, kind:string, ms?:number, gain?:number}[], speech:[number,number][], duckDb?:number }} o
 * @returns {{ wav:Buffer, placed:object[] }}  48kHz 16bit 스테레오
 */
export function buildSfxTrack({ totalS, events, speech, duckDb = -14 }) {
  const N = Math.round(totalS * SR), mix = new Float32Array(N), placed = [];
  for (const e of events) {
    if (!SYN[e.kind]) throw new Error(`모르는 효과음: ${e.kind} (${SFX_KINDS.join(' | ')})`);
    const s = SYN[e.kind](e.ms), g = e.gain ?? 1, i0 = Math.round(e.t * SR);
    for (let i = 0; i < s.length && i0 + i < N; i++) if (i0 + i >= 0) mix[i0 + i] += s[i] * g;
    placed.push({ ...e, len: +(s.length / SR).toFixed(3) });
  }
  // 덕킹 게인: 말 구간(±20ms)에서 duckDb, 20ms 램프
  const duck = Math.pow(10, duckDb / 20), pad = 0.02, ramp = Math.round(0.02 * SR);
  const target = new Float32Array(N).fill(1);
  for (const [a, b] of speech) { const i0 = Math.max(0, Math.round((a - pad) * SR)), i1 = Math.min(N, Math.round((b + pad) * SR)); for (let i = i0; i < i1; i++) target[i] = duck; }
  let g = 1; const step = (1 - duck) / ramp; const gainAt = new Float32Array(N);
  for (let i = 0; i < N; i++) { g = target[i] < g ? Math.max(target[i], g - step) : Math.min(target[i], g + step); gainAt[i] = g; }
  // 효과음마다: 샘플 중 덕킹(게인 < 0.5)된 비율 · 에너지 가중 평균 감쇠(dB)
  for (const p of placed) {
    const i0 = Math.max(0, Math.round(p.t * SR)), i1 = Math.min(N, i0 + Math.round(p.len * SR)); let dk = 0, e = 0, eg = 0;
    for (let i = i0; i < i1; i++) { if (gainAt[i] < 0.5) dk++; const v = mix[i] * mix[i]; e += v; eg += v * gainAt[i] * gainAt[i]; }
    p.duckedPct = +((100 * dk) / Math.max(1, i1 - i0)).toFixed(0); p.attenDb = e > 0 ? +(10 * Math.log10(eg / e)).toFixed(1) : 0;
  }
  // 말 구간(패딩 없이) 안의 최대 게인 — 「말 구간에서 −12dB 이상」 을 샘플 단위로 증명한다
  let gMaxIn = 0; for (const [a, b] of speech) for (let i = Math.max(0, Math.round(a * SR)); i < Math.min(N, Math.round(b * SR)); i++) gMaxIn = Math.max(gMaxIn, gainAt[i]);
  var maxGainInSpeechDb = gMaxIn > 0 ? +(20 * Math.log10(gMaxIn)).toFixed(2) : null;
  for (let i = 0; i < N; i++) mix[i] *= gainAt[i];
  const data = Buffer.alloc(N * 4); let peak = 0;
  for (let i = 0; i < N; i++) { let v = mix[i]; if (v > 1) v = 1; else if (v < -1) v = -1; peak = Math.max(peak, Math.abs(v)); const q = Math.round(v * 32767); data.writeInt16LE(q, i * 4); data.writeInt16LE(q, i * 4 + 2); }
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
  return { wav: Buffer.concat([hdr, data]), placed, peak, maxGainInSpeechDb };
}
