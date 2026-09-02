// 릴스 훅 프레임 검사기 (2026-08-21 신설)
//
// 왜 만들었나:
//   2026-08-21에 릴스 4편(8/21·24·26·28)을 만들면서 **훅 프레임을 전부 빠뜨렸다.**
//   훅 프레임은 2026-08-06에 "3초 이탈 69~84%"를 고치려고 신설한 장치이고,
//   승자 2편(8/12 도달 709, 8/19 이탈 65.5%)이 **둘 다 갖고 있다.**
//
//   빠뜨린 이유는 조용하다 — `make-termcast.mjs`는 `--hook-text`가 없으면
//   경고 없이 훅 없는 모드로 돌고 exit 0을 낸다. 렌더 로그·글자 수·파일 크기
//   전부 정상이었고, 육안 확인 5프레임도 통과했다(있는 것의 결함은 보이지만
//   **없는 것은 안 보인다**).
//
// 판정 방법:
//   첫 프레임의 밝은 픽셀 비율(=잉크)을 센다. 실측으로 완전히 갈렸다.
//     훅 있음 5편 : 1.63 ~ 3.72 %
//     훅 없음 4편 : 0.24 ~ 0.27 %
//   경계를 1.0%로 둔다 — 양쪽으로 4배 이상 여유가 있다.
//
// 의존: ffmpeg 뿐. PGM(P5)은 헤더가 자기설명적이라 파싱이 사소하다.
//
// 사용: node hook-check.mjs            (out/ 전체)
//       node hook-check.mjs reels-297  (하나만)

import { readdir, readFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

// ★ 경로는 CWD가 아니라 이 파일 위치를 기준으로 잡는다.
//   render-reels.mjs 가 2026-08-21에 같은 것을 고쳤는데(다른 폴더에서 실행해 죽었다)
//   이 파일에는 안 왔다. 2026-08-25에 게이트를 pipeline/ 에서 일괄 실행하다
//   **"out/ 가 없다"로 exit 1** 이 나서 드러났다 — 검사가 통과했는지 실패했는지가
//   **어느 폴더에서 돌렸는지에 달려 있었다.**
//   ⛔ 게이트가 CWD 에 따라 결과를 바꾸면 그건 게이트가 아니다.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const TMP = path.join(HERE, 'out', '.hookcheck');
const INK_THRESHOLD = 96;   // 0~255. 이 위를 잉크로 본다
const HOOK_MIN_PCT = 1.0;   // 이 위면 훅 프레임이 있다고 판정

// P5 PGM 파서 — "P5\n<w> <h>\n<max>\n" + 바이너리
function parsePGM(buf) {
  let i = 0;
  const tok = () => {
    while (i < buf.length) {
      // 공백 건너뛰기
      while (i < buf.length && /\s/.test(String.fromCharCode(buf[i]))) i++;
      if (buf[i] === 0x23) { while (i < buf.length && buf[i] !== 0x0a) i++; continue; } // 주석
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
  parseInt(tok(), 10); // maxval
  i++; // 헤더 뒤 공백 1개
  return { w, h, data: buf.subarray(i, i + w * h) };
}

async function inkPctOfFirstFrame(mp4, tag) {
  const pgm = path.join(TMP, `${tag}.pgm`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4,
    '-vf', 'select=eq(n\\,0),format=gray', '-vframes', '1', pgm]);
  const { w, h, data } = parsePGM(await readFile(pgm));
  let ink = 0;
  for (let k = 0; k < data.length; k++) if (data[k] > INK_THRESHOLD) ink++;
  await unlink(pgm).catch(() => {});
  return { pct: (100 * ink) / (w * h), w, h };
}

// 훅 프레임은 2026-08-06 신설이다. 그 전 회차는 없는 게 정상이므로 면제한다.
// (caption-check.mjs 가 "없음 3편은 자동화 만들기 전"을 설명한 것과 같은 처리)
// ⚠️ 여기에 새 슬러그를 추가하지 않는다 — 면제는 과거 회차에만 해당한다.
const PRE_HOOK_ERA = new Set([
  'day-0', 'day-1', 'day-2',
  'tip-1', 'tip-2', 'tip-7', 'tip-8',
  'week3-recap', 'originality', 'moving-carousel-01',
]);

const filter = process.argv[2];

if (!existsSync(OUT)) { console.error(`${OUT}/ 가 없다`); process.exit(1); }
await mkdir(TMP, { recursive: true });

const dirs = (await readdir(OUT, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
  .map((d) => d.name)
  .filter((n) => !filter || n === filter || n.startsWith(filter))
  .sort();

const rows = [];
for (const d of dirs) {
  const mp4 = path.join(OUT, d, `${d}-reels.mp4`);
  if (!existsSync(mp4)) continue;               // 릴스가 없는 회차는 대상 아님
  const { pct } = await inkPctOfFirstFrame(mp4, d);
  rows.push({ slug: d, pct, hook: pct >= HOOK_MIN_PCT, exempt: PRE_HOOK_ERA.has(d) });
}

if (!rows.length) { console.error('대상 릴스 없음'); process.exit(1); }

const hdr = `${'회차'.padEnd(22)}${'첫프레임 잉크'.padStart(14)}${'훅'.padStart(8)}`;
console.log(hdr);
console.log('-'.repeat(46));
for (const r of rows) {
  const mark = r.hook ? '있음' : (r.exempt ? '면제(8/06전)' : '⛔ 없음');
  console.log(`${r.slug.padEnd(22)}${(r.pct.toFixed(2) + '%').padStart(14)}${mark.padStart(8)}`);
}
console.log('-'.repeat(46));

const missing = rows.filter((r) => !r.hook && !r.exempt);
const exempted = rows.filter((r) => !r.hook && r.exempt);
console.log(`\n릴스 ${rows.length}편 · 훅 있음 ${rows.filter((r) => r.hook).length} · 면제 ${exempted.length} · **없음 ${missing.length}**`);

if (missing.length) {
  console.log(`\n⛔ 훅 프레임 없음 ${missing.length}편 — ${missing.map((r) => r.slug).join(' ')}`);
  console.log('   → make-termcast.mjs 를 --hook-text/--hook-sub/--hook-badge/--hook-ms 1750 로 재렌더할 것');
  console.log('   (승자 2편 실측: 8/12 도달 709, 8/19 이탈 65.5% 둘 다 훅 1.75초)');
} else {
  console.log('\n✅ 8/06 이후 전량 훅 프레임 확인');
}

console.log('→ 다음: node reel-review.mjs   (영상 전체 자기검사 + 콘택트시트)');

// 렌더 함정과 같은 등급으로 취급한다 — 발행 전에만 잡을 수 있고, 놓치면 발행물에 남는다.
if (missing.length) process.exitCode = 1;
