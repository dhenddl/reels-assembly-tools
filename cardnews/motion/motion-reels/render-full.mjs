// render-full.mjs — 장면 JSON → 「원본 훅 + 대본 전체 모션 장면 + 원본 CTA」 릴스 (V-E · 말이 있으면 V-F)
//   장면 JSON 에 voice 블록이 있으면: 말 절에 맞춰 장면 길이를 정하고(voice.mjs), 효과음·말을 섞어 loudnorm 한다.
//
//   node render-full.mjs --scenes reels-rule-silent.fullmotion.json            # 전체 렌더 + 합성
//   node render-full.mjs --scenes ... --stills                                  # 장면마다 중간 프레임 PNG 만
//
// 검사는 render-cuts.mjs 와 같은 lib.mjs 한 벌 (글자 출처 · safe-zone 구역 · WCAG 대비 · 선언 안 된 글자) 에
// **읽을 시간** 을 더한다 — 선언된 글자마다 「불투명도 ≥0.9 · 마스크에 ≥90% 드러남」 프레임이 minRead 초 이상이어야 한다.
// ⛔ 기반 영상은 읽기만 한다. 훅·CTA 는 원본 프레임을 trim 으로 잘라 붙인다(다시 그리지 않는다).
//   ✏️ 예외 하나(2026-10-13): 장면 JSON `hook.motion: true` 면 훅 구간만 hook-motion.mjs 가 다시 그린다 —
//      같은 카드(문구·바탕·배치 그대로)에 0초부터 등장 움직임만 더한 판. 길이는 hook.from/to 그대로. 근거·대조는 그 파일 머리말.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { loadTheme } from '../../palette.mjs';
import { dirname, join, resolve } from 'node:path';
import { loadVoice, ensureVoice, applyTiming, mapping, buildAudio, measureLoudness, cueSec } from './voice.mjs';
import { HERE, ffmpegPath, norm, loadSources, provenanceOf, checkShapes, makeZone, makeChecker, openPage, renderClip, renderStill, finalChecks, printTypo } from './lib.mjs';
import { renderHookMotion, loadRecipe, firstFrameInkPct, SETTLE as HOOK_SETTLE } from './hook-motion.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);
const SPEC = resolve(HERE, arg('scenes', 'reels-rule-silent.fullmotion.json'));
const spec = JSON.parse(readFileSync(SPEC, 'utf8')); const JD = dirname(SPEC);
const W = parseInt(arg('w', '1080'), 10), H = parseInt(arg('h', '1920'), 10);
const FPS = spec.fps || 24, STILLS = has('stills'), MIN_READ = spec.minRead ?? 0.6, STILL_AT = arg('at', 'mid');

// ── 1) 바탕 배정 ─────────────────────────────────────────────────────────────
const gr = spec.groundRule || { rule: 'alternate', first: 'accent' };
const other = (g) => (g === 'accent' ? 'dark' : 'accent');
spec.scenes.forEach((c, i) => { if (!c.ground) c.ground = gr.rule === 'alternate' ? (i % 2 === 0 ? gr.first : other(gr.first)) : (gr.first || 'dark'); });
const seq = [spec.hook.ground || 'dark', ...spec.scenes.map((c) => c.ground), spec.cta.ground || 'dark'];
const flat = []; for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) flat.push(i);
if (flat.length) console.warn(`⚠️ 같은 바탕이 이웃한 경계 ${flat.length}곳 — 하드컷으로 안 잡힌다: ${flat.map((i) => `경계${i}`).join(' ')}`);

// ── 1-1) 명령 한 줄 (2026-10-06 사용자 「코드를 한 줄로 만든다」) ─────────────────
//   기반 영상(훅·CTA 프레임을 떼어 오는 원본)이 없으면 render-reels.mjs 로 만든다 — 레시피(hookText 등)·대본에서 나온다.
//   말 mp3·어절 경계가 없거나 어긋나면 tts-words.py 로 받는다(ensureVoice). 둘 다 있으면 아무것도 안 한다.
//   📌 그전엔 render-reels → tts-words ×2 → render-full 네 번을 손으로 쳤다. 10/12 릴스 훅이 「명령 한 줄로 조립했어요」다.
const BASE = resolve(JD, spec.base);
if (!STILLS && !existsSync(BASE)) {
  const CARDNEWS = resolve(HERE, '..', '..');
  console.log(`기반 영상 없음 → render-reels.mjs ${spec.slug} 로 만든다`);
  const r = spawnSync(process.execPath, [join(CARDNEWS, 'render-reels.mjs'), spec.slug], { stdio: 'inherit', cwd: CARDNEWS });
  if (r.status !== 0 || !existsSync(BASE)) { console.error(`⛔ 기반 영상을 못 만들었다(exit ${r.status}): ${BASE}`); process.exit(1); }
}
if (spec.voice) ensureVoice(spec, JD, HERE);
if (!spec.voice && spec.scenes.some((c) => c.keepAudio)) { console.error('⛔ keepAudio 는 voice 블록이 있는 판(V-F)에서만 쓴다 — 소리 믹스가 거기 있다'); process.exit(1); }

// ── 1-2) 말 (있으면) — 절에 맞춰 장면 길이 · 장면 안 큐를 정한다 ───────────────
const V = spec.voice ? loadVoice(spec, JD) : null;
if (V) {
  applyTiming(spec, V, FPS);
  console.log(`말: ${V.main.voice} ${V.main.rate} · ${V.main.dur.toFixed(3)}s · 절 ${V.main.clauses.length}개${V.cta ? ` · CTA 말 ${V.cta.dur.toFixed(3)}s` : ''} · aiVoice=${spec.voice.aiVoice === true}`);
  if (spec.voice.aiVoice !== true) { console.error('⛔ 합성 음성 판은 voice.aiVoice: true 를 적는다 (AI 라벨 대상)'); process.exit(1); }
}

// ── 1-3) 막대 데이터 (bars · 2026-10-13) ────────────────────────────────────────
//   막대는 개수·분포를 그림으로 보여 준다 → 높이를 장면 JSON 에 손으로 적지 않는다. valuesFrom 파일에서 채우고,
//   표시(marks)의 값 글자가 그 날짜 막대의 데이터와 글자까지 같은지 본다 — 다르면 멈춘다.
for (const [i, c] of spec.scenes.entries()) {
  if (c.type !== 'bars') continue;
  const tag = `장면${String(i + 1).padStart(2, '0')} bars`;
  if (!c.valuesFrom) { console.error(`⛔ ${tag}: valuesFrom(데이터 파일)이 없다`); process.exit(1); }
  if (c.values) { console.error(`⛔ ${tag}: values 를 장면 JSON 에 직접 적지 않는다 — valuesFrom 에서 채운다`); process.exit(1); }
  const D = JSON.parse(readFileSync(resolve(JD, c.valuesFrom), 'utf8')), rows = D.bars || [], key = c.valueKey || 'views';
  c.values = rows.map((r) => r[key]);
  if (!rows.length || c.values.some((x) => typeof x !== 'number')) { console.error(`⛔ ${tag}: ${c.valuesFrom} 의 bars[].${key} 가 숫자가 아니다`); process.exit(1); }
  for (const m of c.marks || []) {
    const k = rows.findIndex((r) => String(r.publishedKst).startsWith(m.at));
    if (!m.at || k < 0) { console.error(`⛔ ${tag}: 표시 「${m.label}」 의 at(${m.at}) 에 맞는 막대가 없다`); process.exit(1); }
    m.i = k;
    if (m.value != null && String(m.value) !== String(c.values[k])) { console.error(`⛔ ${tag}: 표시 값 「${m.value}」 ≠ 데이터 ${m.at} ${c.values[k]}`); process.exit(1); }
  }
  console.log(`막대: ${c.valuesFrom} · ${rows.length}개 · ${key} 최소 ${Math.min(...c.values)} · 최대 ${Math.max(...c.values)} · 표시 ${(c.marks || []).map((m) => `${m.at}(${m.label}${m.value != null ? ' ' + m.value : ''})`).join(' · ')}`);
}

// ── 2) 글자 출처 ─────────────────────────────────────────────────────────────
const srcs = loadSources(spec, JD); const { sourceOf } = srcs;
const items = spec.scenes.map((c, i) => ({ key: i + 1, label: `장면${String(i + 1).padStart(2, '0')}`, c, prefer: c.lines }));
const provenance = provenanceOf(items, sourceOf);
console.log('화면 글자 출처');
for (const p of provenance) console.log(`  ${p.label} ${p.type.padEnd(16)} 「${p.str}」  ← ${p.src}`);
checkShapes(items, srcs);

// ── 3) 장면 렌더 ─────────────────────────────────────────────────────────────
// 영상 칸(clipFrame · 2026-10-13): src 의 from–to 초를 FPS 로 맞춰 box 크기로 늘리고, 짧으면 마지막 프레임을 장면 끝까지 붙잡는다.
//   ⛔ 영상 안 그림은 글자 게이트 밖이다 — 그 파일이 곧 실측 원본이다(출처 = src · 장면표에 찍는다). 라벨만 게이트를 지난다.
//   ⛔ 원본 영상은 읽기만 한다. 소리는 쓰지 않는다(이 판의 소리는 말·효과음 믹스가 정한다).
function overlayVideo(c, sceneMp4, n) {
  const src = resolve(JD, c.src);
  if (!existsSync(src)) { console.error(`⛔ 영상 칸 원본이 없다: ${src}`); process.exit(1); }
  const b = c.box; if (!b || [b.x, b.y, b.w, b.h].some((v) => !Number.isInteger(v) || v % 2)) { console.error('⛔ clipFrame.box 는 짝수 정수 x·y·w·h (yuv420p 색차 정렬)'); process.exit(1); }
  const from = c.from ?? 0, to = c.to ?? null, cr = c.crop;   // crop = 원본 px {x,y,w,h} — 원본의 빈 바탕을 잘라 낸다(실측 근거는 장면 JSON _crop)
  const vf = `[1:v]trim=start=${from}${to != null ? `:end=${to}` : ''},setpts=PTS-STARTPTS,fps=${FPS},${cr ? `crop=${cr.w}:${cr.h}:${cr.x}:${cr.y},` : ''}scale=${b.w}:${b.h}:flags=lanczos,format=yuv420p,setsar=1,tpad=stop_mode=clone:stop=${n}[v];`
    + `[0:v]format=yuv420p,setsar=1[bg];[bg][v]overlay=${b.x}:${b.y}:eof_action=repeat,trim=end_frame=${n},setpts=PTS-STARTPTS[o]`;
  const outp = sceneMp4.replace(/\.mp4$/, '-video.mp4');
  const r = spawnSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', sceneMp4, '-i', src, '-filter_complex', vf, '-map', '[o]', '-an',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(FPS), outp], { stdio: 'pipe' });
  if (r.status !== 0) { console.error('⛔ 영상 칸 합성 실패:', r.stderr?.toString().slice(-1200)); process.exit(1); }
  console.log(`  영상 칸: ${c.src} ${from}–${to ?? '끝'}s → box ${b.x},${b.y} ${b.w}×${b.h} · ${n}프레임(짧으면 끝 프레임 정지)`);
  return outp;
}
const zone = makeZone(W, H);
console.log(`\n${W}×${H} · ${FPS}fps · 글자 구역 x ${zone.x0}–${zone.x1} · y ${zone.y0}–${zone.y1} (${zone.근거}) · 바탕 ${gr.rule}(${gr.first} 먼저)`);
const t0 = Date.now();
const LAYOUT = arg('layout', spec.layout || 'center');   // 10/12 기본 center · V-E 는 JSON 에 left 로 고정
console.log(`구도 layout = ${LAYOUT}`);
const MARKS = arg('marks', spec.marks || 'edge');   // edge(기본 · 2026-09-29 사용자 결정) | none(후보) | scene(V-D·V-E 호환)
const FILL_BOTTOM = has('fill-bottom') || spec.fillBottom === true;   // 1270–1920 옅은 장식 (기본 끔)
if (!['scene', 'edge', 'none'].includes(MARKS)) { console.error(`⛔ --marks 는 scene|edge|none (지금 ${MARKS})`); process.exit(1); }
console.log(`표시 marks = ${MARKS} · fillBottom = ${FILL_BOTTOM} · 박자 timing = ${spec.timing || (LAYOUT === 'center' ? 'hold(기본)' : 'scale(기본)')}`);
const { browser, page, errs } = await openPage({ W, H, FPS, zone, ground: 'dark', layout: LAYOUT, marks: MARKS, fillBottom: FILL_BOTTOM, timing: spec.timing || null });
const layoutRows = [], zoneDecisions = [];
const chk = makeChecker({ W, H, zone });
const STILL_DIR = join(HERE, 'stills'); mkdirSync(STILL_DIR, { recursive: true });
const CLIP_DIR = join(HERE, 'clips'); mkdirSync(CLIP_DIR, { recursive: true });
const clips = [];
// 장면형 최소 길이 — README 「장면형 고르기」 표 (2026-09-30 장면당 2초 시험에서 읽을 시간 게이트로 잰 값). 경고만 — 차단은 읽을 시간 게이트가 한다.
//   렌더에 몇 분 쓰기 전에 알려주려는 것이다.
const MIN_DUR = { chatUI: 2.5, spotlight: 3.9, faqFlip: (c) => c.cards.length * 1.0, speedLines: 1.0 };
for (const it of items) { const m = MIN_DUR[it.c.type], need = typeof m === 'function' ? m(it.c) : m;
  if (need && it.c.dur + 1e-9 < need) console.warn(`⚠️ ${it.label} ${it.c.type} ${it.c.dur.toFixed(2)}s < 권장 최소 ${need}s — 읽을 시간 게이트에 걸릴 수 있다 (README 「장면형 고르기」)`); }
for (const it of items) {
  const c = it.c, n = Math.round(c.dur * FPS);
  const tag = `${W}x${H}-${spec.clipTag || 'full'}-${String(it.key).padStart(2, '0')}-${c.type}-${c.ground}${MARKS === 'scene' ? '' : '-' + MARKS}${FILL_BOTTOM ? '-fb' : ''}`;
  const onFrame = (boxes, f, info) => chk.check(boxes, it.key, it.label, f, info);
  if (STILLS) {
    const p = join(STILL_DIR, `${tag}-${LAYOUT}-${STILL_AT}.png`); let bx = [];
    const zi = await renderStill(page, c, { FPS, n, path: p, at: STILL_AT, onFrame: (boxes, f, info) => { bx = boxes.filter((b) => !b.decor); onFrame(boxes, f, info); } }); const alt = LAYOUT === 'center' ? await page.evaluate((cc) => { const r = window.probeFullAlt(cc); window.setCut(cc); return r; }, c) : null; zoneDecisions.push({ scene: it.label, type: c.type, ...zi, altFull: alt });
    const ic = await page.evaluate(() => window.inkCentroid());
    const u = bx.length ? { x0: Math.min(...bx.map((b) => b.x0)), x1: Math.max(...bx.map((b) => b.x1)), y0: Math.min(...bx.map((b) => b.y0)), y1: Math.max(...bx.map((b) => b.y1)) } : null;
    layoutRows.push({ scene: it.label, type: c.type, text: u ? { cx: (u.x0 + u.x1) / 2, cy: (u.y0 + u.y1) / 2 } : null, ink: ic });
    console.log(`  still ${p}`); continue;
  }
  const out = join(CLIP_DIR, `${spec.slug}-${tag}.mp4`);
  const zi = await renderClip(page, c, { FPS, n, out, stillPath: join(STILL_DIR, `${tag}-mid.png`), onFrame }); zoneDecisions.push({ scene: it.label, type: c.type, ...zi });
  let path = out;
  if (c.type === 'clipFrame') path = overlayVideo(c, out, n);   // 영상 칸: 렌더한 바탕·라벨 위 box 자리에 원본 영상을 얹는다
  clips.push({ path, n, key: it.key, type: c.type, ground: c.ground, lines: c.lines, src: c.src });
}
await browser.close();
if (LAYOUT === 'center') {
  console.log('\n장면 구역 (center · 세로반영)');
  for (const z of zoneDecisions) console.log(`  ${z.scene} ${z.type.padEnd(16)} ${z.mode === 'fixed' ? `고정(영상 칸 · box) · 줄마다 규칙 x ${z.zone.x0}–${z.zone.x1}` : z.mode === 'fill' ? `채움 · 배율 ${z.scale} · 블록 높이 ${z.blockH} · 블록 중심 y ${z.target}${z.altFull ? ` · [비교] 예전 구역·배율1 중심 (${z.altFull.cx}, ${z.altFull.cyRule})` : ''}` : z.mode === 'upper' ? `위쪽 구역 x ${z.zone.x0}–${z.zone.x1} · y ${z.zone.y0}–${z.zone.y1} · 글자 배율 ${z.scale} · 블록 높이 ${z.blockH} → 목표 중심 y ${z.target}${z.shifted ? '' : ' (못 옮김)'}${z.altFull ? ` · [비교] 예전 구역·배율1 이면 높이 ${z.altFull.h} · 중심 (${z.altFull.cx}, ${z.altFull.cyRule})` : ''}` : `⚠️ 예전 구역으로 되돌림 x ${z.zone.x0}–${z.zone.x1} (시도: ${(z.tried || []).map((t) => `배율 ${t.fs} 바닥 ${t.bottom}`).join(' · ')})`}`);
}
finalChecks({ provenance, items, chk, errs });
console.log(`\n글자 구역 검사: 통과 (${STILLS ? '중간 프레임' : '전 프레임'} · 그려진 글자 ${chk.drawn.size}종)`);
printTypo(chk, { stills: STILLS });
if (STILLS) {
  console.log(`\n구도 계측 (${LAYOUT} · 장면 ${STILL_AT === 'end' ? '마지막' : '중간'} 프레임) — 글자 구역 중심 (${((zone.x0 + zone.x1) / 2).toFixed(0)}, ${((zone.y0 + zone.y1) / 2).toFixed(0)})${zone.upper ? ` · 위쪽 구역 중심 (${((zone.upper.x0 + zone.upper.x1) / 2).toFixed(0)}, ${((zone.upper.y0 + zone.upper.y1) / 2).toFixed(0)})` : ''} · 프레임 중심 x ${W / 2}`);
  for (const r of layoutRows) console.log(`  ${r.scene} ${r.type.padEnd(16)} 글자 블록 중심 (${r.text ? r.text.cx.toFixed(0) + ', ' + r.text.cy.toFixed(0) : '—'})  잉크 무게중심 (${r.ink ? r.ink.x.toFixed(0) + ', ' + r.ink.y.toFixed(0) : '—'})`);
  writeFileSync(join(HERE, `layout-${spec.clipTag || 'full'}-${LAYOUT}-${STILL_AT}.json`), JSON.stringify({ layout: LAYOUT, zoneCenter: [(zone.x0 + zone.x1) / 2, (zone.y0 + zone.y1) / 2], frameCenterX: W / 2, rows: layoutRows }, null, 1));
  console.log(`렌더 ${((Date.now() - t0) / 1000).toFixed(1)}s`); process.exit(0);
}

// ── 4) 읽을 시간 ─────────────────────────────────────────────────────────────
console.log(`\n읽을 시간 (완전히 보인 시간 · 기준 ${MIN_READ}s)`);
const short = [], readTimes = [];
for (const p of provenance) {
  const k = `${p.key}|${p.str}`;
  let fr = chk.vis.get(k) || 0, how = '';
  if (!fr) {   // 줄바꿈 등으로 조각으로만 그려졌으면 **최대 조각**들 중 가장 짧은 값
    // ✏️ 2026-09-30: 예전엔 모든 조각의 최소였다 → 줄바꿈된 글을 타자로 치면 1프레임짜리 앞부분(「틀」「틀려」…)이 최소가 돼
    //    완성된 줄이 2초 보여도 0.04s 로 막았다. 다른 조각에 포함되는 조각(타자 중 앞부분 · 한 글자씩 번지는 글자)은 빼고,
    //    남은 최대 조각들이 **원문 전체를 덮는지**도 본다 — 안 덮으면(끝까지 다 안 그려졌으면) 0 으로 친다.
    const txt = (kk) => norm(kk.slice(kk.indexOf('|') + 1));
    const pieces = [...chk.vis.entries()].filter(([kk]) => kk.startsWith(`${p.key}|`) && norm(p.str).includes(txt(kk)) && kk !== k);
    const maxi = pieces.filter(([kk]) => !pieces.some(([o]) => o !== kk && txt(o).length > txt(kk).length && txt(o).includes(txt(kk))));
    let rest = norm(p.str).replace(/\s/g, ''); for (const [kk] of [...maxi].sort((a, b) => txt(b[0]).length - txt(a[0]).length)) rest = rest.replace(txt(kk).replace(/\s/g, ''), '');
    if (maxi.length && !rest) { fr = Math.min(...maxi.map(([, v]) => v)); how = ` (최대 조각 ${maxi.length}개 중 최소 · 전체 조각 ${pieces.length})`; }
    else if (pieces.length) { fr = 0; how = ` (조각이 원문을 다 덮지 못함 — 남은 글자 「${rest}」)`; }
  }
  const sec = fr / FPS; readTimes.push({ scene: p.label, str: p.str, sec: +sec.toFixed(3) }); console.log(`  ${sec.toFixed(2).padStart(5)}s  ${p.label} 「${p.str}」${how}`);
  if (sec + 1e-9 < MIN_READ) short.push(`${p.label} 「${p.str}」 ${sec.toFixed(2)}s`);
}
if (short.length) { console.error(`⛔ 읽을 시간 ${MIN_READ}s 미만 ${short.length}건:\n  ` + short.join('\n  ')); process.exit(1); }
const tClips = (Date.now() - t0) / 1000;

// ── 5) 합성: 원본 훅 → 장면들 → 원본 CTA · 무음 트랙 ─────────────────────────
const OUT = join(HERE, arg('out', spec.out || `${spec.slug}-fullmotion.mp4`));
if (!existsSync(BASE)) { console.error(`⛔ 기반 영상이 없다: ${BASE}`); process.exit(1); }
if (resolve(OUT) === BASE) { console.error('⛔ 출력이 기반 영상과 같은 경로다'); process.exit(1); }
const probe = (a) => spawnSync('ffprobe', ['-v', 'error', ...a, BASE], { encoding: 'utf8' }).stdout.trim();
const baseVDur = parseFloat(probe(['-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0']));
const baseADur = parseFloat(probe(['-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0']));
const vd = spawnSync(ffmpegPath, ['-hide_banner', '-i', BASE, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr || '';
const maxVol = parseFloat((vd.match(/max_volume:\s*(-?[0-9.]+)/) || [])[1]);
if (maxVol > -90) console.warn(`⚠️ 원본 오디오가 무음이 아니다(max ${maxVol} dB) — 이 판은 무음 트랙으로 채운다`);
const hookN = spec.hook.to - spec.hook.from + 1;
// 훅 모션(2026-10-13): 기반 영상 trim 대신 같은 카드를 움직임과 함께 다시 그린 클립을 쓴다
let HOOKCLIP = null;
if (spec.hook.motion) {
  const recipe = loadRecipe(resolve(JD, spec.recipes), spec.slug);
  HOOKCLIP = join(HERE, 'clips', `${spec.clipTag || spec.slug}-hook-motion.mp4`);
  const hm = await renderHookMotion({ recipe, fps: FPS, n: hookN, out: HOOKCLIP });
  const ink = firstFrameInkPct(HOOKCLIP);
  console.log(`훅 모션: ${hookN}프레임 · 움직임 f0–f${hm.movingFrames - 1}(${HOOK_SETTLE}s) · 첫 프레임 잉크 ${ink.toFixed(2)}%`);
  if (!(ink >= 1.0)) { console.error('⛔ 훅 모션 첫 프레임 잉크가 1.0% 미만 — hook-check 기준으로 「훅 없음」과 구분이 안 된다'); process.exit(1); }
}
const ctaMode = spec.cta.mode || 'band';
// CTA 화면: sting = 브랜드 스팅 파일(읽기만) · band = 원본 알약 띠만 bg 위 · frames = 원본 통째
const STING = ctaMode === 'sting' ? resolve(JD, spec.cta.sting) : null;
if (STING && !existsSync(STING)) { console.error(`⛔ 스팅이 없다: ${STING}`); process.exit(1); }
const ctaOrig = STING ? parseInt(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', STING], { encoding: 'utf8' }).stdout, 10) : spec.cta.to - spec.cta.from + 1;
const ctaStartF0 = hookN + clips.reduce((a, c) => a + c.n, 0);
// CTA 말: voice.cta.at 큐가 있으면 그 시각(본 말 끝 직후)에, 없으면 CTA 화면 시작에 깐다
const ctaVoiceS = V && V.cta ? (spec.voice.cta.at ? cueSec(V, spec.voice.cta.at) : ctaStartF0 / FPS) : null;
// CTA 말이 CTA 화면보다 길면 **마지막 프레임을 복제해 정지 구간만** 늘린다 — 말(마지막 어절) 끝 + tail 까지
const ctaEndS = V && V.cta ? ctaVoiceS + V.cta.words[V.cta.words.length - 1].t1 + (spec.voice.cta.tail ?? 0.3) : 0;
const ctaN = V && V.cta ? Math.max(ctaOrig, Math.ceil(ctaEndS * FPS - 1e-6) - ctaStartF0) : ctaOrig;
const hold = ctaN - ctaOrig, holdF = hold > 0 ? `,tpad=stop_mode=clone:stop=${hold}` : '';
const total = hookN + clips.reduce((a, c) => a + c.n, 0) + ctaN, totalS = total / FPS;
const tail = V ? 0 : (Number.isFinite(baseADur) ? Math.max(0, baseADur - baseVDur) : 0);   // 말 판은 오디오 = 영상 길이
let audio = null;
const hookEndF = hookN, ctaStartF = hookN + clips.reduce((a, c) => a + c.n, 0);
if (V) {
  const cutFrames = []; { let f = hookN; clips.forEach((c, k) => { if (k > 0) cutFrames.push(f); f += c.n; }); cutFrames.push(f); }
  mkdirSync(join(HERE, 'voice'), { recursive: true });
  const outWav = join(HERE, 'voice', `${spec.slug}-mix.wav`), sfxWav = join(HERE, 'voice', `${spec.slug}-sfx.wav`);
  // 영상 칸 원본 소리(keepAudio · 2026-10-13 · 10/23 발음 회차 — 답이 소리라 소리를 살린다). 장면 시작 시각에 깐다 · 원본은 읽기만.
  const clipAudio = [];
  for (const c of spec.scenes) {
    if (c.type !== 'clipFrame' || !c.keepAudio) continue;
    const wav = join(HERE, 'clips', `${spec.clipTag || spec.slug}-${String(c._f0).padStart(4, '0')}-clipaudio.wav`);
    const ex = spawnSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', resolve(JD, c.src), '-vn', '-af', `atrim=start=${c.from ?? 0}${c.to != null ? `:end=${c.to}` : ''},asetpts=PTS-STARTPTS`, '-ac', '2', '-ar', '48000', wav], { stdio: 'pipe' });
    if (ex.status !== 0) { console.error('⛔ 영상 칸 소리 추출 실패:', ex.stderr?.toString().slice(-600)); process.exit(1); }
    clipAudio.push({ wav, atS: c._f0 / FPS, gain: c.audioGain ?? 1, src: c.src });
    console.log(`  영상 칸 소리: ${c.src} ${c.from ?? 0}–${c.to ?? '끝'}s → ${(c._f0 / FPS).toFixed(3)}s 에 깐다 · gain ${c.audioGain ?? 1}`);
  }
  audio = buildAudio({ ffmpegPath, V, spec, FPS, totalS, cutFrames, ctaStartS: ctaVoiceS, hookEndS: hookEndF / FPS, outWav, sfxWav, clipAudio });
  audio.wav = outWav;
}
const inputs = ['-i', BASE, ...clips.flatMap((c) => ['-i', c.path]), ...(STING ? ['-i', STING] : []), ...(audio ? ['-i', audio.wav] : ['-f', 'lavfi', '-t', (totalS + tail).toFixed(6), '-i', 'anullsrc=r=44100:cl=stereo']),
  ...(HOOKCLIP ? ['-i', HOOKCLIP] : [])];
const hookIdx = 1 + clips.length + (STING ? 1 : 0) + 1;   // 훅 모션 클립은 맨 뒤 입력(오디오 입력 번호를 안 바꾼다)
const norm4 = 'setpts=PTS-STARTPTS,format=yuv420p,setsar=1';
const fc = [HOOKCLIP ? `[${hookIdx}:v]${norm4}[hk]` : `[0:v]trim=start_frame=${spec.hook.from}:end_frame=${spec.hook.to + 1},${norm4}[hk]`];
clips.forEach((c, k) => fc.push(`[${k + 1}:v]${norm4}[s${k}]`));
// CTA: band(기본) = 원본의 알약 띠만 잘라 palette bg 단색 위 같은 자리에 얹는다 — 터미널 글자가 안 새게.
//      frames      = 원본 프레임 통째로 (알약 위 터미널 화면까지 같이 나온다)
if (ctaMode === 'sting') {
  fc.push(`[${clips.length + 1}:v]${norm4}${holdF}[ct]`);
} else if (ctaMode === 'band') {
  const { y0, y1 } = spec.cta.band || {};
  if (!(y0 >= 0 && y1 > y0) || y0 % 2 || (y1 + 1) % 2) { console.error('⛔ cta.band 는 짝수 y0 · 홀수 y1 이어야 한다 (yuv420p 색차 정렬) — check-cta.mjs --measure 로 잰다'); process.exit(1); }
  const bgHex = loadTheme({}).palette.bg.replace('#', '0x');
  fc.push(`color=c=${bgHex}:s=${W}x${H}:r=${FPS}:d=${(ctaN / FPS).toFixed(6)},format=yuv420p,setsar=1[cbg]`);
  fc.push(`[0:v]trim=start_frame=${spec.cta.from}:end_frame=${spec.cta.to + 1},setpts=PTS-STARTPTS,crop=${W}:${y1 - y0 + 1}:0:${y0}${holdF}[cband]`);
  fc.push(`[cbg][cband]overlay=0:${y0}:eof_action=pass,${norm4}[ct]`);
} else fc.push(`[0:v]trim=start_frame=${spec.cta.from}:end_frame=${spec.cta.to + 1}${holdF},${norm4}[ct]`);
fc.push(`[hk]${clips.map((_, k) => `[s${k}]`).join('')}[ct]concat=n=${clips.length + 2}:v=1:a=0[v]`);
const t1 = Date.now();
const r = spawnSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', fc.join(';'),
  '-map', '[v]', '-map', `${clips.length + (STING ? 2 : 1)}:a`, ...(audio ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-metadata', `comment=aiVoice=true; synthetic narration ${V.main.voice} ${V.main.rate} (edge-tts); motion graphics rendered by code`] : ['-c:a', 'aac', '-b:a', '128k']), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high',
  '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', OUT], { stdio: 'pipe' });
if (r.status !== 0) { console.error('⛔ 합성 실패:', r.stderr?.toString().slice(-1500)); process.exit(1); }

// 장면표 + 경계 파일 (review.mjs 가 읽는다)
let f = hookN; const bounds = [], table = [];
table.push({ seg: HOOKCLIP ? '훅(모션 · hook-motion.mjs)' : '훅(원본)', from: 0, to: hookN, lines: 'hookBadge·hookText·hookSub', ground: spec.hook.ground });
for (const c of clips) { bounds.push({ cut: c.key, type: c.type, in: f, out: f + c.n }); table.push({ seg: `장면${String(c.key).padStart(2, '0')} ${c.type}`, from: f, to: f + c.n, lines: c.lines.join('·'), ground: c.ground }); f += c.n; }
table.push({ seg: (ctaMode === 'sting' ? 'CTA(브랜드 스팅)' : ctaMode === 'band' ? 'CTA(원본 알약 띠)' : 'CTA(원본)') + (hold ? ` +정지 ${hold}f` : ''), from: f, to: f + ctaN, lines: V && V.cta ? 'CTA 말' : '—', ground: spec.cta.ground });
const loud = audio ? measureLoudness(ffmpegPath, OUT) : null;
const map = V ? mapping(spec, V, FPS) : null;
writeFileSync(OUT.replace(/\.mp4$/, '.bounds.json'), JSON.stringify({ fps: FPS, mode: 'full', base: spec.base, baseFrames: null, silentAudio: !audio, aiVoice: !!(V && spec.voice.aiVoice), maxVolumeDb: maxVol,
  hook: spec.hook, cta: { ...spec.cta, at: f - 0, n: ctaN, hold, stingFrames: STING ? ctaOrig : undefined }, layout: LAYOUT, zoneDecisions, bounds, table, readTimes,
  ...(V ? { voice: { voice: V.main.voice, rate: V.main.rate, mainDur: V.main.dur, ctaDur: V.cta?.dur, ctaAt: ctaVoiceS, ctaEnd: ctaEndS, mainEnd: V.main.words[V.main.words.length - 1].t1, clauses: map, sfx: audio.placed.map(({ t, kind, gain, why, len, duckedPct, attenDb }) => ({ t: +t.toFixed(3), kind, gain, len, duckedPct, attenDb, why })), speechWindows: audio.speech.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)]), duckDb: audio.duckDb, maxGainInSpeechDb: audio.maxGainInSpeechDb, loudnorm: { target: audio.target, pass1: audio.pass1, pass2: audio.pass2 }, measured: loud } } : {}) }, null, 1));
if (V) {
  console.log('\n말 토막 ↔ 장면');
  for (const m of map) console.log(`  절${m.n} ${m.t0.toFixed(2)}–${m.t1.toFixed(2)}s 「${m.text}」 → ${m.scenes.join(' · ')}`);
  console.log(`  CTA 말 ${ctaVoiceS.toFixed(3)}–${(ctaVoiceS + V.cta.words[V.cta.words.length - 1].t1).toFixed(3)}s (본 말 끝 ${V.main.words[V.main.words.length - 1].t1.toFixed(3)}s 뒤 ${(ctaVoiceS - V.main.words[V.main.words.length - 1].t1).toFixed(3)}s) → 한계 카드 + CTA ${ctaMode}(${ctaOrig}f + 정지 ${hold}f)`);
  console.log('\n효과음'); for (const e of audio.placed) console.log(`  ${e.t.toFixed(3).padStart(6)}s  ${e.kind.padEnd(6)} gain ${e.gain} · ${e.len}s · 덕킹된 샘플 ${e.duckedPct}% · 에너지 감쇠 ${e.attenDb} dB · ${e.why}`);
  console.log(`  말 구간(파형 −40 dBFS) ${audio.speech.length}개: ${audio.speech.map(([a, b]) => `${a.toFixed(2)}–${b.toFixed(2)}`).join(' ')}`);
  console.log(`  덕킹 ${audio.duckDb} dB (말 구간 ±20ms) · 말 구간 안 효과음 최대 게인 ${audio.maxGainInSpeechDb} dB · 효과음 트랙 피크 ${(20 * Math.log10(audio.sfxPeak)).toFixed(1)} dBFS`);
  console.log(`\nloudnorm: 1패스 입력 I ${audio.pass1.input_i} · TP ${audio.pass1.input_tp} → 2패스 ${audio.pass2.normalization_type} · 출력 I ${audio.pass2.output_i} · TP ${audio.pass2.output_tp}`);
  console.log(`최종본 실측(ebur128): I ${loud.I} LUFS · LRA ${loud.LRA} LU · 트루피크 ${loud.TP} dBTP`);
}
console.log('\n장면표');
for (const t of table) console.log(`  ${(t.from / FPS).toFixed(3).padStart(6)}–${(t.to / FPS).toFixed(3).padStart(6)}s  f${t.from}–${t.to - 1}  ${t.ground.padEnd(6)}  ${t.seg.padEnd(24)} 대본 ${t.lines}`);
console.log(`\n합성 → ${OUT}  (${total}f · ${totalS.toFixed(3)}s + 오디오 꼬리 ${tail.toFixed(3)}s)`);
console.log(`렌더: 장면 ${tClips.toFixed(1)}s · 합성 ${((Date.now() - t1) / 1000).toFixed(1)}s · 전체 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ── 6) 드라이브 업로드 (2026-10-06 · 기본 켜짐 · 끄려면 --no-drive) ─────────────────
//   「렌더가 되었다 = 드라이브 업로드까지」(CLAUDE.md 작업 5). 릴스는 폰 업로드이고 폰은 드라이브에서 받는다.
//   📌 이 렌더러엔 업로드가 없었다 — assemble-reel 에만 있었다. 10/12 가 이 렌더러로 만드는 첫 실전 회차다.
//   ▶ 편성 점검(check-schedule)이 찾는 이름은 `<발행일>-<slug>-reels.mp4` 다. 그 이름은 원본(훅 프레임용) 렌더와 겹치므로
//     out/<slug>/upload/ 에 그 이름으로 복사하고, 캡션·AI 라벨 안내를 옆에 만들어 같이 올린다(reel-caption.mjs 한 벌).
//   ⛔ 발행일이 지난 회차(예: 기준판 V-F)는 올리지 않는다 — 다시 렌더할 때마다 지난 회차가 드라이브 맨 위에 올라온다.
//   ⚠️ 업로드 실패로 렌더를 실패로 만들지 않는다 — 영상은 이미 만들어졌다. 손으로 올릴 명령을 찍는다.
//   ⚠️ reel-caption.mjs 는 동적 import 라 공개 자료 내보내기의 import 추적에 안 잡힐 수 있다 — 없으면 업로드만 건너뛴다(영상은 이미 나왔다).
const RC = has('no-drive') ? null : await import('../../reel-caption.mjs').catch(() => { console.log('\n드라이브\n  — reel-caption.mjs 가 없다 — 업로드를 건너뛴다(영상은 위 경로에 있다).'); return null; });
if (RC) {
  const { reelPublishDate, uploadReelToDrive, captionSidecars, tryWriteReelCaption } = RC;
  const { copyFileSync } = await import('node:fs');
  const CARDNEWS = resolve(HERE, '..', '..');
  const recipes = spec.recipes ? JSON.parse(readFileSync(resolve(JD, spec.recipes), 'utf8')).recipes || [] : [];
  const rec = recipes.find((x) => x.slug === spec.slug) || {};
  const pubDate = reelPublishDate(spec.slug);
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // KST
  console.log('\n드라이브');
  if (!pubDate) console.log(`  ⛔ 발행일을 못 찾았다(레시피·매니페스트) — 올리지 않았다. 레시피 publishDate 를 적는다.`);
  else if (pubDate < today) console.log(`  — 발행일 ${pubDate} 이 지났다 — 올리지 않는다(기준판 재렌더).`);
  else {
    const stage = join(CARDNEWS, 'out', spec.slug, 'upload'); mkdirSync(stage, { recursive: true });
    const mp4 = join(stage, `${spec.slug}-reels.mp4`); copyFileSync(OUT, mp4);
    const cap = tryWriteReelCaption({ slug: spec.slug, manifestOverride: rec.manifest || null, videoOutPath: mp4 });
    const up = uploadReelToDrive({ files: [mp4, ...captionSidecars(cap)], pubDate });
    if (up.ok) { console.log(`  ✅ 드라이브 업로드 ${up.uploaded.length}건 — 폰에서 받을 수 있다`); for (const d of up.uploaded) console.log(`     ${d}`); }
    else {
      console.log(`  ⛔⛔ 드라이브 업로드 실패 — 영상은 로컬에 그대로 있다: ${up.why}`);
      console.log(`     손으로: rclone --config ${join(CARDNEWS, 'rclone.conf')} copyto ${mp4} gdrive:dhenddl-reels/${pubDate}-${spec.slug}-reels.mp4`);
    }
    if (!cap) console.log('  ⚠️ 캡션 txt 를 못 만들었다 — 매니페스트가 생기면 이 명령을 다시 돌리거나 reel-caption.mjs 로 뽑는다.');
  }
}
