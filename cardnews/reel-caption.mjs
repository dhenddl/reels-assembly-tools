// reel-caption.mjs — 릴스 캡션 자동 생성: 발행 매니페스트(post-*.json)의 caption을 텍스트 파일로 추출
// 릴스는 트렌드 음악 지원 때문에 폰 수동 업로드가 정답이라(README 참고), 캡션 입력까지 사람 손이었음.
// 2026-07-23: 캡션·해시태그가 릴스에 전혀 안 붙던 공백 발견 → 캐러셀과 같은 캡션을 자동 추출해
// 영상 옆에 .txt로 떨궈두고, 업로드 시 복사-붙여넣기만 하면 되게 함.
//
// make-reels.mjs / make-termcast.mjs가 빌드 완료 후 자동 호출(슬러그로 post-<슬러그>.json 자동 탐지).
// 단독 실행도 가능(매니페스트가 영상보다 늦게 확정된 경우 재생성용):
//   node reel-caption.mjs --slug day-2 --out out/day-2/day-2-reels-caption.txt
//   node reel-caption.mjs --manifest ../publish/post-day-2.json --out out/day-2/day-2-reels-caption.txt
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// 슬러그(day-2, tip-2 등)로 pipeline/publish/post-<슬러그>.json 자동 탐지. 없으면 null(치명적 오류 아님).
export function findManifest(slug) {
  if (!slug) return null;
  const p = resolve(HERE, '../publish', `post-${slug}.json`);
  return existsSync(p) ? p : null;
}

// 매니페스트의 caption(인스타 캐러셀용, 해시태그 포함)을 그대로 릴스 캡션으로 재사용해 outTxtPath에 기록.
export function writeReelCaption(manifestPath, outTxtPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const caption = manifest.caption ?? manifest.threadsText ?? '';
  if (!caption.trim()) throw new Error(`${manifestPath}에 caption/threadsText 없음`);
  writeFileSync(outTxtPath, caption, 'utf8');
  return caption;
}

// 영상 스크립트에서 호출하는 진입점: 캡션 있으면 쓰고 경로 반환, 없으면 안내만 출력하고 null 반환(빌드 중단 X)
export function tryWriteReelCaption({ slug, manifestOverride, videoOutPath }) {
  const manifestPath = manifestOverride ? resolve(HERE, manifestOverride) : findManifest(slug);
  const captionOut = videoOutPath.replace(/\.mp4$/, '-caption.txt');
  if (!manifestPath) {
    console.log(`ℹ️ 캡션 매니페스트 없음(post-${slug}.json) — 나중에 "node reel-caption.mjs --slug ${slug} --out ${captionOut}"로 생성 가능`);
    return null;
  }
  try {
    writeReelCaption(manifestPath, captionOut);
    console.log(`릴스 캡션 저장: ${captionOut} (업로드 시 복사-붙여넣기)`);
    return captionOut;
  } catch (e) {
    console.warn(`⚠️ 캡션 생성 건너뜀: ${e.message}`);
    return null;
  }
}

// ---------- 드라이브 파일명용 발행일 ----------
// (2026-08-05) 드라이브에 `originality-reels.mp4`처럼 날짜 없는 이름이 16개 쌓여 "오늘 올릴 게 뭔지"를
// 파일명만 보고 못 골라내는 상태가 됐다(사용자 지적).
//
// ⚠️ 핵심 — 드라이브가 이미 보여주는 "업로드 시각"은 발행일이 아니다.
//    originality는 08-04 11:01 업로드 / 08-05 발행이다. 즉 업로드 시각을 파일명에 박으면
//    지금 헷갈리는 원인이 그대로 남는다. 우리가 알아야 하는 건 "언제 계정에 나가는가"뿐이다.
//    → 발행일은 추론하지 않고 매니페스트(post-<슬러그>.json)의 publishDate에서만 읽는다.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 반환: 'YYYY-MM-DD' | null(매니페스트 없음/필드 없음). 형식이 틀리면 조용히 넘기지 않고 던진다.
export function readPublishDate({ slug, manifestOverride, override }) {
  if (override) {
    if (!DATE_RE.test(override)) throw new Error(`--pubdate 형식은 YYYY-MM-DD여야 함 (받은 값: "${override}")`);
    return override;
  }
  const manifestPath = manifestOverride ? resolve(HERE, manifestOverride) : findManifest(slug);
  if (!manifestPath) return null;
  const { publishDate } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (publishDate === undefined || publishDate === null) return null;
  if (!DATE_RE.test(publishDate)) {
    throw new Error(`${basename(manifestPath)}의 publishDate 형식은 YYYY-MM-DD여야 함 (받은 값: ${JSON.stringify(publishDate)})`);
  }
  return publishDate;
}

// ── 릴스 발행일 해석 (2026-09-10 신설) ────────────────────────────────────
// ⛔⛔ `readPublishDate` 만으로는 안 된다. 그건 `post-<슬러그>.json` 을 찾는데,
//   **릴스 슬러그와 매니페스트 이름이 1:1 이 아니다** — `reels-signals` 의 매니페스트는
//   `post-week10-mon.json` 이다. 실측: `readPublishDate({slug:'reels-signals'})` → **null**.
//   그 상태로 업로드를 걸면 「발행일을 못 찾았다」로 조용히 안 올라간다.
// ★ 릴스 발행일의 정본은 **`reels-recipes.json` 의 `publishDate`** 다 —
//   `check-schedule.mjs` 도 그 키로 슬롯을 찾는다(`reelFor(day)`). 같은 출처를 쓴다.
export function reelPublishDate(slug) {
  const viaManifest = readPublishDate({ slug });
  if (viaManifest) return viaManifest;
  try {
    const recipes = JSON.parse(readFileSync(join(HERE, 'reels-recipes.json'), 'utf8')).recipes ?? [];
    const hit = recipes.find((r) => r.slug === slug);
    return hit?.publishDate ?? null;
  } catch {
    return null;   // 레시피를 못 읽는 것은 치명적 오류가 아니다 — 호출자가 「못 찾았다」로 처리한다
  }
}

// ── 드라이브 업로드 (2026-09-10 신설 · 사용자 지시 「렌더가 되었다 = 드라이브 업로드까지 완료」) ──
//
// ⛔⛔ 왜 여기로 옮겼나: 이 블록이 `make-reels.mjs` 와 `make-termcast.mjs` 에 **똑같이 두 벌** 있었고
//   **`assemble-reel.mjs`(플레이트 릴스 조립기)에는 아예 없었다.** 그 결과 2026-09-10 에
//   9/14 주간 릴스 3편이 **렌더는 됐는데 드라이브에 0건**이었다 — 릴스는 폰 업로드이고
//   폰은 드라이브에서 받으므로 **그날 올릴 영상이 폰에 없는 상태**였다.
//   ★ `check-schedule` 은 그 셋을 ✅ 로 찍었다. 그건 **로컬 파일만** 본다.
// ★★ 세 번째 사본을 만들지 않았다 — 이 파일에 `drivePathFor` 가 이미 있어서 여기 둔다.
//   (이 저장소의 원칙: 사람이 복사하면 갈라지고 스크립트가 복사하면 안 갈라진다.)
//
// ⚠️ 설정 파일 위치가 중요하다 (2026-08-04): %APPDATA% 의 rclone.conf 는 클로드 세션과
//   사용자 터미널이 서로 다른 사본을 보게 되어 토큰 갱신이 갈렸다(invalid_grant).
//   그래서 이 폴더의 rclone.conf 를 **있으면 무조건 우선** 쓴다.
export function uploadReelToDrive({ files, pubDate, remote = 'gdrive:dhenddl-reels', rclone = 'rclone' }) {
  const list = (files || []).filter((f) => f && existsSync(f));
  if (!list.length) return { ok: false, why: '올릴 파일이 없다', uploaded: [] };
  if (!pubDate) {
    return { ok: false, uploaded: [], why: '발행일을 못 찾았다 — 드라이브 파일명이 <발행일>-<파일명> 규칙이라 올릴 수 없다' };
  }
  const localConf = join(HERE, 'rclone.conf');
  const confArgs = existsSync(localConf) ? ['--config', localConf] : [];
  const uploaded = [];
  for (const f of list) {
    const dest = drivePathFor(remote, f, pubDate);
    // copy(폴더로, 이름 유지)가 아니라 copyto(대상 파일명 지정)다 — 이름을 바꿔 올리려면 필수.
    const r = spawnSync(rclone, [...confArgs, 'copyto', f, dest, '--stats-one-line'],
      { stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.status !== 0) {
      return { ok: false, uploaded, why: `rclone 실패(${basename(f)}) — rclone 경로·gdrive 원격 설정을 본다` };
    }
    uploaded.push(dest);
  }
  return { ok: true, uploaded, why: '' };
}

// 드라이브 업로드 경로 = <발행일>-<원래 파일명>. 이름 정렬이 곧 발행 시간순이 된다.
export const drivePathFor = (drive, filePath, pubDate) =>
  `${drive.replace(/\/+$/, '')}/${pubDate}-${basename(filePath)}`;

// ---------- 단독 CLI 실행 ----------
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = { manifest: null, slug: null, out: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--manifest') args.manifest = argv[++i];
    else if (argv[i] === '--slug') args.slug = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  if (!args.out) throw new Error('사용법: node reel-caption.mjs --slug <슬러그> --out <txt경로> [--manifest <post.json 경로>]');
  const manifestPath = args.manifest ? resolve(HERE, args.manifest) : findManifest(args.slug);
  if (!manifestPath) throw new Error(`매니페스트를 못 찾음 — --manifest 직접 지정하거나 --slug 확인 (post-${args.slug}.json)`);
  const caption = writeReelCaption(manifestPath, resolve(HERE, args.out));
  console.log(`릴스 캡션 저장: ${args.out}\n---\n${caption}`);
}
