// reel-caption.mjs — 릴스 캡션 자동 생성: 발행 매니페스트(post-*.json)의 caption을 텍스트 파일로 추출
// 릴스는 트렌드 음악 지원 때문에 폰 수동 업로드가 정답이라(README 참고), 캡션 입력까지 사람 손이었음.
// 2026-07-23: 캡션·해시태그가 릴스에 전혀 안 붙던 공백 발견 → 캐러셀과 같은 캡션을 자동 추출해
// 영상 옆에 .txt로 떨궈두고, 업로드 시 복사-붙여넣기만 하면 되게 함.
//
// make-reels.mjs / make-termcast.mjs가 빌드 완료 후 자동 호출(슬러그로 post-<슬러그>.json 자동 탐지).
// 단독 실행도 가능(매니페스트가 영상보다 늦게 확정된 경우 재생성용):
//   node reel-caption.mjs --slug day-2 --out out/day-2/day-2-reels-caption.txt
//   node reel-caption.mjs --manifest ../publish/post-day-2.json --out out/day-2/day-2-reels-caption.txt
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
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

// ── AI 라벨 안내 파일 (2026-10-02 신설 · 사용자 지시 「1번부터 시작」) ──────────────
// ⛔⛔ 왜: 9/25 `reels-no-face` 가 매니페스트 `isAiGenerated: true` 인데 **라벨 없이** 나갔다(사용자 앱 확인).
//   릴스는 폰 업로드라 라벨은 **사람이 앱에서 켠다.** 그런데 그 「켜야 한다」는 기록이 매니페스트에만 있고
//   폰이 받는 드라이브에는 영상·캡션 txt 뿐이었다 — **기록이 업로드하는 사람 앞에 안 갔다.**
//   캡션 누락(9/18~25)과 같은 자리(폰 업로드 경로)의 두 번째 구멍이다(log [2026-09-28]).
// ▶ 매니페스트가 `isAiGenerated: true` 면 캡션 txt **옆에** `<slug>-reels-AI-LABEL-ON.txt` 를 같이 만든다.
//   드라이브 이름 규약(<발행일>-<파일명>)을 타면 폰 목록에서 영상·캡션 바로 옆 줄에 뜬다.
// ⛔ 캡션 txt 안에 넣지 않는다 — 폰에서 「전체 선택 → 복사」하면 안내문이 캡션에 같이 붙는다.
// ⛔ 캡션 파일 이름도 바꾸지 않는다 — `check-schedule` 이 `<발행일>-<slug>-reels-caption.txt` 를 이름으로 찾는다.
// ⚠️ 파일명은 ASCII 로 둔다 — `check-schedule` 이 rclone lsf 출력과 이름을 문자열로 대조한다(인코딩 변수를 안 만든다).
// ★ 플래그가 false/없음으로 바뀌면 남아 있던 안내 파일을 지운다 — 낡은 안내가 「켜라」고 말하면 안 된다.
export const aiLabelNotePathFor = (captionPath) => captionPath.replace(/-caption\.txt$/, '-AI-LABEL-ON.txt');

function aiLabelNoteText(manifestPath) {
  return [
    '[AI 라벨 켜기] 이 회차는 AI 로 만든 구간이 있습니다.',
    '업로드할 때 인스타 앱의 「AI 라벨 추가」를 켜 주세요.',
    '',
    `근거: ${basename(manifestPath)} 의 isAiGenerated: true`,
    '게시 뒤 아침 점검(check-reel-published)이 라벨이 실제로 켜졌는지 API 로 되읽습니다.',
    '이 파일은 캡션이 아닙니다. 캡션은 옆의 -reels-caption.txt 입니다.',
    '',
  ].join('\n');
}

// 캡션 txt 와 함께 드라이브에 올라갈 파일들 — 캡션 + (있으면) AI 라벨 안내. 조립기 셋이 같은 함수를 쓴다.
export function captionSidecars(captionPath) {
  if (!captionPath) return [];
  return [captionPath, aiLabelNotePathFor(captionPath)].filter((f) => existsSync(f));
}

// 매니페스트의 caption(인스타 캐러셀용, 해시태그 포함)을 그대로 릴스 캡션으로 재사용해 outTxtPath에 기록.
// isAiGenerated: true 면 옆에 AI 라벨 안내 파일도 쓴다(위 절).
export function writeReelCaption(manifestPath, outTxtPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const caption = manifest.caption ?? manifest.threadsText ?? '';
  if (!caption.trim()) throw new Error(`${manifestPath}에 caption/threadsText 없음`);
  writeFileSync(outTxtPath, caption, 'utf8');
  const notePath = aiLabelNotePathFor(outTxtPath);
  if (manifest.isAiGenerated === true) {
    writeFileSync(notePath, aiLabelNoteText(manifestPath), 'utf8');
    console.log(`AI 라벨 안내 저장: ${notePath} (매니페스트 isAiGenerated: true — 업로드 때 앱에서 라벨을 켠다)`);
  } else if (notePath !== outTxtPath && existsSync(notePath)) {
    unlinkSync(notePath);
    console.log(`AI 라벨 안내 삭제: ${notePath} (매니페스트 isAiGenerated 가 true 가 아니다)`);
  }
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
  // 업로드 끝에 지난 회차를 정리 폴더로 내린다 — 스위치가 켜진 뒤에만(위 DRIVE_ARCHIVE_ON_UPLOAD). 실패해도 업로드 결과는 그대로다.
  if (DRIVE_ARCHIVE_ON_UPLOAD) {
    try { printDrivePlan(archiveDriveOld({ apply: true, remote, rclone }), { apply: true }); }
    catch (e) { console.log(`⚠️ 드라이브 정리 건너뜀 — ${e.message}`); }
  }
  return { ok: true, uploaded, why: '' };
}

// 드라이브 업로드 경로 = <발행일>-<원래 파일명>. 이름 정렬이 곧 발행 시간순이 된다.
export const drivePathFor = (drive, filePath, pubDate) =>
  `${drive.replace(/\/+$/, '')}/${pubDate}-${basename(filePath)}`;

// ── 드라이브 정리 (2026-10-02 신설 · 사용자 승인 「셋 다 진행해」, 볼트 경유) ──────────────
// 📌 왜: 맨 위 칸에 파일 80 + 폴더 3 이 쌓여 있고 오늘 이후 발행분은 11개다. 폰에서 「오늘 올릴 것」을
//   80개 사이에서 고른다 — 2026-08-05 에 날짜 접두를 붙인 이유(16개 사이에서 못 골랐다)가 다시 생겼다.
// ▶ 규칙: 맨 위 칸에는 **오늘 이후 발행분만** 둔다.
//   · 발행일(파일명 앞 YYYY-MM-DD)이 어제 이전 → `_archive/YYYY-MM/` 로 **move** (⛔ 삭제 없음)
//   · 작업 폴더(이름이 `_` 로 시작하지 않는 폴더) → `_work/` 로 move
//   · 폴더명은 ASCII — check-schedule 이 lsf 출력과 문자열로 대조한다.
// ⛔⛔ 첫 실행은 **옮길 목록만 찍는 드라이런**이고, 사용자가 그 목록을 보고 확인한 뒤에 옮긴다(사용자에게 그렇게 약속했다).
//   그래서 업로드 끝에서 자동으로 옮기는 스위치는 **꺼진 채로 태어난다** — 확인 뒤 사람이 true 로 바꾼다.
// ⚠️ check-schedule 은 이제 `lsf -R` 로 하위 폴더까지 읽고 basename 으로 대조한다 — 안 그러면 옮긴 지난 회차가 「드라이브 없음」이 된다.
export const DRIVE_ARCHIVE_ON_UPLOAD = true;    // ✅ 2026-10-02 사용자 「옮겨」 — 드라이런 72건 확인 뒤 첫 실행(옮김 72 · 실패 0)하고 켰다

const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})-/;
export function planDriveArchive({ remote = 'gdrive:dhenddl-reels', rclone = 'rclone', today = new Date() } = {}) {
  const localConf = join(HERE, 'rclone.conf');
  const confArgs = existsSync(localConf) ? ['--config', localConf] : [];
  const r = spawnSync(rclone, [...confArgs, 'lsf', remote], { encoding: 'utf8', timeout: 90_000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) return { ok: false, why: `rclone lsf 실패 — ${String(r.stderr || '').split(String.fromCharCode(10))[0].slice(0, 120)}`, moves: [], keep: [] };
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const moves = [], keep = [];
  for (const raw of String(r.stdout).split(String.fromCharCode(10)).map((s) => s.trim()).filter(Boolean)) {
    const isDir = raw.endsWith('/');
    const name = isDir ? raw.slice(0, -1) : raw;
    if (name.startsWith('_')) { keep.push({ name, why: '정리 폴더' }); continue; }
    if (isDir) { moves.push({ from: name, to: `_work/${name}`, why: '작업 폴더' }); continue; }
    const m = name.match(DATE_PREFIX);
    if (!m) { keep.push({ name, why: '날짜 접두 없음 — 사람이 본다' }); continue; }
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (date < todayIso) moves.push({ from: name, to: `_archive/${m[1]}-${m[2]}/${name}`, why: `발행일 ${date} < 오늘 ${todayIso}` });
    else keep.push({ name, why: `발행일 ${date} ≥ 오늘` });
  }
  return { ok: true, why: '', moves, keep, todayIso };
}

// apply=false 면 목록만 돌려준다. apply=true 면 rclone moveto 로 하나씩 옮기고, 실패한 것은 멈추지 않고 모은다.
export function archiveDriveOld({ apply = false, remote = 'gdrive:dhenddl-reels', rclone = 'rclone', today = new Date() } = {}) {
  const plan = planDriveArchive({ remote, rclone, today });
  if (!plan.ok || !apply) return { ...plan, moved: [], failed: [] };
  const localConf = join(HERE, 'rclone.conf');
  const confArgs = existsSync(localConf) ? ['--config', localConf] : [];
  const moved = [], failed = [];
  const base = remote.replace(/\/+$/, '');
  for (const mv of plan.moves) {
    const r = spawnSync(rclone, [...confArgs, 'moveto', `${base}/${mv.from}`, `${base}/${mv.to}`], { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status === 0) moved.push(mv);
    else failed.push({ ...mv, err: String(r.stderr || '').split(String.fromCharCode(10))[0].slice(0, 120) });
  }
  return { ...plan, moved, failed };
}

export function printDrivePlan(res, { apply = false } = {}) {
  if (!res.ok) { console.log(`⚠️ 드라이브 정리 — ${res.why}`); return; }
  console.log(`드라이브 정리 ${apply ? '(실행)' : '(드라이런 — 옮기지 않았다)'} · 오늘 ${res.todayIso} · 옮길 것 ${res.moves.length} · 둘 것 ${res.keep.length}`);
  for (const mv of res.moves) console.log(`   ${apply ? '→' : '·'} ${mv.from}  →  ${mv.to}   (${mv.why})`);
  if (res.keep.length) console.log(`   둠: ${res.keep.map((k) => k.name).join(' · ')}`);
  if (apply) {
    console.log(`   옮김 ${res.moved.length} · 실패 ${res.failed.length}`);
    for (const f of res.failed) console.log(`   ⛔ ${f.from}: ${f.err}`);
  }
}

// ---------- 단독 CLI 실행 ----------
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = { manifest: null, slug: null, out: null, archive: false, apply: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--manifest') args.manifest = argv[++i];
    else if (argv[i] === '--slug') args.slug = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--archive') args.archive = true;   // 드라이브 정리 — 기본은 드라이런
    else if (argv[i] === '--apply') args.apply = true;       // --archive 와 함께일 때만 실제로 옮긴다
  }
  if (args.archive) {
    //   node reel-caption.mjs --archive            옮길 목록만 (드라이런)
    //   node reel-caption.mjs --archive --apply    실제로 옮긴다 (사용자가 목록을 확인한 뒤)
    const res = archiveDriveOld({ apply: args.apply });
    printDrivePlan(res, { apply: args.apply });
    process.exit(res.ok && (!args.apply || res.failed.length === 0) ? 0 : 1);
  }
  if (!args.out) throw new Error('사용법: node reel-caption.mjs --slug <슬러그> --out <txt경로> [--manifest <post.json 경로>]  |  --archive [--apply]');
  const manifestPath = args.manifest ? resolve(HERE, args.manifest) : findManifest(args.slug);
  if (!manifestPath) throw new Error(`매니페스트를 못 찾음 — --manifest 직접 지정하거나 --slug 확인 (post-${args.slug}.json)`);
  const caption = writeReelCaption(manifestPath, resolve(HERE, args.out));
  console.log(`릴스 캡션 저장: ${args.out}\n---\n${caption}`);
}
