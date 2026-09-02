// 릴스 조립 — 우리 훅 + 생성형 클립을 우리 쪽에서 붙인다 (2026-08-24 신설)
//
// 왜 Flow가 아니라 여기서 붙이나 (2026-08-24 실측):
//   Flow 타임라인 조립도 크레딧 0이고 되긴 된다. 그런데 셋을 잃는다.
//     ⛔ 720×1280 고정(함정 7) — 해상도를 우리가 못 정한다
//     ⛔ **워터마크가 전 구간에 붙는다** — 우리가 렌더한 훅 구간까지
//     ⛔ 재인코딩 7.52Mbps(원본 1.92의 3.9배) · 19.1MB/20초 = 우리 조립의 2.3배 비효율
//   여기서 붙이면 워터마크가 **생성형 클립 구간에만** 남고(실측: 훅 구간 워터마크 자리 >120 픽셀 0개
//   대 발화 구간 523개), hook-check·reel-review 게이트가 그대로 작동한다.
//
// ★ 왜 720으로 맞추나 — 2026-08-24 실측으로 확정됐다
//   ① Flow 720 → 1080 업스케일은 경계강도 **72%**(28% 손실, 되돌릴 수 없다).
//   ② 우리 1080 → 720 축소는 잉크 2.213 → 2.238%(터미널 본문) · 3.3733 → 3.3764%(워드마크)로
//      **글자가 사라지지 않는다**(육안 판독 동일).
//   ③ ★★★ 결정타 — **인스타가 어차피 720×1280으로 깎아 서빙한다.**
//      `pipeline/publish/check-served-quality.mjs` 실측: 우리 1080×1920 업로드가
//      **720×1280 / 비디오 123kbps / 오디오 21kbps** 로 서빙됐다(8/14 회차).
//      ⚠️ `[n=1]` — `media_url` 이 릴스 17편 중 1편에만 오고, 그 한 편이 하필 최장·최고이탈 회차라
//      「전부 깎인다」와 「저성과만 깎인다」가 안 갈린다. 실무 방향은 같아서 채택했다.
//   ▶ 부수: **오디오도 81 → 21kbps 로 깎인다.** 무음일 때는 무관했지만 음성이 들어가면 실무 항목이다.
//
// ★ 훅 효과음은 기본으로 얹는다 — `typing` (2026-08-24 채택 확정)
//   왜 기본값인가: 효과음 없는 조립본은 훅 -91dB → 발화 -18.5dB = **72.5dB 계단**이었다.
//   결정을 문서에만 적으면 다음 세션에서 조용히 무음으로 회귀한다. 그래서 **--hook 이 있으면
//   자동으로 typing 을 얹고**, 끄려면 `--no-hook-sfx` 를 명시해야 한다.
//   근거·후보 실측표 → make-hook-sfx.mjs 머리말
//
// ★ 오디오는 48kHz로 맞춘다 — termcast는 44.1k, Flow는 48k다. 안 맞추면 concat이 깨진다.
//   ("무음"과 "오디오 트랙 없음"은 다르다 — make-brand-sting.mjs 머리말과 같은 함정)
//
// 사용:
//   node assemble-reel.mjs --hook out/_assemble-01/hook-src.mp4 \
//     --clip ../assets/vod/Man_sitting_at_desk_speaking_202608241326.mp4 \
//     --out out/<slug>/<slug>-reels.mp4
//   훅 길이는 --hook-ms (기본 1600 = make-termcast.mjs 의 HOOK_MS 기본값과 같다)
//   뒤에 더 붙이려면 --clip 을 여러 번 준다 (순서대로 이어진다)
//   훅 효과음: 기본 typing 자동. `--hook-sfx riser|impact|typing` 으로 바꾸거나
//     `--hook-sfx <파일.wav>` 로 직접 주거나 `--no-hook-sfx` 로 끈다.
//
// ⚠️ 산출 파일명을 `out/<slug>/<slug>-reels.mp4` 로 두면 게이트가 바로 잡는다:
//    node hook-check.mjs <slug>  →  node reel-review.mjs <slug>

import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { synthWav, STYLES, DEFAULT_STYLE } from './make-hook-sfx.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = { hook: null, hookMs: 1600, hookSfx: DEFAULT_STYLE, clips: [], out: null,
               w: 720, h: 1280, fps: 24, crf: 18, dry: false };
// ★ --hook-sfx: 훅 구간의 **무음 트랙을 효과음으로 갈아끼운다** (2026-08-24 추가)
//   왜: 조립 실물 1편에서 훅 -91dB → 발화 -19dB 계단이 났다. 훅 오디오는 어차피 무음이라
//   섞는 게 아니라 **교체**가 맞다(amix 는 레벨을 반으로 깎는다).
//   효과음은 make-hook-sfx.mjs 로 만든다 — 트렌딩 음원은 API로 못 붙이고(Instagram Login),
//   AI 생성 음원은 지울 수 없는 워터마크를 데려온다. 그 근거는 그쪽 머리말에 있다.
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--hook') args.hook = argv[++i];
  else if (a === '--hook-ms') args.hookMs = parseInt(argv[++i], 10);
  else if (a === '--hook-sfx') args.hookSfx = argv[++i];
  else if (a === '--no-hook-sfx') args.hookSfx = null;
  else if (a === '--clip') args.clips.push(argv[++i]);
  else if (a === '--out') args.out = argv[++i];
  else if (a === '--w') args.w = parseInt(argv[++i], 10);
  else if (a === '--h') args.h = parseInt(argv[++i], 10);
  else if (a === '--fps') args.fps = parseInt(argv[++i], 10);
  else if (a === '--crf') args.crf = parseInt(argv[++i], 10);
  else if (a === '--dry-run') args.dry = true;
  else { console.error(`모르는 인자: ${a}`); process.exit(1); }
}
if (!args.out) { console.error('--out 이 필요하다'); process.exit(1); }
if (!args.hook && !args.clips.length) { console.error('--hook 또는 --clip 이 하나는 필요하다'); process.exit(1); }

// 입력 목록: 훅이 있으면 맨 앞. 훅만 --hook-ms 로 자른다.
const inputs = [];
if (args.hook) inputs.push({ path: args.hook, trimMs: args.hookMs, label: '훅' });
for (const c of args.clips) inputs.push({ path: c, trimMs: null, label: '클립' });

for (const it of inputs) {
  const p = resolve(HERE, it.path);
  if (!existsSync(p)) { console.error(`없는 파일: ${p}`); process.exit(1); }
  it.abs = p;
}

// 효과음은 **맨 뒤 입력**으로 붙인다 — 앞 인덱스가 밀리면 필터 참조가 다 깨진다.
// 스타일 이름(typing 등)을 주면 파일 없이 **즉석 합성**한다 — 관리할 자산이 하나 줄어든다.
let sfxIdx = null;
let sfxTmp = null;
if (args.hookSfx && !args.hook) {
  console.error('--hook-sfx 는 --hook 과 함께 써야 한다 (끄려면 --no-hook-sfx)');
  process.exit(1);
}
if (args.hookSfx) {
  let abs, label;
  if (STYLES.includes(args.hookSfx)) {
    const { wav, peak } = synthWav({ style: args.hookSfx, ms: args.hookMs });
    sfxTmp = resolve(tmpdir(), `hook-sfx-${args.hookSfx}-${args.hookMs}.wav`);
    writeFileSync(sfxTmp, wav);
    abs = sfxTmp;
    label = `훅효과음:${args.hookSfx}${args.hookSfx === DEFAULT_STYLE ? '(기본)' : ''} 피크 ${(20 * Math.log10(peak)).toFixed(1)}dBFS`;
  } else {
    abs = resolve(HERE, args.hookSfx);
    if (!existsSync(abs)) { console.error(`없는 파일: ${abs}`); process.exit(1); }
    label = '훅효과음(파일)';
  }
  sfxIdx = inputs.length;
  inputs.push({ path: args.hookSfx, abs, trimMs: null, label, sfx: true });
} else if (args.hook) {
  console.warn('⚠️ 훅 효과음을 껐다 — 훅 구간이 완전 무음(-91dB)이라 발화 시작에서 계단이 생긴다.');
}

const ff = [];
for (const it of inputs) {
  if (it.trimMs) ff.push('-t', (it.trimMs / 1000).toFixed(3));
  ff.push('-i', it.abs);
}

// 비디오·오디오를 같은 규격으로 정규화한 뒤 concat.
// ⚠️ setsar=1 을 빼면 소스마다 화면비 메타가 달라 concat 이 거부한다.
const fc = [];
const cat = [];
const hookSec = (args.hookMs / 1000).toFixed(3);
inputs.forEach((it, k) => {
  if (it.sfx) return;                                  // 효과음은 영상이 없다 — concat 대상 아님
  fc.push(`[${k}:v]scale=${args.w}:${args.h}:flags=lanczos,fps=${args.fps},setsar=1[v${k}]`);
  if (k === 0 && sfxIdx !== null) {
    // ⚠️ apad 뒤에 atrim 을 둔다 — 효과음이 훅보다 짧아도 길어도 **정확히 훅 길이**가 된다.
    fc.push(`[${sfxIdx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
            `apad,atrim=0:${hookSec},asetpts=N/SR/TB[a${k}]`);
  } else {
    fc.push(`[${k}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${k}]`);
  }
  cat.push(`[v${k}][a${k}]`);
});
fc.push(`${cat.join('')}concat=n=${cat.length}:v=1:a=1[v][a]`);

const outAbs = resolve(HERE, args.out);
mkdirSync(dirname(outAbs), { recursive: true });

const cmd = [
  '-y', '-hide_banner', '-loglevel', 'error',
  ...ff,
  '-filter_complex', fc.join(';'),
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', String(args.crf),
  '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
  outAbs,
];

console.log(`조립: ${cat.length}개 클립 → ${args.w}x${args.h} @ ${args.fps}fps · crf ${args.crf}${sfxIdx !== null ? ' · 훅 효과음 교체' : ''}`);
inputs.forEach((it, k) => {
  console.log(`  ${k + 1}. [${it.label}] ${it.path}${it.trimMs ? `  (앞 ${it.trimMs}ms 만)` : ''}`);
});
if (args.dry) { console.log('\n--dry-run: 실행하지 않는다.\nffmpeg ' + cmd.join(' ')); process.exit(0); }

const r = spawnSync(ffmpegPath, cmd, { stdio: 'inherit' });
if (r.status !== 0) { console.error('⛔ ffmpeg 실패'); process.exit(1); }

const probe = spawnSync(ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1'), [
  '-v', 'error', '-show_entries', 'format=duration,size', '-of', 'default=nw=1', outAbs,
], { encoding: 'utf-8' });
if (sfxTmp) rmSync(sfxTmp, { force: true });
console.log(`완료: ${outAbs}`);
if (probe.stdout) console.log('  ' + probe.stdout.trim().split('\n').join(' · '));
console.log('→ 다음: node hook-check.mjs <slug>   그다음   node reel-review.mjs <slug>');
console.log('⚠️ 발행 원고(훅 문구·캡션)는 CLAUDE.md 작업 4 — no-ai-tell 0절 채우기 점검을 따로 거친다.');
