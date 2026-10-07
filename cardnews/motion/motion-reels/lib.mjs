// lib.mjs — render-cuts.mjs(컷 덮기·끼우기) 와 render-full.mjs(훅 뒤 전체 모션) 가 같이 쓰는 검사·렌더 한 벌.
// ⛔ 두 렌더러가 검사를 각자 들고 있으면 한쪽만 고쳐진다 — 글자 출처·구역·대비·읽을 시간은 여기에만 있다.
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadTheme, assertFontsResolve } from '../../palette.mjs';
import { 글자안전, 검사글자, 환산, 측정 } from '../../safe-zone.mjs';

export const HERE = dirname(fileURLToPath(import.meta.url));
export { ffmpegPath };
export const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// ── 장면 타입별 「화면에 쓰는 글자 필드」 ─────────────────────────────────────
export const FIELDS = {
  numberPunch: (c) => [...(c.caption ? [c.caption] : []), c.a.label, c.a.value, ...(c.b ? [c.b.label, c.b.value] : []), ...(c.notes || [])],
  contrastCounter: (c) => [...(c.title ? [c.title] : []), ...c.rows.flatMap((r) => [r.label, String(r.value)]), ...(c.foot ? [c.foot] : [])],
  kinetic: (c) => [...c.words],
  glitchEquation: (c) => [c.caption, c.eq, c.reveal, ...(c.note ? [c.note] : [])],
  setSplit: (c) => [c.caption, c.sub, c.eq],
  command: (c) => [c.cmd, c.result],
  timeline: (c) => [c.from.label, c.from.date, c.to.label, c.to.date],
  strike: (c) => [...c.words],
  stamp: (c) => [c.a, ...(c.b ? [c.b] : [])],
  verdict: (c) => [c.a, c.b, c.hi],
  limits: (c) => [c.head, ...c.items],
  // 사전 10종 (2026-09-30 시험판 · cuts.html 「사전 10종」 절)
  termCard: (c) => [c.term, ...(c.full ? [c.full] : []), c.mean],
  flowDiagram: (c) => [...c.steps],
  quizOX: (c) => [c.q, c.exp],
  chatUI: (c) => [c.q, ...c.answers],
  spotlight: (c) => [...c.rows, c.label],
  innerThought: (c) => [c.text],
  speedLines: (c) => [c.text, ...(c.sub ? [c.sub] : [])],
  beforeAfter: (c) => [c.before.label, String(c.before.value), c.after.label, String(c.after.value)],
  progressBar: (c) => [...c.chapters],
  faqFlip: (c) => c.cards.flatMap((x) => [x.q, x.a]),
};

// ── 글자 출처: 선호 줄 → 대본 전체 → 레시피. 낱말 단위 일치를 먼저, 없을 때만 부분 문자열 ──
const RECIPE_FIELDS = ['hookBadge', 'hookText', 'hookSub', 'outro', 'title', 'cmd'];
export function loadSources(spec, JD) {
  const scriptLines = readFileSync(resolve(JD, spec.script), 'utf8').split(/\r?\n/);
  const raw = JSON.parse(readFileSync(resolve(JD, spec.recipes), 'utf8'));
  const list = (Array.isArray(raw) ? raw : (raw.recipes || Object.values(raw))).flat();
  const recipe = list.find((r) => r && r.slug === spec.slug);
  if (!recipe) throw new Error(`레시피에 slug ${spec.slug} 가 없다`);
  function sourceOf(str, prefer = []) {
    const s = norm(str); const cands = [];
    for (const p of [].concat(prefer || [])) {
      if (typeof p === 'number') cands.push([`대본 ${p}줄`, scriptLines[p - 1] ?? '']);
      else if (recipe[p]) cands.push([`레시피 ${p}`, recipe[p]]);
    }
    scriptLines.forEach((l, i) => cands.push([`대본 ${i + 1}줄`, l]));
    for (const f of RECIPE_FIELDS) if (recipe[f]) cands.push([`레시피 ${f}`, recipe[f]]);
    for (const [name, l] of cands) if (` ${norm(l)} `.includes(` ${s} `)) return `${name} 「${norm(l)}」`;
    for (const [name, l] of cands) if (norm(l).includes(s)) return `${name} 「${norm(l)}」 (부분 일치)`;
    return null;
  }
  return { sourceOf, recipe, scriptLines };
}
// ── 모양 옵션: 개수·분포처럼 「대본에 없는 것을 그림으로 암시」할 수 있는 옵션 ──────────────
// 기본은 끔(0/없음). 켜면 출처 필드가 필수이고, 그 출처 글에 그 숫자가 낱자리로 있어야 한다.
export const SHAPE_OPTS = {
  timeline: [['marks', 'marksSource']],     // 두 날짜 사이 표시 개수 — 대본에 날짜별 분포가 없으면 켜지 않는다
  setSplit: [['n', 'nSource'], ['apart', 'apartSource']],   // 묶음 점 개수 · 어긋난 점 개수
};
export function checkShapes(items, { scriptLines, recipe }) {
  const rows = [], bad = [];
  for (const it of items) for (const [opt, srcKey] of SHAPE_OPTS[it.c.type] || []) {
    const v = it.c[opt]; if (!(v > 0)) { rows.push(`  ${it.label} ${it.c.type}.${opt} = 끔`); continue; }
    const src = it.c[srcKey]; let text = null;
    const m1 = /^대본 (\d+)줄$/.exec(src || ''), m2 = /^레시피 (\S+)$/.exec(src || '');
    if (m1) text = scriptLines[+m1[1] - 1]; else if (m2) text = recipe[m2[1]];
    const ok = text != null && new RegExp(`(^|[^0-9])${v}([^0-9]|$)`).test(norm(text));
    rows.push(`  ${it.label} ${it.c.type}.${opt} = ${v} ← ${src || '(출처 없음)'} ${ok ? '✅' : '⛔'}`);
    if (!ok) bad.push(`${it.label} ${it.c.type}.${opt}=${v}: ${srcKey} ${src ? `「${src}」 에 ${v} 가 없다` : '가 없다 — 켜려면 출처를 적는다'}`);
  }
  console.log('\n모양 옵션 (개수·분포 암시 · 기본 끔)'); for (const r of rows) console.log(r);
  if (bad.length) { for (const b of bad) console.error('⛔ ' + b); process.exit(1); }
}
// items: [{ key, label, c, prefer }]  → provenance 배열 (없으면 throw)
export function provenanceOf(items, sourceOf) {
  const rows = []; const miss = [];
  for (const it of items) {
    if (!FIELDS[it.c.type]) { miss.push(`${it.label}: 모르는 타입 ${it.c.type}`); continue; }
    for (const s of FIELDS[it.c.type](it.c)) {
      const src = sourceOf(s, it.prefer); rows.push({ key: it.key, label: it.label, type: it.c.type, str: s, src });
      if (!src) miss.push(`${it.label} (${it.c.type}): 「${s}」 가 대본·레시피에 없다`);
    }
  }
  if (miss.length) { for (const m of miss) console.error('⛔ ' + m); process.exit(1); }
  return rows;
}

// ── 글자 구역 ────────────────────────────────────────────────────────────────
// 왼쪽 여백 76 은 safe-zone 값이 아니라 구도값이다 — make-termcast.mjs #sub 의 좌우 padding 과 맞췄다.
const LEFT_1080 = 76;
export function makeZone(W, H) {
  if (W * 16 === H * 9) {
    const s = 글자안전(W, H);
    // 위쪽 구역: 버튼 열은 프레임 y (시작y − 여유) 아래에만 있다(safe-zone 측정). 그 위에서는 오른쪽 끝이 프레임 오른쪽 여백까지다.
    //   ⛔ 값은 safe-zone.mjs 측정에서만 온다 — 오른쪽 여백 76 은 검사글자(세로반영) 안의 값과 같은 구도값이다.
    const upper = { x0: 환산(LEFT_1080, W), y0: s.상단, x1: W - 환산(LEFT_1080, W), y1: 환산(측정.우측버튼열_시작y - 측정.우측버튼열_여유, W) };
    return { reels: true, x0: 환산(LEFT_1080, W), y0: s.상단, x1: s.우측임계, y1: s.하단임계, upper, 근거: 'safe-zone.mjs 글자안전()' };
  }
  const m = 환산(LEFT_1080, W);   // 캐러셀 슬라이드엔 릴스 UI 가 없다 — 사방 같은 여백
  return { reels: false, x0: m, y0: m, x1: W - m, y1: H - m, 근거: '릴스 UI 없음 · 사방 구도 여백' };
}

// ── WCAG 2.x 대비 ────────────────────────────────────────────────────────────
function lum(hex) { const h = hex.replace('#', ''); const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const CONTRAST_MIN = 4.5;   // WCAG AA 본문 기준 — 큰 글자(3.0) 예외를 쓰지 않고 전부 본문 기준으로 본다

// ── 프레임 검사기: 구역 · 대비 · 그려진 글자 · 보인 시간 ─────────────────────
export function makeChecker({ W, H, zone }) {
  const drawn = new Map(), contrastSeen = new Map(), zoneFails = [], vis = new Map();
  // info = setCut 이 돌려준 장면 구역 (center 면 세로반영 검사 · 위쪽 구역이면 그 경계로 본다)
  function check(boxes, key, label, f, info) {
    const seenThisFrame = new Set(); const zz = info && info.zone ? info.zone : zone, 세로 = !!(info && info.center);
    for (const b of boxes) {
      drawn.set(`${key}|${b.str}`, (drawn.get(`${key}|${b.str}`) || 0) + 1);
      if (!b.decor) { const k = `${label} 「${b.str}」 ${b.fg} on ${b.on}`; if (!contrastSeen.has(k)) contrastSeen.set(k, { v: contrast(b.fg, b.on), key, str: b.str }); }
      if (zone.reels) for (const w of 검사글자({ y: b.y0, 바닥: b.y1, 우측끝: b.x1, w: W, h: H, 세로반영: 세로 })) zoneFails.push(`${label} f${f} 「${b.str}」 ${w}`);
      const xMax = info && info.perLine ? (b.y1 <= info.perLine.yU + 0.5 ? zz.x1 : info.perLine.xR) : zz.x1;   // 줄마다: 버튼 열 위 줄만 오른쪽 끝까지
      if (b.x0 < zz.x0 - 0.5 || b.x1 > xMax + 0.5 || b.y0 < zz.y0 - 0.5 || b.y1 > zz.y1 + 0.5) zoneFails.push(`${label} f${f} 「${b.str}」 구역 밖 (${b.x0.toFixed(0)},${b.y0.toFixed(0)})–(${b.x1.toFixed(0)},${b.y1.toFixed(0)})`);
      // 「읽을 수 있게 보였다」 = 불투명도 0.9 이상 · 마스크에 90% 이상 드러남 (장식 사본 제외)
      if (!b.decor && (b.alpha ?? 1) >= 0.9 && (b.shown ?? 1) >= 0.9) seenThisFrame.add(`${key}|${b.str}`);
    }
    for (const k of seenThisFrame) vis.set(k, (vis.get(k) || 0) + 1);
  }
  return { check, drawn, contrastSeen, zoneFails, vis };
}

// ── 페이지 · 클립 ────────────────────────────────────────────────────────────
export async function openPage({ W, H, FPS, zone, ground, layout = 'center', marks = 'edge', fillBottom = false, timing = null }) {
  const { palette, fonts } = loadTheme({});
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errs = []; page.on('pageerror', (e) => { errs.push(e.message); console.error('PAGE ERROR:', e.message); });
  await page.goto(pathToFileURL(join(HERE, 'cuts.html')).href, { waitUntil: 'load' });
  await assertFontsResolve(page, fonts);   // 스택 첫 글꼴이 실제로 안 그려지면(대체로 빠지면) 렌더 전에 멈춘다 (2026-10-07 · palette.mjs 참고)
  await page.evaluate((cfg) => window.setup(cfg), { W, H, palette, fonts, fps: FPS, zone, zoneUpper: zone.upper || null, ground, layout, marks, fillBottom, timing });
  return { browser, page, errs, palette };
}
// 한 장면을 n 프레임 렌더해 mp4 로. onFrame(boxes, f) 로 검사를 돌린다. stillPath 가 있으면 중간 프레임 PNG
export async function renderClip(page, c, { FPS, n, out, stillPath, onFrame }) {
  const info = await page.evaluate((cc) => window.setCut(cc), c);
  const mid = Math.floor(n / 2);
  const ff = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '10', '-pix_fmt', 'yuv420p', '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'pipe'] });
  let err = ''; ff.stderr.on('data', (d) => { err += d; });
  for (let f = 0; f < n; f++) {
    const boxes = await page.evaluate((tt) => window.frame(tt), f / FPS);
    onFrame(boxes, f, info);
    const buf = await page.screenshot({ type: 'png' });
    if (stillPath && f === mid) await page.screenshot({ path: stillPath });
    if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
  }
  ff.stdin.end(); const [code] = await once(ff, 'close');
  if (code !== 0) throw new Error(`클립 인코딩 실패 (${out}): ${err.slice(-800)}`);
  return info;
}
export async function renderStill(page, c, { FPS, n, path, onFrame, at = 'mid' }) {
  const info = await page.evaluate((cc) => window.setCut(cc), c);
  const mid = at === 'end' ? n - 1 : Math.floor(n / 2);   // end = 장면 마지막 프레임(요소가 다 뜬 상태)
  const boxes = await page.evaluate((tt) => window.frame(tt), mid / FPS);
  onFrame(boxes, mid, info); await page.screenshot({ path });
  return info;
}

// ── 사후 판정: 선언 안 된 글자 · 구역 · 대비 ─────────────────────────────────
// 그려진 글자는 ① 선언된 글자 ② 선언된 글자의 일부(타이핑 중 앞부분 · 줄바꿈 조각) ③ 카운터 중간값 만 허용
export function finalChecks({ provenance, items, chk, errs }) {
  const decl = new Map(); for (const p of provenance) { const pk = String(p.key); if (!decl.has(pk)) decl.set(pk, []); decl.get(pk).push(norm(p.str)); }
  const stray = [];
  for (const k of chk.drawn.keys()) {
    const i = k.indexOf('|'), key = k.slice(0, i), str = norm(k.slice(i + 1)); const ds = decl.get(key) || [];
    if (ds.includes(str) || ds.some((d) => d.includes(str))) continue;
    const it = items.find((x) => String(x.key) === key);
    if (it && it.c.type === 'contrastCounter' && /^\d+$/.test(str) && +str <= Math.max(...it.c.rows.map((r) => r.value))) continue;
    stray.push(`${it ? it.label : key} 「${str}」`);
  }
  if (stray.length) { console.error('⛔ 선언 안 된 글자가 그려졌다:', stray.join(' · ')); process.exit(1); }
  if (chk.zoneFails.length) {
    const per = {}; for (const s of chk.zoneFails) { const k = s.split(' ')[0]; per[k] = (per[k] || 0) + 1; }
    console.error(`⛔ 글자 구역 위반 ${chk.zoneFails.length}건 · ${Object.entries(per).map(([k, v]) => `${k} ${v}건`).join(' · ')}:\n  ` + chk.zoneFails.slice(0, 12).join('\n  '));
    process.exit(1);
  }
  if (errs.length) process.exit(1);
  console.log('\n글자 대비 (WCAG · 밑색 = 바탕 또는 칩)');
  const declSet = new Set(provenance.map((p) => `${p.key}|${norm(p.str)}`)); const low = [];
  for (const [k, o] of chk.contrastSeen) { if (declSet.has(`${o.key}|${norm(o.str)}`)) console.log(`  ${o.v.toFixed(2).padStart(5)}:1  ${k}`); if (o.v < CONTRAST_MIN) low.push(k); }
  if (low.length) { console.error(`⛔ 대비 ${CONTRAST_MIN}:1 미만 ${low.length}건:\n  ` + low.join('\n  ')); process.exit(1); }
}
