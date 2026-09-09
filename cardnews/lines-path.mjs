// lines-path.mjs — 릴스 렌더 입력·기록의 경로 규칙. 단일 출처.
//   `--lines`   화면 대본   → cardnews/lines/<slug>.txt
//   `--narrate` 내레이션 대본 → cardnews/narration/<slug>.txt
//   렌더 기록(레시피)      → cardnews/renders/<slug>-render.json   ← 2026-09-09 추가
//
// ⚠️ 파일 이름이 `lines-path` 인 건 이력이다 — 처음엔 `--lines` 만 다뤘다.
//    이미 세 곳이 import 하고 자료 3·4호에 편입돼 있어 이름을 바꾸지 않았다.
//    (2026-08-13 에 파일 하나 옮기고 목록을 안 고쳐 공개 리포가 11일 죽은 전례가 있다.)
//
// 사용처 3곳 + 게이트 1곳:
//   cardnews/render-reels.mjs      (렌더 입력)
//   publish/check-rank-claims.mjs  (릴스 화면 텍스트의 순위 주장 검사)
//   publish/check-schedule.mjs     (릴스 슬롯 준비 여부)
//   cardnews/check-sources.mjs     (원본이 out/ 에 섞였는지)
//   cardnews/make-termcast.mjs     (렌더 기록 쓰는 자리 — 2026-09-09)
//
// ⛔ 2026-08-26 신설. 종전에는 대본이 `out/<slug>/lines.txt` 에 있었고 `out/` 은
//    `.gitignore` 로 통째 제외돼 있었다 — **생성물 폴더에 원본이 섞여 있었다.**
//    결과: 릴스 10편의 화면 대본이 이 디스크에만 있었고 원격에도 다른 저장소에도 없었다.
//    ★ 실제로 하나는 이미 잃었다 — `out/_assemble-01/_assemble-01-render.json` 이
//      `--lines out/_assemble-01/lines-min.txt` 를 기록해뒀는데 그 파일이 없다.
//      렌더 기록은 남았는데 입력이 사라진 것이다.
//
// ★ 왜 화이트리스트(`!cardnews/out/*/lines.txt`)로 안 풀었나:
//   ① `pipeline/.gitignore` 화이트리스트는 이 프로젝트에서 이미 사고를 냈다 —
//      2026-08-13 커밋에서 한 줄을 안 넣어 공개 리포가 11일간 실행 불가였고,
//      2026-08-26 에는 `publish/env.mjs` 가 막혀 진입점 5개가 죽을 뻔했다.
//      **목록 유지를 사람에게 다시 맡기는 방향이다.**
//   ② `out/` 에는 내보내면 안 되는 것도 있다 — `publish-output.txt` 는
//      계정 ID가 그대로 든 터미널 캡처다. 넓게 풀면 그게 따라 들어간다.
//   ▶ 그래서 원본을 밖으로 뺐다. `out/` 은 이제 **순수 생성물**이고
//     통째 제외가 맞는 규칙이 된다 — 예외를 유지할 필요가 없다.
//
// ⚠️ 대본 내용은 발행 원고다. 이 파일은 **경로만** 다룬다 (CLAUDE.md 작업 4).

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 화면 대본이 사는 곳. `cardnews/lines/<slug>.txt` */
export const LINES_DIR = path.join(HERE, 'lines');

/**
 * 내레이션 대본이 사는 곳. `cardnews/narration/<slug>.txt`
 * ⛔ 2026-08-26 에 `out/<slug>/narration*.txt` 에서 옮겨왔다 — 화면 대본과 같은 이유다.
 *   `make-termcast.mjs --narrate` 가 읽는 **발행 원고**인데 out/ 안이라 백업이 없었다.
 * ⚠️ 프로그램이 슬러그로 찾지 않는다 — `--narrate <경로>` 로 직접 준다.
 *   그래서 규칙이 코드에 없으면 다음 사람이 또 out/ 안에 만든다. 그 자리를 여기로 못 박는다.
 */
export const NARRATION_DIR = path.join(HERE, 'narration');

/** 슬러그 → 내레이션 대본 절대경로. */
export function narrationPath(slug) {
  if (!slug || typeof slug !== 'string') throw new Error('narrationPath: slug 가 필요하다');
  return path.join(NARRATION_DIR, `${slug}.txt`);
}

/** 슬러그 → 대본 절대경로. 파일이 있든 없든 경로를 만든다(존재 확인은 호출자가 한다). */
export function linesPath(slug) {
  if (!slug || typeof slug !== 'string') throw new Error('linesPath: slug 가 필요하다');
  return path.join(LINES_DIR, `${slug}.txt`);
}

/** 슬러그에 대본이 있나. */
export function hasLines(slug) {
  return existsSync(linesPath(slug));
}

/**
 * 대본이 있는 슬러그 전량.
 * `_` 접두는 작업용 스크래치다(`_assemble-01`) — 기본 제외.
 * 발행물이 아니고 다른 세션이 실시간으로 만들기도 한다.
 */
export function listLineSlugs({ includeScratch = false } = {}) {
  if (!existsSync(LINES_DIR)) return [];
  return readdirSync(LINES_DIR)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.slice(0, -4))
    .filter((s) => includeScratch || !s.startsWith('_'))
    .sort();
}

/**
 * 렌더 **기록**(레시피)가 사는 곳. `cardnews/renders/<slug>-render.json`
 *
 * ⛔ 2026-09-09 에 `out/<slug>/<slug>-render.json` 에서 옮겨왔다.
 *   이 기록은 2026-08-21 에 **자산을 잃어서** 생겼다 — 릴스 4편의 훅이 빠졌는데
 *   원래 렌더 명령이 어디에도 없어 영상 프레임을 뽑아 화면에서 읽어 복원했다.
 *   ★★ 그러고는 그 기록을 **`out/` 안에** 뒀다. `.gitignore` 가 통째 제외하는 자리다.
 *      **손실을 막으려고 만든 파일이 손실 구역에 있었다** — 14개 전부 이 디스크에만 있었다.
 *   ▶ 대본(2026-08-26)과 같은 처방이다. 다만 이건 입력이 아니라 **기록**이라
 *     재생성되지 않는다 — 다시 렌더하면 `renderedAt` 이 바뀌어 그때의 기록이 아니다.
 *
 * ⚠️ 아무 스크립트도 이 파일을 **읽지 않는다.** 사람이 재현할 때 읽는다.
 *   그래서 규칙이 코드에 없으면 다음 사람이 또 out/ 안에 만든다. 그 자리를 여기로 못 박는다.
 */
export const RENDERS_DIR = path.join(HERE, 'renders');

/** 슬러그 → 렌더 기록 절대경로. */
export function renderRecipePath(slug) {
  if (!slug || typeof slug !== 'string') throw new Error('renderRecipePath: slug 가 필요하다');
  return path.join(RENDERS_DIR, `${slug}-render.json`);
}
