// 릴스 렌더 후 자기검사 + 콘택트시트 (2026-08-24 신설)
//
// 왜 만들었나:
//   독립 출처 2건이 같은 처방을 냈다.
//     ① 2026-08-21 「모션 트래킹 데모 지시서」 — "콘택트시트 검수는 지금 이식 가능"(제안 상태로 남아 있었다)
//     ② OpenMontage(스타 49.8k, AGPL) post-render self-review — ffprobe + 4지점 프레임 추출로
//        검은 프레임·깨진 오버레이를 잡고, **"실패하면 영상을 내놓지 않는다"**
//   우리는 렌더 후 눈으로 몇 프레임 보는 게 전부였고, 그 방식이 2026-08-21에 **훅 누락 4편을 통과시켰다**
//   (hook-check.mjs 머리말). 있는 것의 결함은 보이지만 **없는 것은 안 보인다.**
//
// 임계값은 실측으로 정했다 — 기존 릴스 20편 × 5지점 = 100프레임 (2026-08-24):
//     전체 잉크 최소 0.362% / 최대 6.79%
//     중간 지점(30·60·85%) 최소 0.96%
//     훅 없는 빈 터미널 첫 프레임 0.24~0.27% (hook-check.mjs 실측)
//   → 검은 프레임 하한 0.10%  (빈 터미널보다도 2.4배 아래 = 진짜 검은 화면만 걸린다)
//   → 중간 공백 하한 0.50%  (실측 최소 0.96%의 절반, 빈 터미널 0.24~0.43%보다는 위)
//   → 과노출 상한 40%      (실측 최대 6.79%의 약 6배)
//
// ⚠️ **"마지막 프레임이 가장 밝다"는 넣지 않았다** — 실측 20편 중 **10편이 반례**다.
//    `--loop` 회차는 끝에서 화면을 첫 프레임 상태로 되감기 때문이고 그건 **설계대로**다
//    (실측: reels-709 1.64→1.66 · watch-time-drift 3.35→3.35 · completion-rate 1.98→1.98).
//    대신 |첫−끝| 을 찍어 **루프 정합을 눈으로 확인**하게 했다.
//
// ⚠️ 이 검사는 hook-check.mjs 를 대체하지 않는다. 훅 유무는 그쪽이 첫 프레임 하나로 판정하고,
//    여기는 **영상 전체가 성립하는지**를 본다. 순서: render-reels → hook-check → reel-review.
//
// 의존: ffmpeg / ffprobe 뿐 (hook-check.mjs 와 같은 PGM 방식)
// 사용: node reel-review.mjs              (out/ 전체)
//       node reel-review.mjs reels-297    (하나만)
//       node reel-review.mjs --no-sheet   (콘택트시트 생략, 판정만)

import { readdir, readFile, unlink, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

// ★ 경로는 CWD가 아니라 이 파일 위치를 기준으로 잡는다 (hook-check.mjs 와 같은 이유).
//   render-reels.mjs 가 2026-08-21에 고친 것을 이 파일과 hook-check.mjs 가 못 받았고,
//   2026-08-25 게이트 일괄 실행에서 둘 다 "out/ 가 없다"로 exit 1 이 났다.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const TMP = path.join(HERE, 'out', '.reelreview');

const INK_THRESHOLD = 96;    // 0~255. 이 위를 잉크로 본다 (hook-check.mjs 와 동일)
const POS = [0.03, 0.30, 0.60, 0.85, 0.98];   // 샘플 지점. OpenMontage는 4지점, 우리는 훅 구간을 따로 봐야 해서 5
const MID = [1, 2, 3];       // POS 중 "중간 구간" 인덱스 (30·60·85%)
const BLACK_MAX = 0.10;      // 이 아래면 검은 프레임
const MID_MIN = 0.50;        // 중간 구간이 이 아래면 빈 화면 의심
const BLOWN_MIN = 40.0;      // 이 위면 과노출/전백 의심

// ── 길이 검사 (2026-08-25 신설) ────────────────────────────────────────────────
// 왜 넣었나: 릴스 길이는 우리 파이프라인에서 **산출값**이다.
//   음성 없는 발행 경로는 CPS 30 · LINE_STEP 470ms 가 고정이라 **텍스트를 늘리면 길이가 조용히 늘어난다**
//   (make-termcast.mjs 는 총 길이를 --trace 로 찍기만 하고 아무것도 막지 않았다).
//   조립 경로(assemble-reel.mjs)도 마찬가지 — 훅 + Flow 클립 + 스팅의 합이 그냥 길이가 된다.
//   ▶ 이 검사의 일은 **"길이가 의도 없이 변했다"를 눈에 띄게 하는 것**이다.
//
// ⛔⛔ **왜 FAIL(exit 1)이 아닌가 — 우리 실측이 밴드를 지지하지 않는다.**
//   2026-08-24 자체 상관 측정: **영상 길이 ↔ 도달 = −0.065 (무관)** / 길이 ↔ 완주율 = −0.605 (교란변수).
//   7~15초는 사용자가 08-24 에 전한 **업계 카더라**이고("요즘 대세가 7~15초라는 말이 있음")
//   볼트에 1차 출처가 없다. 게다가 2026-07-23 브리핑은 반대 방향을 적어뒀다 —
//   *"2026 알고리즘은 완주율을 총 조회수보다 우선 (80% 완주한 45초 > 95% 완주한 15초)"*.
//   ▶ **남의 카더라로 우리 실측을 덮어 발행을 막지 않는다.** 경고까지만 한다.
//   (2026-08-24 계획 페이지에 내가 "밴드 밖이면 exit 1"로 적어둔 것을 여기서 정정한다)
const BAND_MIN = 7.0;        // 외부 주장(카더라). 출처 약함 — 경고 전용
const BAND_MAX = 15.0;       // 위와 같음
const OURS_MAX = 13.21;      // ★ 우리 실측 최장 릴스. 이건 우리 데이터다
const SHEET_W = 216;         // 콘택트시트 한 칸 가로(1080의 1/5)

// P5 PGM 파서 — "P5\n<w> <h>\n<max>\n" + 바이너리 (hook-check.mjs 와 같은 구현)
function parsePGM(buf) {
  let i = 0;
  const tok = () => {
    while (i < buf.length) {
      while (i < buf.length && /\s/.test(String.fromCharCode(buf[i]))) i++;
      if (buf[i] === 0x23) { while (i < buf.length && buf[i] !== 0x0a) i++; continue; }
      break;
    }
    const s = i;
    while (i < buf.length && !/\s/.test(String.fromCharCode(buf[i]))) i++;
    return buf.toString('latin1', s, i);
  };
  const magic = tok();
  if (magic !== 'P5') throw new Error(`PGM이 아니다: ${magic}`);
  const w = parseInt(tok(), 10);
  const h = parseInt(tok(), 10);
  parseInt(tok(), 10);
  i++;
  return { w, h, data: buf.subarray(i, i + w * h) };
}

async function durationSec(mp4) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', mp4]);
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`길이를 못 읽었다: ${mp4}`);
  return d;
}

// ⚠️ -ss 를 -i 앞에 둔다(입력 시크). 뒤에 두면 프레임 하나 뽑는데 영상 전체를 디코딩한다.
async function inkAt(mp4, t, tag) {
  const pgm = path.join(TMP, `${tag}.pgm`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', mp4,
    '-vf', 'format=gray', '-frames:v', '1', pgm]);
  const { w, h, data } = parsePGM(await readFile(pgm));
  let ink = 0;
  for (let k = 0; k < data.length; k++) if (data[k] > INK_THRESHOLD) ink++;
  await unlink(pgm).catch(() => {});
  return (100 * ink) / (w * h);
}

// 사람이 눈으로 보는 부분. 5지점을 가로로 이어 붙인다 — 08-21 지시서가 제안한 그 콘택트시트다.
async function contactSheet(mp4, dur, slug) {
  const dir = path.join(TMP, `sheet-${slug}`);
  await mkdir(dir, { recursive: true });
  for (let j = 0; j < POS.length; j++) {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', (dur * POS[j]).toFixed(3), '-i', mp4,
      '-vf', `scale=${SHEET_W}:-2`, '-frames:v', '1', path.join(dir, `s-${j + 1}.png`)]);
  }
  const sheet = path.join(path.dirname(mp4), `${slug}-review-sheet.png`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-start_number', '1',
    '-i', path.join(dir, 's-%d.png'), '-vf', `tile=${POS.length}x1`, '-frames:v', '1', sheet]);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  return sheet;
}

/* ── 컷 수 (2026-09-21 신설 — 사용자 지시 「릴스·모션 제작시에 적극 반영」) ──────────
   왜: 🔬 그날 `@lazy_owen` 릴스 4편을 받아 재니 **컷 4.7~5.3/10초**(36~53초에 하드컷 17~27)인데
       우리 `reels-three-faces` 는 **14.8초에 하드컷 0** 이었다. 저쪽은 2초마다 화면이 바뀌고
       우리는 한 번도 안 바뀐다. watch time 이 랭킹 1번 신호인데 그 축을 우리가 재본 적이 없다.
   ⛔ **막지 않는다 — 경고만 한다.** 이유 둘:
       ① 터미널 캐스트는 컷이 0 인 게 형식상 정상일 수 있다. 막으면 기존 회차가 전부 걸린다.
       ② 「컷이 많으면 좋다」는 아직 **우리 데이터로 검증 안 됐다**(저쪽 4편 · 조회수 미상).
          검증 안 된 축으로 발행을 막는 건 게이트가 아니라 사고다 — check-ai-tell 과 같은 규약.
   ⚠️ 임계 0.3 은 ffmpeg scene 점수다. 우리 릴스 실측 최대가 0.154 라 **0 으로 떨어지는 게 맞다.**
   📌 함정: `metadata=print` 는 `select` 의 `scene` 식이 점수를 계산해줘야 채워진다.
      그리고 `-v error` 를 붙이면 showinfo·metadata 출력(info 레벨)이 통째로 사라진다.
      ★ 둘 다 실제로 걸렸다 — 양성 대조군(우리 릴스) 없이 돌렸으면 「저쪽도 컷 0」으로 보고할 뻔했다. */
const CUT_SCENE = 0.3;
async function cutsPer10s(mp4, dur) {
  try {
    const { stdout, stderr } = await run('ffmpeg',
      ['-i', mp4, '-vf', `select='gt(scene,${CUT_SCENE})',showinfo`, '-f', 'null', '-']);
    const n = ((stdout + stderr).match(/pts_time/g) || []).length;
    return { n, per10: dur > 0 ? (n / dur) * 10 : 0 };
  } catch { return { n: null, per10: null }; }   // ffmpeg 가 죽어도 검사를 죽이지 않는다
}

const argv = process.argv.slice(2);
const noSheet = argv.includes('--no-sheet');
const filter = argv.find((a) => !a.startsWith('--'));

if (!existsSync(OUT)) { console.error(`${OUT}/ 가 없다`); process.exit(1); }
await mkdir(TMP, { recursive: true });

const dirs = (await readdir(OUT, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
  .map((d) => d.name)
  .filter((n) => !filter || n === filter || n.startsWith(filter))
  .sort();

// ⚠️ 스팅을 붙인 파일(`-reels-with-sting.mp4`)도 검사한다 — **발행하는 파일이 검사 대상이다.**
//    2026-08-24에 make-brand-sting.mjs 를 만들면서 이 구멍을 발견했다: 게이트가 원본만 보고
//    실제 발행물을 못 보면 게이트가 아니다.
const VARIANTS = ['-reels.mp4', '-reels-with-sting.mp4'];

const rows = [];
for (const d of dirs) {
 for (const suffix of VARIANTS) {
  const mp4 = path.join(OUT, d, `${d}${suffix}`);
  if (!existsSync(mp4)) continue;
  const label = suffix === '-reels.mp4' ? d : `${d} +sting`;
  const dur = await durationSec(mp4);
  const ink = [];
  for (let j = 0; j < POS.length; j++) ink.push(await inkAt(mp4, dur * POS[j], `${d}${suffix === '-reels.mp4' ? '' : '-s'}-${j}`));

  const black = ink.filter((v) => v < BLACK_MAX).length;
  const midLow = MID.filter((j) => ink[j] < MID_MIN).length;
  const blown = ink.filter((v) => v > BLOWN_MIN).length;
  const outOfBand = dur < BAND_MIN || dur > BAND_MAX;
  const overOurs = dur > OURS_MAX;
  const verdict = black ? 'FAIL' : (midLow || blown || outOfBand ? 'CHK ' : 'OK  ');
  const loopGap = Math.abs(ink[0] - ink[ink.length - 1]);
  // ⚠️ 변화폭 조건이 필요하다 — 전검정·전백 영상은 |첫−끝|=0 이라 루프형으로 잘못 찍힌다(음성 시험에서 발견).
  const spread = Math.max(...ink) - Math.min(...ink);

  const cuts = await cutsPer10s(mp4, dur);

  let sheet = null;
  if (!noSheet) sheet = await contactSheet(mp4, dur, d + (suffix === '-reels.mp4' ? '' : '-with-sting'));
  rows.push({ slug: label, dur, ink, verdict, black, midLow, blown, loopGap, spread, sheet, outOfBand, overOurs, cuts });
 }
}

if (!rows.length) { console.error('검사할 릴스가 없다 (out/<slug>/<slug>-reels.mp4)'); process.exit(1); }

const f2 = (v) => v.toFixed(2).padStart(6);
console.log(`\n릴스 렌더 후 자기검사 — ${rows.length}편 · 샘플 ${POS.map((p) => Math.round(p * 100) + '%').join(' ')}`);
console.log('판정  슬러그                       길이   ' + POS.map((p) => (Math.round(p * 100) + '%').padStart(6)).join('  ') + '   |첫−끝|   컷/10s');
for (const r of rows) {
  const c = r.cuts.n === null ? '   ?  ' : `${r.cuts.per10.toFixed(1).padStart(4)}(${r.cuts.n})`;
  console.log(`${r.verdict}  ${r.slug.padEnd(28)}${r.dur.toFixed(2).padStart(5)}s  ` +
    r.ink.map(f2).join('  ') + `   ${r.loopGap.toFixed(2).padStart(5)}p  ${c}` +
    (r.loopGap < 0.15 && r.spread > 0.5 ? ' 루프형' : ''));
}

const fails = rows.filter((r) => r.verdict === 'FAIL');
const chks = rows.filter((r) => r.verdict.trim() === 'CHK');
console.log('');
for (const r of fails) console.log(`⛔ ${r.slug}: 검은 프레임 ${r.black}장 (하한 ${BLACK_MAX}%) — 발행하지 않는다`);
for (const r of chks) {
  const why = [];
  if (r.midLow) why.push(`중간 구간 빈 화면 ${r.midLow}장 (하한 ${MID_MIN}%)`);
  if (r.blown) why.push(`과노출 ${r.blown}장 (상한 ${BLOWN_MIN}%)`);
  if (r.outOfBand) why.push(`길이 ${r.dur.toFixed(2)}s 가 ${BAND_MIN}~${BAND_MAX}s 밖 (업계 카더라 기준 — 발행을 막지는 않는다)`);
  console.log(`⚠️ ${r.slug}: ${why.join(' · ')} — 콘택트시트를 눈으로 확인`);
}
if (!fails.length && !chks.length) console.log('✅ 전편 통과 — 검은 프레임 0, 중간 공백 0, 과노출 0, 길이 대역 안');

// ── 컷 수 — 경고만 한다(위 머리말 참조). 막지 않는다.
const flat = rows.filter((r) => r.cuts.n === 0);
const unknown = rows.filter((r) => r.cuts.n === null);
if (flat.length) {
  console.log(`\n⚠️ 하드컷 0 — ${flat.length}편: ${flat.map((r) => r.slug).join(' · ')}`);
  console.log('   화면이 처음부터 끝까지 한 번도 안 바뀐다는 뜻이다.');
  console.log('   🔬 대조(2026-09-21 실측): @lazy_owen 릴스 4편은 36~53초에 컷 17~27 = **4.7~5.3/10초**.');
  console.log('   ▶ 쓸 수 있는 것: motion/mockups.html 의 목업 8종(chart · stagger-rows 포함) · 터미널 창 분할 배치.');
  console.log('   ⛔ 그래도 막지 않는다 — 「컷이 많으면 좋다」는 우리 데이터로 아직 검증 안 됐다(저쪽 4편·조회수 미상).');
}
if (unknown.length) console.log(`\n⚠️ 컷 수를 못 쟀다 — ${unknown.length}편. 「0」이 아니라 「못 물어봤다」다.`);

for (const r of rows.filter((x) => x.overOurs)) {
  console.log(`📏 ${r.slug}: ${r.dur.toFixed(2)}s — 우리 기존 최장(${OURS_MAX}s)을 넘는다.`);
  console.log('   ⚠️ 나쁘다는 뜻이 아니다. 우리 실측은 길이↔도달 −0.065(무관)이고, 07-23 브리핑은 완주율 우선을 적어뒀다.');
  console.log('   ▶ 다만 새 대역이므로 이 회차의 완주율을 따로 본다 — 비교군이 없다.');
}

if (!noSheet) {
  console.log(`\n콘택트시트: out/<slug>/<slug>-review-sheet.png (${POS.length}컷 가로 이어붙임)`);
  console.log('  ★ 자동 판정이 못 보는 것을 여기서 본다 — 잘린 자막, 겹친 요소, 색 어긋남, 워터마크 위치.');
}
console.log('  ⚠️ 이 검사는 hook-check.mjs 를 대체하지 않는다 (훅 유무는 그쪽이 첫 프레임으로 판정).');

await rm(TMP, { recursive: true, force: true }).catch(() => {});
if (fails.length) process.exitCode = 1;
