// reels-recipes.json 을 읽어 make-termcast.mjs 를 돌린다. (2026-08-21 신설)
//
// 왜 러너를 두는가:
//   ① 한국어 인자를 셸에 직접 타이핑하지 않는다 — 파일(UTF-8)에서 읽어 spawn 인자로 넘긴다.
//      2026-08-11에 `.cmd` 한글 주석이 파싱을 깨고 exit 0(거짓 성공)을 냈던 계열의 위험이다.
//   ② 레시피가 코드로 남는다 — 2026-08-21 훅 누락 사고의 근본 원인이
//      "--cmd/--title/--outro/훅이 세션 컨텍스트에만 있었다"였다.
//   ③ ★ 훅 없는 렌더를 막는다 — make-termcast.mjs 는 --hook-text 가 없어도
//      경고 없이 돌고 exit 0 을 낸다. 여기서 게이트를 세운다.
//
// 사용: node render-reels.mjs             (레시피 전량)
//       node render-reels.mjs reels-297   (하나만)
//       node render-reels.mjs reels-297 --drive   (드라이브 업로드까지)

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linesPath, LINES_DIR } from './lines-path.mjs';

// ★ 경로는 CWD가 아니라 이 파일 위치를 기준으로 잡는다.
//   2026-08-21: 사용자가 다른 폴더(AppData\Roaming\rclone)에서 실행해
//   "Cannot find module" 로 죽었다. 어디서 실행해도 되게 만든다.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TERMCAST = path.join(HERE, 'make-termcast.mjs');
const DRIVE_REMOTE = 'gdrive:dhenddl-reels';

const argv = process.argv.slice(2);
const wantDrive = argv.includes('--drive');

// ★ 레시피 파일을 바꿔 낄 수 있다 (2026-08-26).
//   종전에는 파일명이 박혀 있어서 **배포 샘플을 그대로 돌려볼 수 없었다** —
//   샘플을 검증하려면 원본을 밀어내야 했고, 그러면 샘플이 「돌아간다」는 걸 증명하지 못한다.
//   받는 사람도 자기 파일을 만들기 전에 샘플부터 돌려볼 수 있다.
const ri = argv.indexOf('--recipes');
const RECIPES = ri >= 0 && argv[ri + 1]
  ? path.resolve(process.cwd(), argv[ri + 1])
  : path.join(HERE, 'reels-recipes.json');

// --recipes 의 값이 슬러그로 오해되지 않게 뺀다.
// ⛔ 2026-08-26 실측 버그: 조건을 `i !== ri + 1` 로만 쓰면 --recipes 가 없을 때
//    ri === -1 이라 **인덱스 0(=슬러그)을 걸러버린다.** 그러면 only 가 null 이 되어
//    「없는 슬러그」를 줘도 오류 대신 **전량 렌더가 시작된다.**
//    ★ 회귀 검사에서 잡았다 — 없는 슬러그를 줬는데 reels-297 이 렌더되기 시작했다.
const skipIdx = ri >= 0 ? ri + 1 : -1;
const only = argv.filter((a, i) => !a.startsWith('--') && i !== skipIdx).find(Boolean) ?? null;

const cfg = JSON.parse(await readFile(RECIPES, 'utf8'));
const defaults = cfg._defaults ?? {};
const list = cfg.recipes.filter((r) => !only || r.slug === only);

if (!list.length) { console.error(`레시피 없음: ${only ?? '(전량)'}`); process.exit(1); }

// ★ 게이트 — 훅 없는 레시피는 렌더하지 않는다.
const noHook = list.filter((r) => !r.hookText);
if (noHook.length) {
  console.error(`⛔ 훅이 없는 레시피 ${noHook.length}건: ${noHook.map((r) => r.slug).join(' ')}`);
  console.error('   훅 프레임은 2026-08-06에 3초 이탈(69~84%)을 고치려고 신설한 장치다.');
  console.error('   의도적으로 빼려면 reels-recipes.json 에 "noHookReason" 을 적어야 한다.');
  const forced = noHook.filter((r) => r.noHookReason);
  if (forced.length !== noHook.length) process.exit(1);
}

// ★ 게이트 — 대본 폴더가 통째로 없으면 죽는다.
//   ⛔ 없으면 아래 루프가 회차마다 「없음 — 건너뜀」을 찍고 `렌더 완료 0/N` 으로 **exit 0** 을 낸다.
//     2026-08-26 하루에 같은 모양(0건인데 통과)을 네 번 고쳤다. 여기서 미리 막는다.
if (!existsSync(LINES_DIR)) {
  console.error(`⛔ 대본 폴더가 없다: ${LINES_DIR}`);
  console.error('   릴스 화면 대본은 cardnews/lines/<slug>.txt 다 (2026-08-26 이전: out/<slug>/lines.txt).');
  console.error('   저장소를 새로 클론했다면 대본이 같이 왔는지 확인한다.');
  process.exit(1);
}

const run = (args) => new Promise((res, rej) => {
  const p = spawn(process.execPath, args, { stdio: 'inherit', cwd: HERE });
  p.on('close', (code) => (code === 0 ? res() : rej(new Error(`exit ${code}`))));
});

let ok = 0;
for (const r of list) {
  const outDir = path.join(HERE, 'out', r.slug);
  // ⛔ 2026-08-26: 대본이 `out/<slug>/lines.txt` 에서 `lines/<slug>.txt` 로 옮겨졌다.
  //    `out/` 은 .gitignore 로 통째 제외돼 있어서 **원본이 백업 없이 살고 있었다** —
  //    경로 규칙은 lines-path.mjs 가 단일 출처로 들고 있다(소비자가 3곳이라 각자 박으면 갈린다).
  const lines = linesPath(r.slug);
  if (!existsSync(lines)) { console.error(`⛔ ${r.slug}: ${lines} 없음 — 건너뜀`); continue; }

  const args = [TERMCAST,
    '--lines', lines,
    '--cmd', r.cmd,
    '--title', r.title,
    '--slug', r.slug,
    '--out', path.join(outDir, `${r.slug}-reels.mp4`),
  ];
  if (r.outro) args.push('--outro', r.outro);
  if (r.hookText) {
    args.push('--hook-text', r.hookText);
    args.push('--hook-ms', String(r.hookMs ?? defaults.hookMs ?? 1750));
    if (r.hookBadge) args.push('--hook-badge', r.hookBadge);
    if (r.hookSub) args.push('--hook-sub', r.hookSub);
  }
  if (r.publishDate) args.push('--pubdate', r.publishDate);
  // ★ 빈 골격 (2026-08-24). 레시피에 "skeleton": true 를 적은 회차만 켜진다 — 기본 off.
  //   포맷 단독 변수로 실험하려고 회차별 플래그로 뒀다. 전역 기본값으로 올리지 않는다.
  if (r.skeleton) args.push('--skeleton');
  if (wantDrive) args.push('--drive', DRIVE_REMOTE);

  console.log(`\n===== ${r.slug} =====`);
  try { await run(args); ok++; }
  catch (e) { console.error(`⛔ ${r.slug} 렌더 실패: ${e.message}`); }
}

console.log(`\n렌더 완료 ${ok}/${list.length}`);
console.log('→ 다음: node hook-check.mjs   (첫 프레임 훅 유무 검사)');
console.log('  그 다음: node reel-review.mjs (영상 전체 자기검사 + 콘택트시트)');
if (ok !== list.length) process.exitCode = 1;
