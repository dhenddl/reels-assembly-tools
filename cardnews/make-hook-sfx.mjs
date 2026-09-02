// 훅 효과음 — **우리가 파형을 합성한다** (2026-08-24 신설)
//
// ✅ **채택 확정: `typing`** (2026-08-24 사용자 결정, A/B 비교 영상 2번).
//    그래서 이 파일의 기본값이 typing 이고, assemble-reel.mjs 도 --hook 이 있으면 typing 을
//    **자동으로 얹는다**. 결정만 문서에 적으면 다음 세션에서 조용히 무음으로 회귀한다.
//
// ★★ 왜 「유행하는 효과음」을 그대로 못 쓰나 — 볼트에 선이 두 개 그어져 있다
//   ① **인스타 트렌딩 오디오는 API로 못 붙인다.** Instagram Audio API 원문 제한이
//      *"for apps using Facebook Login"* 인데 우리는 **Instagram Login**이다(2026-08-07 확정).
//      → 트렌딩 음원은 **앱에서 손으로만** 되고, 볼트가 *"음원 A/B는 자동화 후보로 올리지 말 것"*
//      이라고 못 박아뒀다. 우리 발행 경로는 API다.
//   ② **AI 생성 음원은 지울 수 없는 메타데이터를 데려온다.** Suno가 전 모델 출력에 비가시
//      워터마크를 붙일 예정이고 SynthID가 업계로 퍼진다 — 볼트 표현 그대로 *"붙는 순간 되돌릴 수 없다."*
//   ▶ 남는 경로는 **우리가 계산식으로 만드는 파형**이다. 저작권 없음 · 워터마크 없음 · 같은 입력이면
//     같은 샘플. 계정 포지션(전부 공개·자체 구축)과도 맞는다.
//
//   ⚠️ **라벨 회피가 이유가 아니다.** 조립본에 Flow의 **AI 생성 음성**이 들어가면 그 릴스는
//      이미 AI 표시 축이다 — 메타 공식이 *"a reel narrated with a realistic AI-generated voiceover"*를
//      라벨 의무 예시로 **명시 열거**한다(2026-08-07 볼트 정정). 우리가 파형을 직접 만드는 이유는
//      **저작권·워터마크·결정론** 셋이고, 라벨은 `is_ai_generated`로 따로 이행한다. 흐리지 않는다.
//
// ★ 목적은 「급시작 메우기」다
//   조립 실물 1편 실측: 훅 구간 **-91dB(완전 무음)** → 발화 **-18.5dB** = **72.5dB 계단.**
//   효과음은 훅 1.6초 동안 올라가 **이음새에서 발화 레벨에 닿아야** 한다.
//
// ★ 왜 ffmpeg 표현식(aevalsrc)을 안 쓰나
//   `min(1,t)`·`gt(t,T)` 의 쉼표가 **필터그래프 파서와 옵션 파서를 두 번 지나며** 깨진다
//   (실측: 3후보 전부 실패, `No option name near '1.6:s=48000:c=stereo'`).
//   셸에서 통한 `\,` 이스케이프가 spawnSync(셸 없음)에서는 안 통했다.
//   → **PCM 샘플을 여기서 직접 계산해 WAV로 쓴다.** 이스케이프 문제가 사라지고 파형을 정확히 통제한다.
//
// 3후보 실측 (조립본 0.4초 창 mean_volume · 발화 -18.5dB 기준):
//   style    t=0.0   0.4    0.8    1.2    판정
//   (없음)   -91.0  -91.0  -91.0  -91.0   ⛔ 계단 72.5dB
//   riser    -40.1  -26.5  -19.0  -13.4   △ 계단은 사라지나 이음새가 발화보다 5dB 세다
//   impact   -15.7  -40.1  -64.3  -15.8   ⛔ 중간이 꺼져 계단이 두 번 생긴다 — **기각**
//   typing   -36.2  -30.7  -25.3  -15.7   ✅ 상승 + 시작도 들린다 + 발화와 3dB 차 — **채택**
//
// 사용:
//   node make-hook-sfx.mjs --out out/_sfx/hook-typing.wav        (기본 typing)
//   node make-hook-sfx.mjs --style riser --gain 0.9 --out ...
//   node make-hook-sfx.mjs --style typing --trace                (렌더 없이 RMS 궤적만)
//   조립에서는 파일을 만들 필요가 없다 — assemble-reel.mjs 가 스타일 이름만 받아 즉석 생성한다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SR = 48000;      // Flow 클립과 같은 샘플레이트 (termcast 는 44.1k — 조립에서 맞춘다)
export const STYLES = ['riser', 'impact', 'typing'];
export const DEFAULT_STYLE = 'typing';   // ✅ 2026-08-24 채택 확정

const TAU = Math.PI * 2;

// 스타일별 샘플 함수를 만든다. D = 길이(초)
function sampler(style, D) {
  const CUT = Math.max(0, D - 0.15);          // 이음새 직전 임팩트 자리
  const sweep = (t, f0, f1, shape) => {       // f(t)=f0+k·t → 위상 = 2π(f0·t + k/2·t²)
    const k2 = (f1 - f0) / D / 2;
    return Math.sin(TAU * (f0 * t + k2 * t * t)) * Math.pow(Math.min(1, t / (D - 0.1)), shape);
  };
  const boom = (t, at, freq, decay) =>
    t < at ? 0 : Math.sin(TAU * freq * (t - at)) * Math.exp(-(t - at) * decay);
  const click = (t, at) =>
    t < at ? 0 : Math.sin(TAU * 1650 * (t - at)) * Math.exp(-(t - at) * 240);

  if (style === 'riser') {
    return {
      fn: (t) => 0.32 * sweep(t, 120, 900, 1.8) + 0.28 * boom(t, CUT, 52, 6),
      why: '사인 스윕 120→900Hz + 이음새 임팩트. 매끄럽지만 이음새가 발화보다 5dB 세다.',
    };
  }
  if (style === 'impact') {
    return {
      fn: (t) => 0.55 * boom(t, 0, 62, 7) + 0.55 * boom(t, CUT, 52, 6),
      why: '저역 붐 2발만. ⛔ 기각 — 중간이 꺼져 계단이 두 번 생긴다.',
    };
  }
  if (style === 'typing') {
    const AT = [0.10, 0.42, 0.74, 1.06];      // 터미널 타이핑 리듬 (훅 앞 2/3에 균등)
    return {
      fn: (t) => 0.30 * AT.reduce((s, at) => s + click(t, at), 0)
               + 0.16 * sweep(t, 110, 760, 2)
               + 0.45 * boom(t, CUT, 52, 6),
      why: '✅ 채택 — 터미널 클릭 4회 + 낮은 라이저 + 이음새 임팩트. 상승하면서 시작도 들린다.',
    };
  }
  return null;
}

/** WAV(PCM 16bit 스테레오 48kHz) 버퍼를 만든다. assemble-reel.mjs 가 이걸 쓴다. */
export function synthWav({ style = DEFAULT_STYLE, ms = 1600, gain = 1.0 } = {}) {
  const s = sampler(style, ms / 1000);
  if (!s) throw new Error(`모르는 style: ${style} (${STYLES.join(' | ')})`);
  const N = Math.round((ms / 1000) * SR);
  const data = Buffer.alloc(N * 4);
  let peak = 0;
  for (let i = 0; i < N; i++) {
    let v = s.fn(i / SR) * gain;
    if (v > 1) v = 1; else if (v < -1) v = -1;      // 하드 클립 방지
    if (Math.abs(v) > peak) peak = Math.abs(v);
    const q = Math.round(v * 32767);
    data.writeInt16LE(q, i * 4);
    data.writeInt16LE(q, i * 4 + 2);
  }
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8);
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28);
  hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
  return { wav: Buffer.concat([hdr, data]), samples: N, peak, why: s.why };
}

// ── CLI (import 될 때는 돌지 않는다)
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const args = { style: DEFAULT_STYLE, ms: 1600, gain: 1.0, out: null, trace: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--style') args.style = argv[++i];
    else if (a === '--ms') args.ms = parseInt(argv[++i], 10);
    else if (a === '--gain') args.gain = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--trace') args.trace = true;
    else { console.error(`모르는 인자: ${a}`); process.exit(1); }
  }
  if (!STYLES.includes(args.style)) {
    console.error(`모르는 --style: ${args.style} (${STYLES.join(' | ')})`); process.exit(1);
  }
  if (!args.out && !args.trace) { console.error('--out 이 필요하다'); process.exit(1); }

  const s = sampler(args.style, args.ms / 1000);
  console.log(`훅 효과음: ${args.style}${args.style === DEFAULT_STYLE ? ' (채택 확정 기본값)' : ''}` +
              ` · ${args.ms}ms · gain ${args.gain} · ${SR}Hz 스테레오`);
  console.log(`  ${s.why}`);

  if (args.trace) {
    const win = Math.round(0.2 * SR);
    const N = Math.round((args.ms / 1000) * SR);
    const rows = [];
    for (let w = 0; w * win < N; w++) {
      let acc = 0, cnt = 0;
      for (let i = w * win; i < Math.min(N, (w + 1) * win); i++) {
        const v = s.fn(i / SR) * args.gain; acc += v * v; cnt++;
      }
      rows.push(`t=${(w * 0.2).toFixed(1)}s ${(20 * Math.log10(Math.sqrt(acc / cnt) || 1e-9)).toFixed(1)}dB`);
    }
    console.log('\n--trace (0.2초 창 RMS): ' + rows.join('  '));
    process.exit(0);
  }

  const { wav, samples, peak } = synthWav(args);
  const outAbs = resolve(HERE, args.out);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, wav);
  console.log(`완료: ${outAbs}  (${samples} 샘플 · 피크 ${(20 * Math.log10(peak)).toFixed(1)}dBFS)`);
  if (peak >= 0.999) console.warn('⚠️ 피크가 0dBFS에 닿았다 — --gain 을 낮춰라(클리핑)');
  console.log('→ 조립에서는 파일이 필요 없다: node assemble-reel.mjs --hook-sfx typing ...');
}
