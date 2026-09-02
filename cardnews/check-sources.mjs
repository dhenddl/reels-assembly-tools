// check-sources.mjs — 원본이 생성물 폴더(`out/`)에 섞였는지 본다. 2026-08-26 신설.
//
// 사용: node check-sources.mjs
//       node check-sources.mjs --out <경로>   (기본: 이 파일 옆의 out/)
//
// ⛔ 왜 만들었나 — 실제로 자산을 잃었다.
//   릴스 화면 대본(`--lines` 입력)이 `out/<slug>/lines.txt` 에 있었고
//   `pipeline/.gitignore` 는 `cardnews/out/` 를 통째 제외했다.
//   → 릴스 10편의 대본이 이 디스크에만 있었다. 원격에도 다른 저장소에도 없었다.
//   ★ 하나는 이미 잃었다: `out/_assemble-01/_assemble-01-render.json` 이
//     `--lines out/_assemble-01/lines-min.txt` 를 기록해뒀는데 그 파일이 없다.
//     **렌더 기록은 남았는데 입력이 사라졌다.**
//   ▶ 2026-08-26 에 대본을 `cardnews/lines/<slug>.txt` 로 옮겼다.
//     이 게이트는 **같은 일이 다시 벌어지는 것**을 막는다.
//
// ★ 왜 문서가 아니라 코드인가:
//   이 프로젝트 규칙 — 판정난 규격은 문서에 적지 말고 코드로 고정한다.
//   「out/ 에 원본을 두지 말자」를 README 에 적어두면 새 세션이 안 읽는다.
//   2026-08-25 에 편성이 두 곳에 적혀 2주째 충돌한 채 살아 있었던 것과 같은 계열이다.
//
// ⛔ 이 게이트는 **파일을 옮기지 않는다.** 찾아서 알려주기만 한다 —
//   대본은 발행 원고이고 원고는 사용자 승인 없이 건드리지 않는다(CLAUDE.md 작업 4).

import { readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES_DIR } from './lines-path.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const oi = process.argv.indexOf('--out');
const OUT = oi >= 0 && process.argv[oi + 1]
  ? path.resolve(process.argv[oi + 1])
  : path.join(HERE, 'out');

// ── ① 확정 위반 — 원본이 out/ 안에 있다 ──────────────────────────────
// 2026-08-26 에 전량 밖으로 옮겼다. 여기 걸리면 **새로 생긴 것**이다.
const STRAY_SOURCE = [
  { re: /^lines.*\.txt$/i, home: 'cardnews/lines/<slug>.txt', why: 'make-termcast --lines 입력 (릴스 화면 대본)' },
  { re: /^narration.*\.txt$/i, home: 'cardnews/narration/<slug>.txt', why: 'make-termcast --narrate 입력 (릴스 내레이션 대본)' },
  { re: /^littly-reels-setup.*\.txt$/i, home: 'publish/runbooks/littly-reels-setup-<날짜>.txt', why: '손으로 쓴 운영 런북 (리틀리 등록 절차, 폰 복사용)' },
  { re: /^config\.json$/i, home: 'cardnews/configs/<slug>.json', why: '손으로 쓴 렌더 설정 (아무 스크립트도 안 읽지만 사람이 쓴 원고다)' },
];

// ── ①-b 증거 — out/ 에 두는 게 **맞는** 것 ────────────────────────────
// 터미널 캡처는 「그때 이렇게 나왔다」는 기록이라 재생성되지 않는다. 원본처럼 보인다.
// ⛔ 그래도 옮기지 않는다 — publish-output.txt 는 계정 ID·컨테이너 ID를 그대로 담고 있다
//   (`@dhenddl1 (371432…)`). 추적 대상으로 올리면 그게 저장소에 들어간다.
//   ★ 「백업이 없다」와 「백업하면 안 된다」는 다르다. 이 목록이 그 경계다.
const EVIDENCE = [
  /-output\.txt$/i,          // publish-output · insights-output · build-output
  /^plate-review-.*\.json$/i, // plate-review.mjs --json 출력
];

// ── ② 원본 의심 — 생성물 이름 규칙에 안 맞는 텍스트 파일 ─────────────
// 생성물은 슬러그 접두를 갖는다(`<slug>-reels.mp4`·`<slug>-render.json` 등).
// 그 규칙을 벗어난 텍스트 파일은 사람이 넣어둔 것일 수 있다.
// ⚠️ 이미지·영상·프레임은 안 본다 — 486개라 신호가 묻힌다.
const TEXTISH = /\.(txt|json|md|vtt|srt|csv)$/i;
const KNOWN_GENERATED = [
  /-reels-caption\.txt$/i,     // reel-caption.mjs
  /-render\.json$/i,           // make-termcast.mjs 렌더 레시피
  /-review\.json$/i,
  /-alt\.json$/i,
  /^frames?\b/i,
  /\.vtt$/i,                   // 자막 생성물
  // ↓ 초기 회차(day-0)는 `<slug>-` 접두 규칙이 생기기 전 이름이다.
  //   `reels-caption.txt` 는 매니페스트 caption 과 **바이트 동일**이라 재생성된다.
  //   `caption.txt` 는 caption + threadsText 를 손으로 이어붙인 복사용 시트다 —
  //   두 조각 다 post-day-0.json 에 있으므로 **원본이 아니다**(2026-08-26 대조 확인).
  /^caption\.txt$/i,
  /^reels-caption\.txt$/i,
];

if (!existsSync(OUT)) {
  console.log(`out/ 폴더가 없다: ${OUT}`);
  console.log('   렌더를 한 번도 안 돌린 클론이면 정상이다.');
  process.exit(0);
}

const stray = [];
const evidence = [];
const suspect = [];

function walk(dir, rel = '') {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { walk(abs, r); continue; }
    if (!e.isFile()) continue;
    const s = STRAY_SOURCE.find((x) => x.re.test(e.name));
    if (s) { stray.push({ rel: r, size: statSync(abs).size, home: s.home, why: s.why }); continue; }
    if (EVIDENCE.some((re) => re.test(e.name))) { evidence.push(r); continue; }
    if (!TEXTISH.test(e.name)) continue;
    if (KNOWN_GENERATED.some((re) => re.test(e.name))) continue;
    // 슬러그 접두를 가진 것은 생성물로 본다 (`<slug>-무엇.txt`)
    const slug = r.split('/')[0];
    if (e.name.startsWith(`${slug}-`)) continue;
    suspect.push({ rel: r, size: statSync(abs).size });
  }
}
walk(OUT);

console.log('원본/생성물 분리 검사 — out/ 안을 본다');
console.log('원본이 사는 곳:');
for (const s of STRAY_SOURCE) console.log(`   ${s.home.padEnd(46)} ${s.why}`);
console.log('');

if (stray.length) {
  console.log(`⛔ 원본이 out/ 안에 있다 — ${stray.length}건 (백업 없음)`);
  for (const s of stray) console.log(`   out/${s.rel}  (${s.size}바이트)\n      ↳ ${s.why}\n      → ${s.home}`);
  console.log('');
  console.log('   out/ 은 .gitignore 로 통째 제외된다 = 이 파일은 백업이 없다.');
  console.log('   ⛔ 옮기기만 한다. 내용은 고치지 않는다 — 발행 원고다(CLAUDE.md 작업 4).');
  console.log('   ⛔ 화이트리스트(!cardnews/out/…)로 풀지 않는다 —');
  console.log('      out/ 에는 publish-output.txt 처럼 계정 ID가 든 캡처도 있다.');
}

if (suspect.length) {
  if (stray.length) console.log('');
  console.log(`⚠️ 원본 의심 ${suspect.length}건 — 생성물 이름 규칙(<slug>-…)에 안 맞는 텍스트 파일이다.`);
  console.log('   게이트를 걸지 않는다. 사람이 「원본인가 증거인가」를 판단한다.');
  for (const s of suspect) console.log(`   out/${s.rel}  (${s.size}바이트)`);
  console.log('');
  console.log('   원본이면 out/ 밖으로 옮긴다. 실행 증거(터미널 캡처 등)면 그대로 둔다 —');
  console.log('   단 계정 ID·컨테이너 ID가 든 캡처는 out/ 안에 두는 게 맞다(제외 대상).');
}

if (!stray.length && !suspect.length) {
  console.log('✅ out/ 에 원본으로 보이는 파일 없음');
  if (evidence.length) {
    console.log(`   (증거 캡처 ${evidence.length}건은 out/ 에 그대로 둔다 — 계정 ID가 들어 있어 추적하면 안 된다)`);
  }
} else if (!stray.length) {
  console.log('');
  console.log('✅ 확정 위반 0건 — 알려진 원본은 전부 out/ 밖에 있다');
}

console.log('');
console.log('⚠️ 이 검사는 이름 규칙만 본다 — 스크립트가 실제로 읽는지는 안 본다.');
console.log('   새 입력 파일을 out/ 안에 만들면서 이름을 슬러그로 시작하면 안 잡힌다.');

// 확정 위반만 게이트를 건다. 의심은 경고로 둔다 —
// ★ 항상 빨간 게이트는 아무도 안 본다(materials.json `_두 종류의 표시` 와 같은 원칙).
process.exit(stray.length ? 1 : 0);
