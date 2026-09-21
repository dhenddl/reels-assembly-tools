// make-termcast.mjs — publish.mjs 실행 장면을 세로 릴스(터미널 스크린캐스트)로 렌더
// 방식 A(구축기 컨셉): 명령어 타이핑(1초 훅) → 실제 발행 출력 줄 순차 표출 → 발행 완료.
// 프레임은 Playwright로 결정론적 캡처(시간 t로 구동) → ffmpeg-static으로 1080x1920 무음 MP4.
// make-reels.mjs의 ffmpeg + --drive(rclone) 업로드 패턴 재사용. 트렌드 음악은 폰 업로드 시 얹는다.
//
// 사용법:
//   node make-termcast.mjs --lines out/day-2/publish-output.txt \
//     --cmd "node publish.mjs --manifest post-day-2.json" \
//     --title "day-2.sh — 무인 수익 실험" \
//     --out out/day-2/day-2-reels.mp4 [--drive gdrive:dhenddl-reels/]
//   실시간 캡처: --run "node ../publish/publish.mjs --manifest ../publish/post-day-2.json --dry-run"
//     (--run 은 명령을 실제 실행해 stdout 을 캡처 — API 를 호출하므로 재렌더 시엔 --lines 권장)
//   ★ 색을 바꾼 시리즈면 --palette-from <같은 소재의 slides.json> 을 반드시 같이 준다.
//     안 주면 릴스만 기본 초록으로 나가서 캐러셀과 어긋난다.
//   ★ 렌더 전 페이싱 검산: 같은 인자에 `--trace` 만 붙인다 — 렌더하지 않고
//     비트별 누적 시각(훅→타이핑→각 출력 줄→END_HOLD→루프)과 점검 4줄을 찍는다.
//     기준의 출처는 <노트 문서 경로> 조사 (2026-08-24 ...).md
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tryWriteReelCaption, readPublishDate, drivePathFor } from './reel-caption.mjs';
import { loadTheme, rgba } from './palette.mjs';
import { 구도 } from './safe-zone.mjs';
import { renderRecipePath } from './lines-path.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = {
  lines: null, run: null, cmd: 'node publish.mjs', title: 'publish.sh',
  out: null, fps: 24, drive: null, rclone: 'rclone', keepFrames: false, slug: null, manifest: null, pubdate: null, loop: false,
  hookText: null, hookSub: null, hookBadge: null, hookMs: 1600, paletteFrom: null,
  outro: '🚀 인스타 + 스레드 동시 발행 완료',   // 마지막 성공 줄. 발행 외 명령(예: check-insights)엔 --outro로 교체
  // ★ 2026-08-11 신설 — 캐릭터 + AI 음성 (8/14 포맷 실험용). 셋 다 기본 off.
  //   ⚠️ 안 주면 지금까지 나간 릴스와 **바이트 단위로 동일**하게 나온다(회귀 검증 완료).
  character: null, narrate: null, voice: 'ko-KR-InJoonNeural', voiceGap: 250,
  voiceRate: '+0%',      // edge-tts --rate. "+20%"면 20% 빠르게 읽는다
  charH: null,           // 캐릭터 높이(px). 생략 시 자막 있으면 700, 없으면 520(README 실측값)
  // ★ 2026-08-24 신설 — 빈 골격(--skeleton). 기본 off.
  //   ⚠️ 안 주면 지금까지 나간 릴스와 **바이트 단위로 동일**하게 나온다(A/B 해시 회귀 검증 완료).
  skeleton: false,
  // ★ 2026-08-24 신설 — 페이싱 트레이스(--trace). 렌더하지 않고 비트별 시각만 찍는다. 기본 off.
  trace: false,
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--lines') args.lines = argv[++i];
  else if (a === '--run') args.run = argv[++i];
  else if (a === '--cmd') args.cmd = argv[++i];
  else if (a === '--title') args.title = argv[++i];
  else if (a === '--out') args.out = argv[++i];
  else if (a === '--fps') args.fps = parseInt(argv[++i], 10);
  else if (a === '--drive') args.drive = argv[++i];
  else if (a === '--rclone') args.rclone = argv[++i];
  else if (a === '--keep-frames') args.keepFrames = true;
  else if (a === '--slug') args.slug = argv[++i];       // 캡션 자동탐지용(생략 시 --out 폴더명)
  else if (a === '--manifest') args.manifest = argv[++i]; // 캡션 매니페스트 직접 지정
  else if (a === '--outro') args.outro = argv[++i];       // 마지막 성공 줄 교체(발행 외 명령용)
  else if (a === '--pubdate') args.pubdate = argv[++i];   // 드라이브 파일명 접두 발행일. 생략 시 매니페스트 publishDate
  else if (a === '--loop') args.loop = true;              // 끝→처음 이어지는 루프 설계(조회/도달 비율 실험용)
  else if (a === '--hook-text') args.hookText = argv[++i]; // ★ 0초에 띄우는 큰 글씨 결론(\n=줄바꿈)
  else if (a === '--hook-sub') args.hookSub = argv[++i];   // 훅 아래 보조 문장
  else if (a === '--hook-badge') args.hookBadge = argv[++i];
  else if (a === '--hook-ms') args.hookMs = parseInt(argv[++i], 10);
  // ★ 같은 소재의 캐러셀 slides.json을 가리킨다 — 캐러셀과 릴스 색이 어긋나지 않게.
  //   생략하면 palette.mjs 기본값(=지금까지 발행한 색)을 쓴다.
  else if (a === '--palette-from') args.paletteFrom = argv[++i];
  // ★ 캐릭터 + 음성 (2026-08-11)
  else if (a === '--character') args.character = argv[++i];   // 누끼 PNG. assets/characters/*-cutout.png
  else if (a === '--narrate') args.narrate = argv[++i];        // 내레이션 대본(한 줄 = 한 문장)
  else if (a === '--voice') args.voice = argv[++i];            // edge-tts 음성명
  else if (a === '--voice-gap') args.voiceGap = parseInt(argv[++i], 10); // 문장 사이 무음(ms)
  else if (a === '--voice-rate') args.voiceRate = argv[++i];             // 읽는 속도 "+20%" 등
  else if (a === '--character-height') args.charH = parseInt(argv[++i], 10);
  else if (a === '--skeleton') args.skeleton = true;          // ★ 빈 골격을 먼저 인쇄하고 채운다
  else if (a === '--trace') args.trace = true;                // ★ 렌더 전 페이싱 검산(렌더 안 함)
}
if (!args.out) throw new Error('--out <mp4> 필요');

// ---- 색·폰트 (palette.mjs가 단일 출처) ----
let themeMeta = {};
if (args.paletteFrom) {
  const p = resolve(HERE, args.paletteFrom);
  if (!existsSync(p)) throw new Error(`--palette-from 파일이 없다: ${p}`);
  themeMeta = JSON.parse(readFileSync(p, 'utf8')).meta ?? {};
  console.log(`팔레트 출처: ${basename(p)}${themeMeta.palette ? '' : ' (meta.palette 없음 → 기본값)'}`);
}
const { palette: pal, fonts } = loadTheme(themeMeta);

// ---- 출력 줄 확보 (실제 publish.mjs 출력) ----
let raw;
if (args.run) {
  console.log(`캡처 실행: ${args.run}`);
  const parts = args.run.split(' ').filter(Boolean);
  const r = spawnSync(parts[0], parts.slice(1), { cwd: HERE, encoding: 'utf8' });
  raw = r.stdout || '';
  if (r.status !== 0) console.warn('⚠️ 캡처 명령 비정상 종료 — 캡처된 출력 일부만 사용');
} else if (args.lines) {
  raw = readFileSync(resolve(HERE, args.lines), 'utf8');
} else {
  throw new Error('--lines <file> 또는 --run "<cmd>" 중 하나 필요');
}

// 세로 모바일 가독을 위해 컨테이너 ID·dry-run 안내를 정리
const tidy = (l) => l
  .replace(/\s*\(\d{6,}\)/g, '')             // "@dhenddl1 (3714...)" → "@dhenddl1"
  .replace(/:\s*\d{6,}/g, ' ✓')              // "...: 18068..." → " ✓" (컨테이너 ID 제거)
  .replace(/\s*컨테이너/g, '')                // 터미널 용어 정리(세로 모바일 가독)
  .replace(/\s{2,}/g, ' ')
  .trim();
const outLines = raw.split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((l) => !/dry-run|발행 직전 정지|검수/.test(l))   // dry-run 안내 제거
  .map(tidy);
if (args.outro) outLines.push(args.outro);                 // 마지막 성공 줄(기본=실제 발행 결과)

// ---- 타임라인 (ms, 결정론적) ----
// 타이핑 속도. 훅 프레임이 없을 때는 타이핑 자체가 훅이라 천천히(30자/초 = 1초 훅) 보여줬다.
// ★ 훅 프레임이 있으면 타이핑은 훅이 아니라 **전환 구간**이다 — 결론은 이미 0초에 전달됐으므로
//   여기서 시간을 쓰면 3초 이탈 구간 안에 "명령어만 치는 빈 화면"이 남는다 → 2배로 넘긴다.
const CPS = args.hookText ? 60 : 30;
const typeDur = (args.cmd.length / CPS) * 1000;
const ENTER_PAUSE = args.hookText ? 220 : 350;
// ✅ 2026-08-24 판정: **220ms 유지.** 권고는 300ms 이상이지만 훅이 있으면 결론이 0초에 이미
//    전달됐으므로 "명령어 치는 화면"은 3초 이탈 구간 안의 죽은 시간이다. 위 LINE_STEP 판정과 같은
//    근거·같은 재검토 조건(릴스 길이 연장).

// ---- ★★ AI 음성 내레이션 (2026-08-11 신설) ----
//
// ⚠️ **여기가 이 기능의 어려운 자리다.** 캐릭터를 얹는 건 <img> 한 장이지만, 음성은 **길이가 대본에 따라
//    달라진다** — 지금까지 릴스는 `LINE_STEP = 470ms`로 고정이라 10초에 11줄이 떴다. 음성으로 읽으면
//    같은 내용이 20초가 넘는다. 그래서 **음성이 타임라인의 주인이 되고 줄이 거기 맞춰 분배**된다.
//
// 설계: 대본 전체를 edge-tts에 한 번에 넘긴다(문장 사이 쉼은 구두점으로 자연히 생긴다).
//       총 길이를 재서 `LINE_STEP = 총길이 ÷ 줄수`로 나눈다. 줄 수가 대본 문장 수와 달라도 된다.
// ⚠️ 1:1 매칭(대본 한 줄 = 출력 한 줄)은 일부러 안 했다 — 터미널 출력에는
//    `[IG] 아이템 3/7 컨테이너: 18075...` 같은 **읽을 수 없는 줄**이 섞인다.
function probeMs(file) {
  // ffprobe를 따로 안 쓴다 — ffmpeg-static만 있으면 되게 stderr의 Duration을 읽는다.
  const r = spawnSync(ffmpegPath, ['-i', file], { encoding: 'utf8' });
  const m = (r.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (!m) throw new Error(`오디오 길이를 못 읽었다: ${file}`);
  return Math.round((+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])) * 1000);
}

let narrationMs = 0, narrationFile = null;
const cues = [];                 // {s,e,t} — 내레이션 시작 기준 상대 ms
if (args.narrate) {
  const scriptPath = resolve(process.cwd(), args.narrate);
  const script = readFileSync(scriptPath, 'utf8')
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join('\n');
  if (!script) throw new Error(`--narrate 대본이 비었다: ${args.narrate}`);
  narrationFile = join(dirname(resolve(process.cwd(), args.out)), 'narration.mp3');
  const vttFile = narrationFile.replace(/\.mp3$/, '.vtt');
  mkdirSync(dirname(narrationFile), { recursive: true });
  const t = spawnSync('edge-tts',
    ['--voice', args.voice, '--rate', args.voiceRate, '--text', script,
     '--write-media', narrationFile, '--write-subtitles', vttFile],
    { encoding: 'utf8' });
  if (t.status !== 0 || !existsSync(narrationFile)) {
    throw new Error(`edge-tts 실패 — ${t.stderr?.trim() || t.error?.message || '출력 파일 없음'}`);
  }
  narrationMs = probeMs(narrationFile);

  // ★★★ 자막 큐 — 이게 C안(자막이 화면 주인공)의 전부다.
  //   edge-tts `--write-subtitles`가 **문장별 시작·끝 시각**을 준다(실측: 7문장 → 큐 8개).
  //   그래서 문장마다 따로 합성해 길이를 잴 필요가 없다 — 호출 1회로 프로소디도 자연스럽고
  //   타이밍도 정확하다. 시각은 **내레이션 시작(=START_OUT) 기준 상대값**이다.
  const vtt = existsSync(vttFile) ? readFileSync(vttFile, 'utf8') : '';
  const toMs = (h, m, s, ms) => (+h * 3600 + +m * 60 + +s) * 1000 + +ms;
  for (const m of vtt.matchAll(
    /(\d\d):(\d\d):(\d\d)[.,](\d{3})\s*-->\s*(\d\d):(\d\d):(\d\d)[.,](\d{3})\s*\n([\s\S]*?)(?:\n\s*\n|$)/g)) {
    const text = m[9].replace(/\s+/g, ' ').trim();
    if (text) cues.push({ s: toMs(m[1], m[2], m[3], m[4]), e: toMs(m[5], m[6], m[7], m[8]), t: text });
  }
  if (!cues.length) throw new Error(`자막 큐를 못 읽었다: ${vttFile} — 자막 없이 가려면 이 검사를 지우면 된다`);
  console.log(`음성: ${args.voice} · ${(narrationMs / 1000).toFixed(2)}s · 자막 큐 ${cues.length}개 → ${basename(narrationFile)}`);
}

// 음성이 있으면 줄 간격은 음성 길이에서 나온다. 없으면 지금까지 쓰던 470ms 그대로.
const LINE_STEP = narrationMs
  ? Math.max(200, Math.round(narrationMs / outLines.length))
  : 470;                                                   // 줄당 등장 간격
// ✅ 2026-08-24 판정: **470ms 유지.** OpenMontage 권고 줄 간격은 500~1100ms이고 우리는 30ms 빠르다
//    (`--trace`가 매 렌더 `CHK`로 찍는다). 그래도 올리지 않는다 —
//    ① 우리 이탈은 첫 3초에 몰려 있고(69~84%) 그 구간엔 줄이 2개뿐이다 = 줄 간격은 이탈 후의 변수
//    ② 형식 레버 실측이 반박: 7/28 69.4 → 형식 만진 8/14 **89.0** → 소재 바꾼 8/19 **65.5**
//    ③ 30ms를 도달 편차 속에서 가려내려면 회차가 여러 번 필요하다
//    ▶ **재검토 조건: 릴스 길이 연장을 결정하는 순간**(11초 압축이라는 근거가 사라진다).
const END_HOLD = 2400;

// ★★★ 훅 프레임 (2026-08-06 신설) — 0초에 결론을 전달한다.
//
// 왜: `reels_skip_rate` 실측이 8건 전부 **69~84%가 첫 3초에 이탈**이었고, 코드 타임라인을 대조하니
//     원인이 우리 구조였다 — 첫 3초는 "명령어를 타이핑하는 셋업"이고 결론 줄은 6.3초에 등장한다.
//     originality 릴스 평균 시청이 2.64초였으므로 **평균 시청자는 결론을 본 적이 없다**(도달률 42%).
//
// ⚠️ 그래서 "훅 프레임을 앞에 덧붙이는" 방식은 틀렸다 — 페이오프가 오히려 더 늦어진다.
//    훅 텍스트 자체가 **결론**이어야 하고, 터미널은 셋업이 아니라 **증거**로 뒤에 온다.
//    → 페이오프 시점 6.3초 → **0초**.
const HOOK_MS = args.hookText ? Math.max(0, args.hookMs) : 0;
const START_OUT = HOOK_MS + typeDur + ENTER_PAUSE;

// --loop: 마지막 구간에서 화면을 첫 프레임 상태(빈 프롬프트 + 커서)로 되돌려 이어붙임이 안 보이게 한다.
// 근거: 우리 릴스는 이미 조회/도달 1.08~1.43배로 반복 재생이 일어나고 있고(팁2는 완주율 174%),
//       루프 설계는 그 현상을 증폭하는 방향이다 → summaries/플랫폼-알고리즘/릴스 알고리즘 공략집 2026.
// ⚠️ 기본값 off — 켜면 포맷이 바뀌어 기존 릴스와의 실측 비교가 깨진다. 관찰 지표는 조회/도달 비율.
const LOOP_MS = args.loop ? 800 : 0;
const LOOP_START = START_OUT + outLines.length * LINE_STEP + END_HOLD;
const totalMs = Math.ceil(LOOP_START + LOOP_MS);

// ---- HTML ----
// ★ 캐릭터는 data URI로 심는다 — 프레임 캡처 중 로컬 파일 경로 접근에 기대지 않기 위해서다.
//   (파일 URL로 두면 렌더 타이밍에 따라 아직 안 뜬 프레임이 섞일 수 있다.)
const charDataURI = args.character
  ? 'data:image/png;base64,' + readFileSync(resolve(process.cwd(), args.character)).toString('base64')
  : null;
// 자막 모드에서는 하단을 채워야 하므로 크게(700), 자막이 없으면 README 실측값(520) 그대로.
const charH = args.charH ?? (cues.length ? 700 : 520);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// ★★★ 빈 골격 (--skeleton, 2026-08-24 신설)
//
// 왜: henry_upnomad 릴스 실측(조회 30,776 · 26.9초 · 장면 전환 0건)에서 **컷 없이 27초를 끄는 장치**가
//     이것 하나였다 — 번호 1~36을 0초부터 인쇄해두고 이름만 채운다. 첫 프레임에 "36개짜리이고
//     지금 1개 찼다"가 전달되고, **남은 칸이 이탈을 막는다** [해석].
//     우리 릴스는 publish.mjs 실행 로그라 이 장치가 그대로 맞는다 — 대기 항목은 [ ], 완료는 실제 출력 줄.
//
// ⚠️ 훅을 대체하지 않는다. 훅(0초 결론)은 2026-08-06에 3초 이탈 69~84%를 고치려고 넣은 것이고,
//    골격은 훅이 걷힌 뒤 **증거 구간의 완주 장치**다. 순서를 바꾸면 페이오프가 다시 늦어진다.
// ⚠️ 레이아웃은 안 움직인다 — 실제 줄(.tx)이 흐름에 남아 높이를 잡고, 골격(.sk)은 absolute다.
//    opacity:0 엘리먼트도 자리는 차지하므로 종전에도 18줄 높이가 t=0에 이미 확보돼 있었다.
//
// 골격 바 길이는 실제 줄의 **터미널 셀 폭**으로 잡는다(한글=2칸). ch 단위라 폰트 크기가 바뀌어도 따라간다.
const cellW = (s) => [...s].reduce((n, c) => n + (c.codePointAt(0) < 0x1100 ? 1 : 2), 0);
const lineHTML = (l) => {
  let h = esc(l);
  h = h.replace(/✓/g, '<span class="ok">✓</span>');
  h = h.replace(/^(\[IG\]|\[TH\])/, '<span class="tag">$1</span>');
  if (l.startsWith('🚀') || l.startsWith('✅')) h = `<span class="success">${esc(l)}</span>`;
  if (!args.skeleton) return `<div class="ln">${h}</div>`;
  const w = Math.max(8, Math.min(40, cellW(l)));
  return `<div class="ln skel"><span class="sk"><i class="sbox">[ ]</i>`
    + `<i class="sbar" style="width:${w}ch"></i></span><span class="tx">${h}</span></div>`;
};
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
:root { --bg:${pal.bg}; --panel:${pal.panel}; --line:${pal.line}; --text:${pal.text}; --dim:${pal.dim};
  --accent:${pal.accent}; --accent-dim:${pal.accentDim}; --on-accent:${pal.onAccent}; }
html,body { width:1080px; height:1920px; background:var(--bg); overflow:hidden; }
body { font-family:${fonts.mono}; color:var(--text); }
.chrome { display:flex; align-items:center; gap:16px; padding:44px 60px; border-bottom:1px solid var(--line); background:var(--panel); }
.dot { width:26px; height:26px; border-radius:50%; }
.chrome .t { margin-left:16px; font-size:38px; color:var(--dim); }
.term { padding:70px 64px; font-size:36px; line-height:1.64; }
.cmdline { color:var(--text); white-space:pre-wrap; word-break:keep-all; overflow-wrap:break-word; }
.prompt { color:var(--accent); font-weight:700; margin-right:14px; }
#cursor { display:inline-block; width:20px; height:46px; background:var(--accent); vertical-align:-6px; margin-left:4px; }
#out { margin-top:40px; }
/* ⚠️ 페이드에 CSS transition을 쓰지 않는다 — 투명도는 window.frame(t)가 t로 계산한다.
   트랜지션은 논리 시간 t가 아니라 벽시계로 돌아서, evaluate()와 screenshot() 사이에
   컴퓨터가 얼마나 걸렸냐에 따라 같은 t의 프레임이 매번 다르게 찍힌다.
   2026-08-10 실측: 같은 입력 2회 렌더에 236장 중 19장 불일치. */
.ln { opacity:0; margin:10px 0; white-space:pre-wrap; word-break:keep-all; overflow-wrap:break-word; }
.ln .tag { color:var(--dim); }
.ln .ok { color:var(--accent); font-weight:700; }
.ln .success { color:var(--accent); font-weight:800; }
/* ★ 빈 골격 (--skeleton). 골격 모드에서는 .ln 자체가 아니라 .tx / .sk 두 겹이 교차 페이드한다.
   ⚠️ 높이를 px로 못 박지 않는다 — 일반 모드(36px/1.64)와 자막 모드(28px/1.5)를 같이 타야 한다.
   .sk 안에 텍스트가 있어서 줄 상자 높이가 자동으로 맞고, 바는 em 기준이라 같이 줄어든다.
   ⚠️⚠️ 이 주석에 백틱을 쓰지 말 것 — 이 CSS는 템플릿 문자열 안이다(같은 자리에서 두 번 깨졌다). */
.ln.skel { opacity:1; position:relative; }
.ln.skel .tx { opacity:0; }
.sk { position:absolute; left:0; top:0; white-space:nowrap; }
.sbox { font-style:normal; color:var(--dim); opacity:0.62; }
.sbar { display:inline-block; height:0.4em; border-radius:6px; background:var(--line);
  margin-left:0.8em; vertical-align:0.18em; }
.cta { position:absolute; left:0; right:0; bottom:0; opacity:0;   /* 페이드는 위와 같은 이유로 t 계산 */
  display:flex; gap:24px; justify-content:center; align-items:center;
  padding:48px 40px 60px; background:linear-gradient(transparent, ${rgba(pal.bg, 0.9)} 30%); }
.pill { font-size:40px; font-weight:800; padding:26px 40px; border-radius:16px; }
.pill.save { background:var(--accent); color:var(--on-accent); }
.pill.follow { border:2px solid var(--accent); color:var(--accent); }
/* 훅 프레임 — 터미널이 아니라 카드 톤(산세리프 큰 글씨)이어야 스크롤 중에 읽힌다 */
/* ★★★ C안 (2026-08-11) — 자막이 화면 주인공이다.
   기존 구조는 터미널 줄이 주인공이라 **읽을 것만 있고 볼 것이 없었다**(8/11 사용자 관찰 +
   벤치마크 4계정 대조). 자막을 크게 세우고 터미널은 위로 밀어 **증거**로 축소한다.
   레이아웃(1080×1920, 2026-08-11 2차 조정 — 캐릭터를 키워 하단을 채운다):
     chrome 0~114 / 터미널 114~620 / **자막 640~894** / **캐릭터 920~1620(700px)** / CTA 하단.
   ⚠️ 캐릭터 바닥은 safe-zone.mjs 의 구도.캐릭터바닥 위에 고정이다 — 그 숫자는 거기에만 있다(2026-09-18 합침).
      그래서 캐릭터를 키우려면 **아래로 못 늘리고 위로만** 늘어나고, 자막·터미널이 같이 올라가야 한다.
   ⚠️ text-wrap:pretty 는 render.js에서 고아 줄 14건을 0으로 만든 그 한 줄이다 — 여기도 넣는다.
   ⚠️⚠️ 이 주석에 백틱을 쓰지 말 것. 이 CSS는 템플릿 문자열 안이라 백틱이 문자열을 끊는다.
        2026-08-10에 같은 자리에서 SyntaxError를 냈고 오늘 또 냈다 — 두 번째다. */
.term.compact { font-size:28px; line-height:1.5; padding:36px 64px; height:480px;
  box-sizing:border-box; overflow:hidden; }
.term.compact #out { margin-top:26px; }
.term.compact .ln { margin:6px 0; }
/* ★ 자막 크기·굵기·줄높이는 2026-08-24 외부 규격 수집으로 확증됐다:
   권고 60~75px / 700~900 / 1.3배 ↔ 우리 64 / 800 / 1.32 = 셋 다 밴드 중앙.
   08-11에 가이드를 안 보고 고른 값이라 외부 확증 1건으로 센다. 건드리지 말 것.
   ⚠️ 좌우 76px 은 부족하다 — 08-24 앱 실측 결과 인스타 우측 아이콘 열이 x 967 에서 시작한다
      (필요 여백 113, 권고 120). 고치면 발행 산출물이 바뀌므로 사용자 결정 사항으로 남겼다.
   ★★ font-variant-numeric: tabular-nums 는 2026-08-24 신설.
      근거: 독립 출처 3건이 같은 요구를 한다 — video-shotcraft odometer-digit-roll 카드
      (비등폭이면 한 칸 굴릴 때마다 줄 전체가 흔들린다고 명시) · 08-24 수집한 릴스 자막 규격 ·
      AUBRIER 프롬프트의 타이포 절. 자막에는 실측 수치(도달·이탈률·완주율)가 들어간다.

      ⛔⛔ **정정 (같은 날 실측) — 이 선언은 지금 아무 효과가 없다.**
      Playwright 로 우리 실제 스택을 렌더해 글자 폭을 쟀다:
        도달 297 / 103 / 111 / 888  ->  네 값 모두 244.94px (64px 기준) · 편차 0.00px
        tabular-nums 를 켠 쪽과 차이 0.00px · 훅 112px 395.72px · CTA 40px 211.45px 도 전부 동일
      원인: sans 스택 첫 두 이름(Pretendard Variable, Pretendard)이 **이 머신에 설치돼 있지 않다**.
      실제로 그려지는 것은 **Noto Sans KR** 이고 **그 폰트의 숫자는 이미 등폭**이라 바꿀 것이 없었다.
      ▶ **그래도 지우지 않는다**: Pretendard 가 설치되는 순간 스택 1번이 잡히고, 그 폰트의 숫자 폭 거동은
        확인하지 않았다. 그때 이 한 줄이 보험이 된다.
      ★ 이건 mono 스택과 **같은 상태다** — palette.mjs 가 Cascadia Code / D2Coding 을 선언하지만
        둘 다 미설치라 지금까지 모든 렌더가 Consolas 였다. **sans 도 선언과 실제가 다르다.**
        폰트를 설치하는 것이 과거 발행분과 신규분을 갈라놓는다는 경고가 여기에도 적용된다.

      ⚠️ 훅(.hook .ht)과 CTA(.pill)에는 넣지 않았다 — 그쪽은 발행에 나간다.
         (실측상 지금은 넣어도 화면이 같지만, Pretendard 가 들어오면 달라질 수 있어 사용자 결정으로 남겼다)
      이 자막 블록은 음성 큐가 없으면 렌더되지 않아(아래 참조) 현 발행 산출물이 바뀌지 않는다. */
#sub { position:absolute; left:0; right:0; top:640px; padding:0 76px;
  font-family:${fonts.sans}; font-size:64px; font-weight:800; line-height:1.32;
  color:var(--text); text-wrap:pretty; word-break:keep-all; overflow-wrap:break-word;
  font-variant-numeric: tabular-nums; letter-spacing:-0.02em; }
/* ★ 캐릭터 (2026-08-11). assets/characters/README.md의 **실측 배치를 그대로** 쓴다:
   높이 520px · 우측 여백과 바닥 여백은 safe-zone.mjs 의 구도 값을 따른다.
   ⛔⛔ 그 값은 2026-09-18 실측(하단 UI 650px)보다 일부러 낮다 — 캐릭터 하단 약 350px 이 캡션 아래 깔린다.
      장식이라 부분 가림을 받아들였고, 이미 발행된 회차들이 이 구도로 나갔다. 자막(640~894)은 안전하다.
   ⚠️ image-rendering:pixelated 필수 — 픽셀아트를 bilinear로 늘리면 계단이 뭉개져 정체성이 깨진다.
   z-index 4 = 훅(5)보다 아래. 0초엔 훅이 화면을 덮으므로 캐릭터는 훅이 걷힌 뒤 나타난다. */
#char { position:absolute; right:${구도.캐릭터우측여백}px; bottom:${구도.캐릭터바닥}px; height:${charH}px; z-index:4;
  image-rendering: pixelated; }
.hook { position:absolute; inset:0; background:var(--bg); z-index:5;
  display:flex; flex-direction:column; justify-content:center; padding:0 88px;
  font-family:${fonts.sans}; }
.hook .hb { align-self:flex-start; margin-bottom:56px; font-size:36px; color:var(--accent);
  border:2px solid var(--accent-dim); border-radius:999px; padding:18px 38px; letter-spacing:1px; }
.hook .ht { font-size:112px; line-height:1.2; font-weight:800; letter-spacing:-3px;
  word-break:keep-all; overflow-wrap:break-word; }
.hook .hs { margin-top:52px; font-size:50px; line-height:1.42; color:var(--dim);
  word-break:keep-all; overflow-wrap:break-word; }
.hook .hglow { position:absolute; width:1100px; height:1100px; border-radius:50%; pointer-events:none;
  background:radial-gradient(circle, ${rgba(pal.accent, 0.16)} 0%, transparent 62%); top:-360px; right:-320px; }
</style></head><body>
<div class="chrome">
  <span class="dot" style="background:${pal.dots[0]}"></span>
  <span class="dot" style="background:${pal.dots[1]}"></span>
  <span class="dot" style="background:${pal.dots[2]}"></span>
  <span class="t">${esc(args.title)}</span>
</div>
<div class="term${cues.length ? ' compact' : ''}">
${cues.length ? '<div id="scroll">' : ''}
  <div class="cmdline"><span class="prompt">$</span><span id="cmd"></span><span id="cursor"></span></div>
  <div id="out">${outLines.map(lineHTML).join('')}</div>
${cues.length ? '</div>' : ''}
</div>
${cues.length ? `<div id="sub"></div>` : ''}
<div class="cta" id="cta">
  <span class="pill save">📌 저장</span>
  <span class="pill follow">▶ 팔로우하고 다음 편</span>
</div>
${charDataURI ? `<img id="char" src="${charDataURI}">` : ''}
${args.hookText ? `<div class="hook" id="hook"><div class="hglow"></div>
  ${args.hookBadge ? `<div class="hb">${esc(args.hookBadge)}</div>` : ''}
  <div class="ht">${esc(args.hookText).replace(/\\n/g, '<br>')}</div>
  ${args.hookSub ? `<div class="hs">${esc(args.hookSub).replace(/\\n/g, '<br>')}</div>` : ''}
</div>` : ''}
<script>
const CMD = ${JSON.stringify(args.cmd)};
const CPS = ${CPS}, START_OUT = ${START_OUT}, STEP = ${LINE_STEP}, NLINES = ${outLines.length};
const LOOP = ${args.loop ? 'true' : 'false'}, LOOP_START = ${LOOP_START};
const HOOK_MS = ${HOOK_MS};
const CUES = ${JSON.stringify(cues)};
const FADE_MS = 180, CTA_FADE_MS = 300;   // 종전 CSS transition 값 그대로
const SKEL = ${args.skeleton ? 'true' : 'false'};

// CSS ease = cubic-bezier(.25,.1,.25,1). x(진행률)를 이분법으로 풀어 y(투명도)를 낸다.
// 근사가 아니라 같은 곡선이다 — 페이드 모양은 유지하고 시간 기준만 벽시계에서 t로 옮긴 것.
const bez = (a, b, u) => 3*(1-u)*(1-u)*u*a + 3*(1-u)*u*u*b + u*u*u;
const ease = (x) => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; bez(.25, .25, m) < x ? lo = m : hi = m; }
  return bez(.1, 1, (lo + hi) / 2);
};
const fade = (t, at, dur) => ease((t - at) / dur).toFixed(4);

window.frame = (t) => {
  // 루프 구간에서는 전부 초기 상태로 되돌린다 → 마지막 프레임 ≈ t=0 프레임이 되어 이어붙임이 안 보인다
  const looping = LOOP && t >= LOOP_START;
  // 훅은 0~HOOK_MS 구간, 그리고 루프 구간(=t=0 상태 재현)에 보인다
  const hook = document.getElementById('hook');
  const onHook = HOOK_MS > 0 && (looping || t < HOOK_MS);
  if (hook) hook.style.display = onHook ? 'flex' : 'none';

  const typed = looping ? 0 : Math.max(0, Math.min(CMD.length, Math.round((t - HOOK_MS)/1000*CPS)));
  document.getElementById('cmd').textContent = CMD.slice(0, Math.max(0, typed));
  const shown = looping ? 0 : (t < START_OUT ? 0 : Math.min(NLINES, Math.floor((t - START_OUT)/STEP) + 1));
  const kids = document.getElementById('out').children;
  // 줄 i는 START_OUT + i*STEP 에 등장을 시작해 FADE_MS 동안 올라온다
  for (let i = 0; i < kids.length; i++) {
    const o = looping ? '0' : fade(t, START_OUT + i * STEP, FADE_MS);
    if (SKEL) {
      // 골격 모드: 실제 줄이 올라오고 골격이 내려간다.
      // ⚠️ 둘을 같은 곡선으로 교차시키면 중간(각 0.5)에서 글자가 바 위에 겹쳐 한 프레임이 탁해진다
      //    (2026-08-24 렌더 실측, 24fps에서 약 4프레임). 골격을 60% 구간에 먼저 빼서 겹침을 줄인다.
      //    0으로 만들지 않고 더 빨리 빼는 쪽을 골랐다 — 먼저 지우면 빈 줄이 보이는 순간이 생긴다.
      // looping 이면 o=0 이므로 골격이 1로 돌아간다 = t=0 상태 재현(루프 이어붙임 유지).
      const tx = kids[i].querySelector('.tx');
      const sk = kids[i].querySelector('.sk');
      if (tx) tx.style.opacity = o;
      if (sk) sk.style.opacity = looping ? '1'
        : (1 - parseFloat(fade(t, START_OUT + i * STEP, FADE_MS * 0.6))).toFixed(4);
    } else {
      kids[i].style.opacity = o;
    }
  }
  const cur = document.getElementById('cursor');
  cur.style.display = (!looping && shown >= NLINES) ? 'none' : 'inline-block';
  cur.style.visibility = (Math.floor(t/500) % 2 === 0) ? 'visible' : 'hidden';
  // ★ CTA는 마지막 줄(결론)이 나온 뒤에만 띄운다 — 종전엔 1.4초에 떠서
  //   가치를 전달하기 전에 "팔로우하세요"가 먼저 나왔고, 그게 3초 이탈 구간 안이었다.
  //   CTA는 마지막 줄과 같은 순간에 올라오기 시작한다 (종전 shown >= NLINES 시점과 동일)
  document.getElementById('cta').style.opacity =
    (!looping && !onHook) ? fade(t, START_OUT + (NLINES - 1) * STEP, CTA_FADE_MS) : '0';

  // ★★★ 자막 (C안) — 내레이션 시작(START_OUT) 기준 상대 시각으로 활성 큐를 고른다.
  //   ⚠️ 큐 경계가 50ms 겹치는 구간이 있다(edge-tts 출력). **먼저 맞는 것을 쓴다** — 결정론적이다.
  const sub = document.getElementById('sub');
  if (sub) {
    const rel = t - START_OUT;
    let txt = '';
    for (const c of CUES) { if (rel >= c.s && rel < c.e) { txt = c.t; break; } }
    sub.textContent = onHook ? '' : txt;
  }

  // ★ 터미널 스크롤 — 축소된 터미널에 13줄이 다 안 들어간다.
  //   ⚠️ 높이를 산술로 계산하지 않고 **DOM에서 실측**한다(글꼴·줄바꿈에 따라 달라지므로).
  //   ⚠️⚠️ #out만 밀면 **명령어 줄은 제자리에 남아 출력 줄이 그 위에 겹친다**(2026-08-11 실측 버그).
  //        그래서 명령어 줄까지 감싼 #scroll을 통째로 민다 = 진짜 터미널처럼 위로 흘러 나간다.
  const term = document.querySelector('.term.compact');
  const sc = document.getElementById('scroll');
  if (term && sc) {
    // ⚠️ offsetTop 산술은 쓰지 않는다 — offsetParent가 body라 chrome 높이·패딩이 섞여 틀린다.
    //    변환을 0으로 되돌려 실제 위치를 재고 다시 적용한다(리플로 1회, 프레임 캡처라 무해).
    sc.style.transform = 'translateY(0px)';
    const last = kids[Math.max(0, shown - 1)];
    const over = last
      ? last.getBoundingClientRect().bottom - (term.getBoundingClientRect().bottom - 36)
      : 0;
    sc.style.transform = 'translateY(' + (-Math.max(0, over)) + 'px)';
  }
};
window.frame(0);
</script></body></html>`;

// ---- 프레임 캡처 ----
const W = 1080, H = 1920;
const outAbs = resolve(HERE, args.out);

// ---- ★★ 페이싱 트레이스 (--trace, 2026-08-24 신설) ----
//
// 왜: OpenMontage(스타 49.8k, AGPL)의 screen-demo 스킬이 자기 **1위 실패 모드**를 이렇게 적었다 —
//     *"스텝이 계속 진행돼 씬 앞 40%에서 내용을 다 소진하고 남은 60%를 정지 화면으로 보낸다."*
//     처방은 **렌더 전에** 스텝 길이를 누적해 각 비트의 영상 시각을 찍는 것이다(근거: "렌더 1분이 아깝다").
//     우리는 총계만 찍고 있었다 — `--outro` 교체나 출력 줄 수 변화가 타임라인을 조용히 바꿔도
//     **렌더가 끝난 뒤에야** 안다.
//     출처: <노트 문서 경로> 조사 (2026-08-24 ...).md
//
// ⚠️ 이 블록은 **로그 전용**이고 프레임을 만들기 전에 종료한다 — `--trace`를 안 주면
//    지금까지 나간 릴스와 **바이트 단위로 동일**하다(A/B 해시 회귀 검증).
if (args.trace) {
  const NL = outLines.length;
  const CTA_FADE = 300, FADE = 180;                 // 브라우저측 상수와 같은 값(문서화 목적)
  const nF = Math.ceil((totalMs / 1000) * args.fps);
  const pad = (v, n) => String(v).padStart(n);
  const clip = (t, n = 44) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  const row = (t, mark, text) =>
    console.log(`  ${pad(Math.round(t), 6)}ms  ${pad((t / 1000).toFixed(2), 6)}s  ${mark} ${text}`);

  console.log('\n--- 페이싱 트레이스 (렌더하지 않는다) ---');
  if (HOOK_MS) {
    row(0, '[훅]', clip(String(args.hookText).replace(/\\n/g, ' / ')));
    row(HOOK_MS, '[타]', `훅 종료 · 명령어 타이핑 시작 (${args.cmd.length}자 · ${CPS}자/초)`);
  } else {
    row(0, '[타]', `명령어 타이핑 시작 (${args.cmd.length}자 · ${CPS}자/초)`);
  }
  row(HOOK_MS + typeDur, '[엔]', `타이핑 완료 → 엔터 대기 ${ENTER_PAUSE}ms`);
  if (args.skeleton) row(0, '[골]', `빈 골격 [ ] ${NL}칸을 0초부터 인쇄`);
  for (let i = 0; i < NL; i++) {
    const t = START_OUT + i * LINE_STEP;
    const last = i === NL - 1;
    row(t, pad(i + 1, 2) + '.', clip(outLines[i]) + (last ? '   <- 마지막 줄' : ''));
    if (last) row(t, '[CTA]', `저장·팔로우 페이드 시작 (${CTA_FADE}ms)`);
  }
  const outEnd = START_OUT + NL * LINE_STEP;
  row(outEnd, '[홀]', `출력 종료 → END_HOLD ${END_HOLD}ms`);
  if (args.loop) row(LOOP_START, '[루]', `루프 되감기 ${LOOP_MS}ms`);
  row(totalMs, '[끝]', `총 ${(totalMs / 1000).toFixed(2)}s · ${args.fps}fps · ${nF}프레임 · ${W}x${H}`);

  if (cues.length) {
    console.log('\n--- 내레이션 자막 큐 (절대 시각) ---');
    for (const c of cues) row(START_OUT + c.s, '[말]', clip(c.t));
    console.log(`  (LINE_STEP ${LINE_STEP}ms = 음성 ${narrationMs}ms ÷ ${NL}줄)`);
  }

  // ---- 점검 ----
  // 각 항목은 근거가 있는 것만 찍는다. 기준 출처를 괄호에 병기한다.
  const lastChange = START_OUT + (NL - 1) * LINE_STEP + Math.max(FADE, CTA_FADE);
  const frozen = Math.max(0, totalMs - lastChange);
  const frozenPct = (frozen / totalMs) * 100;
  const at3s = Math.max(0, Math.min(NL, Math.floor((3000 - START_OUT) / LINE_STEP) + 1));
  const ok = (b) => (b ? 'OK  ' : 'CHK ');
  const f1 = (v) => v.toFixed(1);

  console.log('\n--- 점검 ---');
  console.log(`  ${ok(frozenPct <= 40)} 정지 구간      ${(frozen / 1000).toFixed(2)}s (${f1(frozenPct)}%)  ` +
              `[기준: 40% 초과면 OpenMontage가 말한 실패 모드]`);
  console.log(`  ${ok(at3s >= 1 || HOOK_MS > 0)} 3초 시점       ` +
              `${HOOK_MS ? '훅 종료 후 ' : ''}출력 ${at3s}줄 표시  ` +
              `[기준: 우리 실측 — 첫 3초에 69~84% 이탈]`);
  console.log(`  ${ok(LINE_STEP >= 500 && LINE_STEP <= 1100)} 줄 간격        ${LINE_STEP}ms  ` +
              `[권고 500~1100ms = 페이드인 100 + hold 400~1000. 우리 11초 릴스는 의도적으로 빠름]`);
  console.log(`  ${ok(ENTER_PAUSE >= 300)} 명령 후 hold   ${ENTER_PAUSE}ms  [권고 300ms 이상]`);
  console.log(`  INFO 결론 도달  ${((HOOK_MS ? 0 : START_OUT + (NL - 1) * LINE_STEP) / 1000).toFixed(2)}s  ` +
              `[훅이 있으면 0초 = 2026-08-06 설계]`);

  if (narrationMs) console.log(`\n  참고: --narrate 때문에 이미 ${basename(narrationFile)}를 만들었다(트레이스 부산물).`);
  console.log('\n  렌더는 하지 않았다. --trace 를 빼고 다시 실행하면 렌더한다.');
  process.exit(0);
}
// ⚠️ 프레임 폴더 재사용은 윈도우에서 두 번 죽었다 (2026-08-05·08-06):
//    `--keep-frames`로 남긴 PNG를 무엇이든 한 번 열어보면(뷰어·이미지 도구·탐색기 미리보기)
//    폴더가 비어 있어도 **핸들이 남아 rmdir이 EBUSY로 실패**하고, 렌더 전체가 그 자리에서 죽는다.
//    영상 생성과 아무 상관 없는 정리 작업 때문에 죽는 게 말이 안 되므로 → 지우지 못하면 **비켜간다.**
let framesDir = join(dirname(outAbs), 'termcast-frames');
if (existsSync(framesDir)) {
  try {
    rmSync(framesDir, { recursive: true, force: true });
  } catch (e) {
    framesDir = join(dirname(outAbs), `termcast-frames-${process.pid}`);
    console.warn(`⚠️ 기존 프레임 폴더를 지울 수 없어(${e.code}) 새 폴더를 쓴다: ${basename(framesDir)}`);
    console.warn('   (원인: 그 폴더의 PNG를 열어본 프로세스가 핸들을 잡고 있음. 렌더에는 영향 없음)');
  }
}
mkdirSync(framesDir, { recursive: true });

const nFrames = Math.ceil((totalMs / 1000) * args.fps);
console.log(`렌더: ${outLines.length}줄 · ~${(totalMs/1000).toFixed(1)}s · ${args.fps}fps · ${nFrames}프레임 · ${W}x${H}`);
if (args.skeleton) {
  console.log(`빈 골격: on — [ ] ${outLines.length}칸을 0초부터 인쇄하고 하나씩 채운다`);
  // ⚠️ 자막(=캐릭터/음성) 모드에서는 터미널이 480px로 줄고 overflow:hidden 이라
  //    화면 밖 골격이 잘린다 → "몇 개 남았는지"가 안 보여 장치의 값이 반쯤 사라진다.
  //    우리 내부 러너(이 저장소에 없음)는 --narrate 를 안 넘기므로 현재 경로에선 해당 없다.
  if (cues.length) {
    console.warn('⚠️ --skeleton 과 --narrate 를 같이 썼다 — 축소된 터미널(480px)에서 먼 골격은 잘린다.');
    console.warn('   "몇 개 남았는지"가 화면에 안 보이므로 완주 장치로서의 효과는 검증되지 않았다.');
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
for (let f = 0; f < nFrames; f++) {
  const t = (f / args.fps) * 1000;
  await page.evaluate((tt) => window.frame(tt), t);
  const name = `f-${String(f).padStart(5, '0')}.png`;
  await page.screenshot({ path: join(framesDir, name) });
}
await browser.close();
console.log(`프레임 ${nFrames}장 캡처 완료`);

// ---- ffmpeg: 이미지 시퀀스 → MP4 (무음 트랙 포함) ----
const durSec = (nFrames / args.fps).toFixed(3);
// ★ 음성이 있으면 무음 트랙 대신 내레이션을 얹는다 (2026-08-11).
//   adelay로 START_OUT만큼 밀어 **줄이 뜨기 시작하는 순간에 목소리가 시작**되게 한다.
//   훅(0~HOOK_MS)과 명령어 타이핑 구간은 그대로 무음이다 — 훅은 글자로 이미 결론을 준다.
//   apad + `-t durSec` = 음성이 끝난 뒤 END_HOLD 구간은 무음으로 채우고 영상 길이에서 자른다.
const delayMs = Math.round(START_OUT);
const ffArgs = narrationFile ? [
  '-y',
  '-framerate', String(args.fps), '-i', join(framesDir, 'f-%05d.png'),
  '-i', narrationFile,
  '-filter_complex', `[1:a]adelay=${delayMs}|${delayMs},apad[a]`,
  '-map', '0:v', '-map', '[a]',
  '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(args.fps),
  '-c:a', 'aac', '-b:a', '128k', '-t', durSec, '-movflags', '+faststart',
  outAbs,
] : [
  '-y',
  '-framerate', String(args.fps), '-i', join(framesDir, 'f-%05d.png'),
  '-f', 'lavfi', '-t', durSec, '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
  '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(args.fps),
  '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart',
  outAbs,
];
console.log(`합성: → ${outAbs}`);
const r = spawnSync(ffmpegPath, ffArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
if (r.status !== 0) { console.error('ffmpeg 실패'); process.exit(r.status ?? 1); }
if (!args.keepFrames) rmSync(framesDir, { recursive: true, force: true });
console.log(`완료: ${outAbs}`);

// ---- 렌더 레시피 기록 (2026-08-21 신설) ----
//
// ★ 근본 원인 교정. 2026-08-21에 릴스 4편의 훅 프레임이 전부 빠졌는데, 고치려고 보니
//   원래 렌더 명령이 **어디에도 없었다** — out/ 에는 lines.txt·캡션·mp4만 남고
//   --cmd/--title/--outro/훅은 세션 컨텍스트에만 있었다. 결국 영상 프레임을 뽑아
//   화면에서 명령어를 읽어 복원했다. 세션이 끊기면 사라지는 자산이었다.
// → 이제 렌더할 때마다 실제 인자를 파일로 남긴다. 재현이 추측이 아니게 된다.
try {
  // ⛔ 2026-09-09 — 종전엔 `join(dirname(outAbs), …)` 였다. 즉 **`out/` 안**이다.
  //   `.gitignore` 가 `cardnews/out/` 을 통째 제외하므로
  //   **손실을 막으려고 만든 이 기록이 백업 없는 자리에** 14개 쌓여 있었다.
  //   ▶ 경로 규칙은 `lines-path.mjs` 가 단일 출처로 들고 있다.
  const recipePath = renderRecipePath(args.slug || basename(dirname(outAbs)));
  mkdirSync(dirname(recipePath), { recursive: true });
  writeFileSync(recipePath, JSON.stringify({
    renderedAt: new Date().toISOString(),
    node: process.version,
    argv: process.argv.slice(2),
    hook: args.hookText ? { badge: args.hookBadge, text: args.hookText, sub: args.hookSub, ms: HOOK_MS } : null,
  }, null, 2) + '\n', 'utf8');
  console.log(`레시피 기록: ${recipePath}`);
} catch (e) {
  console.error(`⚠️ 레시피 기록 실패(영상은 정상): ${e.message}`);
}

// ---- 훅 프레임 경고 (2026-08-21 신설) ----
//
// 이 파일은 발행일 누락에 대해 이미 "경고로 두면 무시된다 → 하드 실패"를 채택했다.
// 훅에는 같은 원칙을 적용하지 못한다 — 리드마그넷 가이드의 공개 예시가 훅 없이 돌고,
// 그걸 깨면 독자 쪽이 막힌다. 그래서 여기서는 경고만 하고,
// **하드 게이트는 우리 내부 러너 두 곳에 둔다**(렌더 전 거부 · 렌더 후 첫 프레임 검사).
//    ⚠️ 그 두 스크립트는 계정 고유 레시피를 담고 있어 이 저장소에 포함하지 않았다.
//       받아서 쓰는 쪽에서는 아래 경고를 보고 --hook-text 를 직접 넘기면 된다.
if (!args.hookText) {
  console.error('');
  console.error('⚠️⚠️ 훅 프레임 없이 렌더했습니다 (--hook-text 미지정).');
  console.error('   훅은 2026-08-06에 "3초 이탈 69~84%"를 고치려고 신설한 장치입니다.');
  console.error('   승자 2편(08-12 도달 709 · 08-19 이탈 65.5%)은 둘 다 훅 1.75초를 갖고 있습니다.');
  console.error('   붙이는 법: --hook-text "결론 한 줄" --hook-ms 1750 (줄바꿈은 \\n)');
  console.error('');
}

// ---- 릴스 캡션 자동 생성 (post-<슬러그>.json → out과 같은 폴더에 -caption.txt) ----
const captionOut = tryWriteReelCaption({ slug: args.slug || basename(dirname(outAbs)), manifestOverride: args.manifest, videoOutPath: outAbs });

// ---- 구글 드라이브 자동 업로드 (rclone) — 영상 + 캡션.txt 함께 (원격 업로드 대비) ----
// rclone copy는 소스 1개만 받으므로 파일별로 반복 호출
if (args.drive) {
  // ⚠️ 설정 파일 위치가 중요하다 (2026-08-04): %APPDATA%의 rclone.conf는 클로드 세션과 사용자 터미널이
  // 서로 다른 사본을 보게 되는 문제가 있었다(토큰 갱신 시 쓰기가 갈라짐 → invalid_grant).
  // 그래서 이 폴더의 rclone.conf(양쪽 공유 영역)를 있으면 무조건 우선 사용한다.
  const localConf = join(HERE, 'rclone.conf');
  const confArgs = existsSync(localConf) ? ['--config', localConf] : [];

  // 발행일 없이는 업로드하지 않는다 — 날짜 없는 이름이 쌓이는 게 정확히 지금 고치는 문제다.
  // 경고로 두면 무시된다(어제 얻은 교훈: 사람 절차로 남긴 안전장치는 재발을 막지 못한다) → 하드 실패.
  const pubDate = readPublishDate({ slug: args.slug || basename(dirname(outAbs)), manifestOverride: args.manifest, override: args.pubdate });
  if (!pubDate) {
    console.error('❌ 발행일을 못 찾아 드라이브 업로드를 중단했습니다 (영상·캡션은 로컬에 그대로 있습니다).');
    console.error('   드라이브 파일명은 "<발행일>-<슬러그>-reels.mp4" 규칙입니다. 둘 중 하나로 알려주세요:');
    console.error(`   ① 매니페스트에 "publishDate": "YYYY-MM-DD" 추가 (권장 — 발행일이 콘텐츠와 같은 곳에 남는다)`);
    console.error('   ② 이 명령에 --pubdate YYYY-MM-DD 추가');
    process.exit(1);
  }

  const toUpload = [outAbs, ...(captionOut ? [captionOut] : [])];
  for (const f of toUpload) {
    // copy(폴더로 복사, 원래 이름 유지)가 아니라 copyto(대상 파일명 지정)를 쓴다 — 이름을 바꿔 올리려면 필수.
    const dest = drivePathFor(args.drive, f, pubDate);
    console.log(`드라이브 업로드: ${f} → ${dest}`);
    const up = spawnSync(args.rclone, [...confArgs, 'copyto', f, dest, '--stats-one-line'], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (up.status !== 0) { console.error(`rclone 업로드 실패(${f}) — rclone 경로/설정(gdrive 원격) 확인`); process.exit(up.status ?? 1); }
  }
  console.log(`드라이브 업로드 완료 — 발행일 ${pubDate} 접두 (폰 드라이브 앱에서 확인)`);
}
