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
// ⛔⛔⛔ 2026-09-14 정정 — **기본값을 1080×1920 으로 되돌렸다 (사용자 지시 「재조립 진행」·「정정하고」).**
//   아래 2026-08-24 근거 셋 중 **①②는 측정 오독이고 ③은 근거가 안 된다.** 지우지 않고 남긴다 — 이력이 근거다.
//
//   ~~① Flow 720 → 1080 업스케일은 경계강도 72%(28% 손실, 되돌릴 수 없다).~~
//   ⛔ **부호가 반대다.** 그 72% 는 **픽셀당** 경계강도라 같은 경계를 2.25배 픽셀에 펴면 **기계적으로** 내려간다.
//      Flow 는 720 밖에 안 내므로 비교 대상이 될 원본 1080 이 **존재하지 않는다** — 손실 측정이 아니다.
//      ★ **되돌릴 수 없는 건 축소다.** 업스케일은 다시 줄이면 원본이다. 비가역성이 반대 연산에 붙어 있었다.
//      🔬 2026-09-14 재현: 같은 산물이 플레이트에서 2.466 → 1.385 로 나왔다(화질 저하 아님).
//
//   ~~② 1080 → 720 축소는 잉크 2.213 → 2.238% 로 글자가 사라지지 않는다.~~
//   ⛔ **지표가 그 피해를 못 본다.** 「잉크 비율」은 **글자가 남아 있나**를 재지 **날카로운가**를 안 잰다.
//      축소해도 획은 남고 **가장자리만 물러지니** 비율은 당연히 안 변한다.
//      🔬 2026-09-14 실측(라플라시안 고주파, 같은 1080 화면·같은 영역): 훅 자막 **9.537 → 8.169 = −14.3%**.
//         볼트 독립 재측정(전체 프레임) **−19.2%**. 육안으로도 한글 획 가장자리가 물러진다.
//      ✅ 그리고 1080 재조립 후 다시 재니 **원본 8.619 → 완성본 8.662**(손실 0). 고친 게 먹었다.
//
//   ~~③ 인스타가 어차피 720×1280 으로 깎아 서빙한다 → 실무 방향 같아서 채택.~~
//   ⛔ **`n=1` 이고 그 한 편이 최장·최고이탈 회차다**(헤더가 스스로 적어뒀다). ⓐ「전부 깎인다」/ⓑ「저성과만 깎인다」
//      는 2026-09-14 에 `media_url` 을 세 방법으로 다시 물어도 **여전히 안 갈린다**(릴스 15건 중 1건만 값이 오고
//      그게 같은 8/14 회차 · 개별 조회 4/4 값 없음 · `thumbnail_url` 은 640×1136 으로 정규화돼 판별력 0).
//   ★★ **그리고 ③ 이 참이어도 결론이 안 나온다: 서빙 화질은 우리 업로드의 상한을 못 넘는다.**
//      1080 업로드 → IG 가 720 재인코딩 = **1회 압축** / 720 업로드 → IG 가 720 재인코딩 = **2회 압축**.
//      깎을 원본을 좋게 주는 쪽이 낫다. 이건 ⓐ/ⓑ 판정과 무관하다.
//      🔬 부가 실측(2026-09-14): 8/14 회차는 **우리가 172kbps 로 올렸고 IG 가 123kbps(71.8%)를 서빙**했다.
//         픽셀당으로는 IG 가 더 후했다 — **IG 가 뭉갠 게 아니라 우리가 뭉갠 걸 올렸다.**
//
// ★★ 방향이 거꾸로였다 — **고주파가 4배인 쪽(한글 훅)을 깎아 1/4 인 쪽(2D 애니 플레이트)에 맞추고 있었다.**
//    훅 고주파 9.537 vs 플레이트 2.466. 그것도 **앞 1.75초**, 이탈이 갈리는 구간이다.
// ✅ 비트레이트 걱정은 없다 — 이 파일은 **CRF 18**(품질 목표)이라 해상도를 올리면 인코더가 알아서 더 쓴다.
//    🔬 실측: 재조립 후 1,570~3,128kbps(옛 720 판은 712kbps 대).
//    ⛔ 「옛 1080 회차가 비트레이트 기아였다」도 오독이다 — 같은 1080 내용을 CRF 18 로 다시 인코딩하니
//       222 → 265kbps(+19%)였다. **10배 격차는 CRF 가 아니라 내용 차이다**(평평한 터미널 vs 애니 그라데이션).
//       **CRF 에서 낮은 비트레이트는 기아가 아니라 「쉬운 그림」이다.**
//
// ⛔⛔ 규칙 — **픽셀당 정규화 지표를 서로 다른 해상도·내용끼리 비교하지 않는다.**
//    2026-09-14 하루에 이 잘못된 비교에 **세 번** 걸렸다: ① 헤더(해상도가 다른 경계강도) ·
//    플레이트 2.466 vs 1.385(릴스 세션, 자기 정정) · 픽셀당 비트 0.0045 vs 0.0366(볼트, 자기 정정).
//    ★ 가르는 법: **그 값이 왜 내려갔는지 기전을 먼저 말한다.** 기전을 못 대면 그 비교는 아직 근거가 아니다.
//
// 📌 배경: 2026-09-14 도달 판독에서 **1080 회차 <실측 도달값>·96 대 720 회차 12·23·7** 로 갈렸다.
//    ⚠️ **교락은 안 풀렸다** — 9/07 에 플레이트·720·이 조립기가 같이 바뀌었다. 해상도가 도달의 원인이라는
//    주장이 아니다. 다만 **도달과 무관하게도 훅 글자를 공짜로 뭉개고 있었으므로** 판정을 기다릴 이유가 없었다.
//    ▶ 9/14 주간 3편을 1080 으로 재조립한 것이 **2×2 의 빈 칸(플레이트 O · 1080)**을 채우는 분리 실험이 된다.
//
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
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reelPublishDate, uploadReelToDrive } from './reel-caption.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = { hook: null, hookMs: 1600, hookSfx: DEFAULT_STYLE, clips: [], out: null,
               w: 1080, h: 1920, fps: 24, crf: 18, dry: false, drive: 'gdrive:dhenddl-reels', rclone: 'rclone' };
//             ↑ 2026-09-14 720×1280 → 1080×1920 (사용자 지시). 근거·정정 전문은 머리말 「2026-09-14 정정」 절.
//             ⛔ 되돌리기 전에 그 절을 읽는다 — 옛 근거 ①②는 측정 오독이고 ③은 n=1 이다.
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
  // ★ 드라이브 업로드는 **기본 켜짐**이다 (2026-09-10 · 사용자 지시).
  //   「렌더가 되었다」와 「드라이브 업로드까지 완료」가 같은 뜻이어야 한다 —
  //   2026-09-10 에 9/14 주간 릴스 3편이 렌더만 되고 드라이브에 0건이었다.
  //   ⛔ 효과음(`--no-hook-sfx`)과 같은 판단이다: **끄려면 명시**해야 한다.
  //      결정을 문서에만 적으면 다음에 잊는다.
  else if (a === '--no-drive') args.drive = null;
  else if (a === '--drive') args.drive = argv[++i];
  else if (a === '--rclone') args.rclone = argv[++i];
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

// ── 드라이브 업로드 (2026-09-10 신설 · 기본 켜짐) ─────────────────────────
// ⛔⛔ 이 블록이 없어서 2026-09-10 에 9/14 주간 릴스 3편이 **렌더만 되고 드라이브에 0건**이었다.
//   릴스는 폰 업로드이고 폰은 드라이브에서 받는다 — 그날 올릴 영상이 폰에 없는 상태였다.
//   ★ `check-schedule` 은 그 셋을 ✅ 로 찍었다(로컬 파일만 본다). 지금은 그쪽도 드라이브를 본다.
// ⚠️ 업로드 실패로 조립을 실패로 만들지 않는다 — **영상은 이미 만들어졌다.**
//   대신 **무엇을 손으로 해야 하는지**를 정확히 찍는다. 조용히 넘기면 이 사고가 그대로 반복된다.
if (args.drive) {
  // 슬러그는 산출 경로에서 얻는다 — 이 도구엔 --slug 가 없고, 파일명 규약이 out/<slug>/<slug>-reels.mp4 다.
  const slug = basename(dirname(outAbs));
  const pubDate = reelPublishDate(slug);   // 매니페스트 → 레시피 순으로 본다
  const caption = join(dirname(outAbs), `${slug}-reels-caption.txt`);
  const files = [outAbs, ...(existsSync(caption) ? [caption] : [])];
  const up = uploadReelToDrive({ files, pubDate, remote: args.drive, rclone: args.rclone });
  if (up.ok) {
    console.log(`✅ 드라이브 업로드 ${up.uploaded.length}건 — 폰에서 받을 수 있다`);
    for (const d of up.uploaded) console.log(`   ${d}`);
  } else {
    console.log('');
    console.log(`⛔⛔ 드라이브 업로드 실패 — **영상은 로컬에 그대로 있다**: ${up.why}`);
    console.log('   ★ 이대로 두면 발행일에 폰에 영상이 없다. 손으로 올린다(이름 규약을 맞춘다):');
    console.log(`   rclone --config rclone.conf copyto ${outAbs} gdrive:dhenddl-reels/<발행일>-${basename(outAbs)}`);
  }
}
console.log('→ 다음: node hook-check.mjs <slug>   그다음   node reel-review.mjs <slug>');
console.log('⚠️ 발행 원고(훅 문구·캡션)는 CLAUDE.md 작업 4 — no-ai-tell 0절 채우기 점검을 따로 거친다.');
