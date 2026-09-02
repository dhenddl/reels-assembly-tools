// 브랜드 엔딩 스팅 렌더 (2026-08-24 신설) — 워드마크가 램프처럼 켜지는 짧은 클립
//
// 왜 우리 스택으로 만드나 (Flow 대신):
//   2026-08-24 테스트 4 v2가 증명한 것은 **설계**였다 — "밝기만 변하는 리빌"이 읽히고,
//   대문자 `DHENDDL1`이 `l`/`1` 혼동을 없앤다. 그 설계는 우리 렌더러가 이미 할 수 있다.
//   Flow 산출물은 발행에 쓸 수 없었다:
//     ⛔ Gemini 워터마크가 구워져 있다 — 제공자 워터마크를 가리는 건 약관 위반 소지
//     ⛔ 720×1280 — 우리 릴스 1080×1920으로 1.5배 올리면 **픽셀 정확히 만든 워드마크가 흐려진다**
//     ⛔ 지우라고 명시했는데도 **들리는 소리**가 붙는다(평균 -48.0dB/최대 -7.8dB = 미세 효과음)
//   여기서는 셋 다 없다. 그리고 **같은 입력이면 같은 픽셀**이다(2회 렌더 해시 동일 확인).
//   ⚠️ 단 **무음 오디오 트랙은 만든다** — 기존 릴스에 무음 AAC가 있어서, 없으면 concat이 깨진다.
//   근거 문서: <노트 문서 경로> 릴스 테스트 실행 프롬프트 (장전).md 「테스트 4 v2 실측」
//
// 설계는 v2 실측에서 통과한 것을 그대로 옮겼다:
//   ① 카메라 0 — 확대·이동 없음. 마지막 프레임이 정지 상태와 정확히 같다
//   ② 글자는 **제자리에서 밝아진다** — 그려지지도, 타이핑되지도, 밀려 들어오지도 않는다
//   ③ 글자당 짧은 플리커 2회(램프 예열) 뒤 안정 점등
//   ④ 밑줄은 글자가 다 켜진 뒤 좌→우로
//   ⑤ 배경은 완전 단색(팔레트 그대로)
//
// ⚠️ 색·폰트는 palette.mjs가 단일 출처다. 캐러셀과 어긋나지 않게 --palette-from 을 같이 준다.
// ⚠️ 소리는 없다(무음 트랙만 있다 — 기존 릴스와 같은 규격). 발행 정책과 같다.
//
// 사용:
//   node make-brand-sting.mjs --out out/day-x/sting.mp4
//   node make-brand-sting.mjs --text DHENDDL1 --ms 3000 --out out/day-x/sting.mp4 \
//     --palette-from out/day-x/slides.json
//   릴스 뒤에 붙이려면: --append out/day-x/day-x-reels.mp4  (원본은 건드리지 않고 새 파일로 낸다)
//   참고 이미지(PNG)로 뽑으려면: --still --out ../assets/test-inputs/wordmark-DHENDDL1-1152x2048.png
//     ⚠️ 크기는 1080x1920 이다. 생성형에 넣을 64 정렬 1152x2048 이 필요하면 --w/--h 가 아니라
//        이 스크립트를 고쳐야 한다(현재는 릴스 규격 고정) — 2026-08-24 시점 필요 없다(Flow 720p 상한).
//     → --append 를 주면 **CTA가 자동으로 켜진다**(마지막 프레임에서 「저장·팔로우」가 사라지지 않게).
//        단독 아이덴트로 쓰려면 --no-cta, 붙이지 않고도 CTA를 원하면 --cta.

import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTheme, rgba } from './palette.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = {
  text: 'DHENDDL1',       // ★ 대문자 — 소문자 l 과 숫자 1 이 구분되지 않는다(2026-08-24 실측: 기준선 정렬 IoU 0.691 vs 대문자 0.307)
  ms: 3000,              // 전체 길이. 릴스 뒤에 붙이는 용도라 10초가 아니라 3초가 기본이다
  fps: 24,               // 우리 릴스와 같은 값
  out: null,
  paletteFrom: null,
  append: null,          // 이 MP4 뒤에 스팅을 이어붙인 새 파일을 만든다
  keepFrames: false,
  trace: false,
  // ★ CTA 오버레이 (2026-08-24 추가). null = --append 를 쓰면 자동 on, 단독 렌더면 off.
  //   왜: 스팅을 릴스 뒤에 붙이면 「저장·팔로우」가 마지막 프레임에서 사라진다 —
  //   마지막 프레임은 사람들이 정지 화면으로 보는 자리다. 붙이는 경우엔 CTA가 끊기면 안 된다.
  //   단독 아이덴트(스토리·프로필용)로 쓸 때는 CTA가 없어야 하므로 기본을 off로 둔다.
  cta: null,
  // ★ --still: 영상 대신 **최종 정지 상태 PNG** 한 장을 낸다 (2026-08-24 추가).
  //   왜: 워드마크 PNG를 임시 스크립트로 만들었더니 **레시피가 어디에도 남지 않았다.**
  //   같은 색·폰트·배치를 여기서 내면 영상과 스틸이 **한 출처**에서 나온다.
  still: false,          // 렌더 없이 비트별 시각만 (make-termcast.mjs --trace 와 같은 규율)
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--text') args.text = argv[++i];
  else if (a === '--ms') args.ms = parseInt(argv[++i], 10);
  else if (a === '--fps') args.fps = parseInt(argv[++i], 10);
  else if (a === '--out') args.out = argv[++i];
  else if (a === '--palette-from') args.paletteFrom = argv[++i];
  else if (a === '--append') args.append = argv[++i];
  else if (a === '--keep-frames') args.keepFrames = true;
  else if (a === '--trace') args.trace = true;
  else if (a === '--cta') args.cta = true;
  else if (a === '--no-cta') args.cta = false;
  else if (a === '--still') args.still = true;
}
if (!args.out) throw new Error('--out <mp4|png> 필요');
if (args.still && !/\.png$/i.test(args.out)) throw new Error('--still 은 --out 을 .png 로 준다');
if (!args.still && !/\.mp4$/i.test(args.out)) throw new Error('--out 은 .mp4 로 준다 (스틸은 --still)');
if (!/^[A-Za-z0-9._-]+$/.test(args.text)) {
  throw new Error(`--text 는 ASCII 영숫자만 (한글은 렌더 폭 계산이 달라진다): ${args.text}`);
}

let themeMeta = {};
if (args.paletteFrom) {
  const p = resolve(HERE, args.paletteFrom);
  if (!existsSync(p)) throw new Error(`--palette-from 파일이 없다: ${p}`);
  themeMeta = JSON.parse(readFileSync(p, 'utf8')).meta ?? {};
  console.log(`팔레트 출처: ${basename(p)}${themeMeta.palette ? '' : ' (meta.palette 없음 → 기본값)'}`);
}
const { palette: pal, fonts } = loadTheme(themeMeta);

const W = 1080, H = 1920;
const N = args.text.length;
// --append 면 CTA를 켠다(연속성). 단독이면 끈다(아이덴트). --cta/--no-cta 로 명시 가능.
const CTA = args.cta === null ? Boolean(args.append) : args.cta;

// ---- 타임라인 (ms, 결정론적) ----
// v2 프롬프트의 구간 비율을 3초로 압축했다: 어둠 → 글자 점등 → 밑줄 → 홀드
const DARK   = Math.round(args.ms * 0.07);                 // 시작 암전 (창을 인지하는 시간이 아니라 "켜지기 전"이다)
const LIGHT  = Math.round(args.ms * 0.53);                 // 글자가 좌→우로 켜지는 구간
const RULE   = Math.round(args.ms * 0.13);                 // 밑줄이 좌→우로
const HOLD   = args.ms - DARK - LIGHT - RULE;              // 나머지는 정지 홀드
const STEP   = LIGHT / N;                                  // 글자 하나당 배정 시간
const FLICK  = Math.min(70, STEP * 0.34);                  // 플리커 1회 길이

if (HOLD < 200) throw new Error(`--ms ${args.ms} 는 너무 짧다 (홀드 ${HOLD}ms). 2000 이상 권장`);

if (args.trace) {
  const row = (t, m, s) => console.log(`  ${String(Math.round(t)).padStart(5)}ms  ${(t / 1000).toFixed(2).padStart(5)}s  ${m} ${s}`);
  console.log('\n--- 스팅 페이싱 트레이스 (렌더하지 않는다) ---');
  row(0, '[암]', `암전 ${DARK}ms — 배경만`);
  for (let i = 0; i < N; i++) row(DARK + i * STEP, ` ${String(i + 1).padStart(2)}.`, `'${args.text[i]}' 점등 (플리커 ${Math.round(FLICK)}ms x2)`);
  row(DARK + LIGHT, '[밑]', `밑줄 좌→우 ${RULE}ms`);
  row(DARK + LIGHT + RULE, '[홀]', `정지 홀드 ${HOLD}ms`);
  row(args.ms, '[끝]', `총 ${(args.ms / 1000).toFixed(2)}s · ${args.fps}fps · ${Math.ceil(args.ms / 1000 * args.fps)}프레임 · ${W}x${H}`);
  console.log(`\n  글자당 ${Math.round(STEP)}ms · 홀드 비율 ${(100 * HOLD / args.ms).toFixed(1)}% · CTA ${CTA ? 'on (0초부터 상시 — 컷을 넘어 끊기지 않는다)' : 'off (단독 아이덴트)'}`);
  console.log('  렌더는 하지 않았다. --trace 를 빼고 다시 실행하면 렌더한다.');
  process.exit(0);
}

// ---- HTML (시간 t로 구동 — 벽시계에 의존하지 않는다) ----
const chars = [...args.text].map((c, i) =>
  `<span class="g" data-i="${i}">${c === ' ' ? '&nbsp;' : c}</span>`).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;background:${pal.bg};overflow:hidden}
  body{font-family:${fonts.mono};color:${pal.text}}   /* pill 이 이 폰트를 상속한다 — termcast 와 같아야 한다 */
  .wrap{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center}
  .mark{font:700 200px/1 ${fonts.mono};letter-spacing:0;white-space:nowrap;display:inline-block}
  .g{color:${pal.accent};opacity:0}
  .rule{height:9px;background:${pal.accent};margin:34px auto 0;width:0}
  /* ⚠️ 아래 CTA 3줄은 make-termcast.mjs 의 값과 **글자 하나도 다르지 않아야 한다** —
     릴스 마지막 프레임과 스팅 첫 프레임이 픽셀 단위로 이어져야 컷이 안 보인다.
     한쪽만 고치면 조용히 어긋난다(palette.mjs 머리말이 경고한 그 계열). */
  .cta { position:absolute; left:0; right:0; bottom:0;
    display:flex; gap:24px; justify-content:center; align-items:center;
    padding:48px 40px 60px; background:linear-gradient(transparent, ${rgba(pal.bg, 0.9)} 30%); }
  .pill { font-size:40px; font-weight:800; padding:26px 40px; border-radius:16px; }
  .pill.save { background:${pal.accent}; color:${pal.onAccent}; }
  .pill.follow { border:2px solid ${pal.accent}; color:${pal.accent}; }
</style></head><body>
<div class="wrap"><div class="mark" id="mark">${chars}</div><div class="rule" id="rule"></div></div>
${CTA ? `<div class="cta">
  <span class="pill save">📌 저장</span>
  <span class="pill follow">▶ 팔로우하고 다음 편</span>
</div>` : ''}
<script>
const N=${N}, DARK=${DARK}, STEP=${STEP}, LIGHT=${LIGHT}, RULE=${RULE}, FLICK=${FLICK};
const gs=[...document.querySelectorAll('.g')], rule=document.getElementById('rule');
// 워드마크 폭을 재서 밑줄 길이를 맞춘다 — 참고 자산과 같은 관계(밑줄 폭 = 텍스트 폭)
const MARKW = document.getElementById('mark').getBoundingClientRect().width;

// 램프 예열: 두 번 깜빡인 뒤 안정. 각 글자는 자기 구간 안에서만 변하고 그 뒤엔 1로 고정된다.
function lamp(dt){
  if (dt < 0) return 0;
  if (dt < FLICK)       return 0.85;
  if (dt < FLICK*1.6)   return 0.15;
  if (dt < FLICK*2.4)   return 1.0;
  if (dt < FLICK*3.0)   return 0.45;
  return 1;
}
window.frame = (t) => {
  for (let i=0;i<N;i++) gs[i].style.opacity = lamp(t - (DARK + i*STEP));
  const r = (t - (DARK+LIGHT)) / RULE;
  rule.style.width = (r <= 0 ? 0 : Math.min(1, r) * MARKW) + 'px';
};
window.frame(0);
</script></body></html>`;

// ---- 프레임 캡처 ----
const outAbs = resolve(HERE, args.out);
mkdirSync(dirname(outAbs), { recursive: true });
let framesDir = join(dirname(outAbs), 'sting-frames');
if (existsSync(framesDir)) {
  // make-termcast.mjs와 같은 이유 — 열어본 PNG의 핸들 때문에 rmdir이 EBUSY로 죽는 사고가 있었다
  try { rmSync(framesDir, { recursive: true, force: true }); }
  catch { framesDir = join(dirname(outAbs), `sting-frames-${process.pid}`); }
}
mkdirSync(framesDir, { recursive: true });

const nFrames = Math.ceil((args.ms / 1000) * args.fps);
console.log(`렌더: "${args.text}" ${N}자 · ${(args.ms / 1000).toFixed(2)}s · ${args.fps}fps · ${nFrames}프레임 · ${W}x${H} · 무음 · CTA ${CTA ? 'on' : 'off'}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });

// ★ --still: 최종 정지 상태(전부 점등 + 밑줄 완성) 한 장만 낸다.
//   Flow 같은 생성형에 넣는 **참고 이미지**가 이 경로로 나온다 — 영상과 같은 출처라 색·배치가 어긋나지 않는다.
if (args.still) {
  await page.evaluate((t) => window.frame(t), args.ms);
  const stillAbs = resolve(HERE, args.out);
  mkdirSync(dirname(stillAbs), { recursive: true });
  await page.screenshot({ path: stillAbs });
  await browser.close();
  rmSync(framesDir, { recursive: true, force: true });
  console.log(`스틸 저장: ${stillAbs} (${W}x${H}, 최종 상태)`);
  process.exit(0);
}

for (let f = 0; f < nFrames; f++) {
  await page.evaluate((t) => window.frame(t), (f / args.fps) * 1000);
  await page.screenshot({ path: join(framesDir, `f-${String(f).padStart(5, '0')}.png`) });
}
await browser.close();
console.log(`프레임 ${nFrames}장 캡처 완료`);

// ---- ffmpeg: 이미지 시퀀스 → MP4 (무음 트랙 포함) ----
// ⚠️ 소리는 없지만 **무음 오디오 트랙은 만든다.** 오디오가 아예 없으면 기존 릴스와
//    스트림 수가 달라져 `concat -c copy` 가 깨진다(실측으로 발견).
//    파라미터는 make-termcast.mjs 와 같은 값으로 맞춘다 — anullsrc stereo/44100, aac 128k.
//    (Flow 산출물의 문제는 "오디오 트랙"이 아니라 **지우라고 했는데 들리는 소리가 붙은 것**이었다)
const durSec = (nFrames / args.fps).toFixed(3);
const r = spawnSync(ffmpegPath, [
  '-y', '-loglevel', 'error',
  '-framerate', String(args.fps),
  '-i', join(framesDir, 'f-%05d.png'),
  '-f', 'lavfi', '-t', durSec, '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
  '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(args.fps),
  '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart',
  outAbs,
], { encoding: 'utf8' });
if (r.status !== 0) throw new Error(`ffmpeg 실패: ${r.stderr}`);
if (!args.keepFrames) rmSync(framesDir, { recursive: true, force: true });
console.log(`완료: ${outAbs}`);

// ---- (선택) 릴스 뒤에 이어붙이기 ----
// ⚠️ 원본을 덮어쓰지 않는다. `<원본>-with-sting.mp4` 로 낸다.
if (args.append) {
  const base = resolve(HERE, args.append);
  if (!existsSync(base)) throw new Error(`--append 원본이 없다: ${base}`);
  const merged = base.replace(/\.mp4$/i, '-with-sting.mp4');
  const listFile = join(dirname(outAbs), 'concat-list.txt');
  // concat demuxer는 같은 코덱·해상도·fps를 요구한다 — 우리 릴스와 스팅이 둘 다 1080x1920/24fps/libx264라 맞는다.
  writeFileSync(listFile, `file '${base.replace(/\\/g, '/')}'\nfile '${outAbs.replace(/\\/g, '/')}'\n`, 'utf8');
  const c = spawnSync(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
    '-i', listFile, '-c', 'copy', merged], { encoding: 'utf8' });
  rmSync(listFile, { force: true });
  if (c.status !== 0) {
    console.warn(`⚠️ 이어붙이기 실패(스팅 자체는 정상): ${c.stderr?.trim()}`);
    console.warn('   원본과 코덱·해상도·fps가 다를 수 있다. ffprobe로 확인할 것.');
  } else {
    console.log(`이어붙임: ${merged}`);
    console.log('  ⚠️ 원본은 그대로 뒀다. 발행 전 reel-review.mjs 로 새 파일을 검사할 것.');
  }
}
