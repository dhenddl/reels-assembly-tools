// hook-motion.mjs — 「0초부터 움직이는 훅」. 2026-10-13 신설 (릴스 세션).
//
// ── 어디서 왔나 ────────────────────────────────────────────────
// 사용자 결정(2026-10-07 「1번 넣고」): 확인한 10편 전부 첫 0~1.7초가 **같은 정지 카드**였다 — 한 번도 바꿔 본 적 없는 변수.
//   10/19 주 릴스 셋 중 **하나만**(10/21 reels-scheduled-rumor · 릴스 세션 10/12 선택) 0초부터 움직이는 훅으로 만든다.
//   ★ **문구·바탕은 그대로, 등장 움직임만 더한다** — 문구까지 바꾸면 비교 변수가 둘이 된다(두더지 굴 §4).
//
// ── ⛔ 왜 make-termcast.mjs 를 안 고쳤나 ─────────────────────────
// 정지 훅 카드는 make-termcast.mjs 가 그린다. 그 파일은 공개 자료 **1호·4호**에 들어 있고,
// 1호는 10/14 배포 회차(post-week14-wed · material 1호)가 있다 → 고치면 check-material-drift 가 그날 스레드를 막는다.
// ▶ 그래서 카드의 CSS 를 **값 그대로 옮겨 와** 여기서 다시 그리고, 움직임은 transform·opacity 로만 준다(배치가 안 바뀐다).
//   같은 모양인지는 `--parity` 가 잰다 — 다 멈춘 프레임을 기반 영상의 정지 훅과 PSNR 로 비교한다.
//   ⚠️ make-termcast.mjs 의 훅 CSS(.hook .hb .ht .hs .hglow)를 고치면 **여기도 같이** 고친다. 갈리면 `--parity` 가 떨어진다.
//
// ── 움직임 (STANDARD.md 4: 들어올 때 outExpo/outCubic · 바운스 금지 · 글자 움직임 동시에 3개까지) ──
//   글로(장식)  0.00–1.00s  scale 0.72→1 · opacity 0.35→1        outCubic
//   제목(.ht)   0.00–0.60s  translateY 96→0 · scale 1.07→1         outExpo  ★ 0프레임부터 **보이면서** 움직인다(불투명도 1)
//   배지(.hb)   0.04–0.40s  translateX −64→0 · opacity 0→1         outExpo
//   보조(.hs)   0.30–0.75s  translateY 34→0 · opacity 0→1          outCubic
//   ▶ 1.00s 이후는 정지 카드와 **같은 화면**이다(transform 없음 · opacity 1).
//   📌 제목을 0프레임부터 불투명하게 둔 이유: hook-check.mjs 가 첫 프레임 밝은 픽셀 ≥1.0% 로 훅 유무를 본다(정지 훅 1.63~3.72%).
//      첫 프레임이 비면 「훅 없는 릴스」와 구분이 안 된다 — 그건 2026-08-21 에 4편이 빠졌던 사고 모양이다.
//
// ── 사용 ─────────────────────────────────────────────────────────
//   render-full.mjs 가 장면 JSON 의 `hook.motion: true` 를 보면 이 모듈로 훅 구간을 그린다(기반 영상 trim 대신).
//   단독: node hook-motion.mjs --slug <레시피 슬러그> --n 42 --fps 24 --out clips/x.mp4 [--static]
//   대조: node hook-motion.mjs --slug <기반 영상이 있는 슬러그> --parity <기반.mp4> [--n 42 --fps 24]
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTheme, rgba, assertFontsResolve } from '../../palette.mjs';
import { ffmpegPath } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 1080, H = 1920;
export const SETTLE = 1.0;   // 이 시각 이후는 정지 카드와 같다
export const MOTION = {
  glow: { t0: 0.00, t1: 1.00 },
  ht: { t0: 0.00, t1: 0.60 },
  hb: { t0: 0.04, t1: 0.40 },
  hs: { t0: 0.30, t1: 0.75 },
};

// make-termcast.mjs:224 와 같다
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 레시피 한 편의 훅 카드 HTML. CSS 는 make-termcast.mjs 의 :root · html,body · .hook 블록 값 그대로다. */
export function hookHtml(r, themeMeta = {}) {
  if (!r || !r.hookText) throw new Error('hookText 가 없는 레시피다 — 훅 카드를 그릴 수 없다');
  const { palette: pal, fonts } = loadTheme(themeMeta);
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
:root { --bg:${pal.bg}; --panel:${pal.panel}; --line:${pal.line}; --text:${pal.text}; --dim:${pal.dim};
  --accent:${pal.accent}; --accent-dim:${pal.accentDim}; --on-accent:${pal.onAccent}; }
html,body { width:1080px; height:1920px; background:var(--bg); overflow:hidden; }
body { font-family:${fonts.mono}; color:var(--text); }
.hook { position:absolute; inset:0; background:var(--bg); z-index:5;
  display:flex; flex-direction:column; justify-content:center; padding:0 88px;
  font-family:${fonts.sans}; }
.hook .hb { align-self:flex-start; margin-bottom:56px; font-size:36px; color:var(--accent);
  border:2px solid var(--accent-dim); border-radius:999px; padding:18px 38px; letter-spacing:1px; }
.hook .ht { font-size:112px; line-height:1.2; font-weight:800; letter-spacing:-3px;
  word-break:keep-all; overflow-wrap:break-word; }
.hook .hs { margin-top:52px; font-size:50px; line-height:1.42; color:var(--dim);
  word-break:keep-all; overflow-wrap:break-word; }
.hook .hglow { position:absolute; width:1100px; height:1100px; border-radius:50%; pointer-events:none;
  background:radial-gradient(circle, ${rgba(pal.accent, 0.16)} 0%, transparent 62%); top:-360px; right:-320px; }
.hook .ht { transform-origin: 0% 50%; }
</style></head><body>
<div class="hook" id="hook"><div class="hglow" id="hglow"></div>
  ${r.hookBadge ? `<div class="hb" id="hb">${esc(r.hookBadge)}</div>` : ''}
  <div class="ht" id="ht">${esc(r.hookText).replace(/\\n|\n/g, '<br>')}</div>
  ${r.hookSub ? `<div class="hs" id="hs">${esc(r.hookSub).replace(/\\n|\n/g, '<br>')}</div>` : ''}
</div>
<script>
const M = ${JSON.stringify(MOTION)};
const clamp = (x) => Math.max(0, Math.min(1, x));
const outExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const outCubic = (x) => 1 - Math.pow(1 - x, 3);
const prog = (t, k, ease) => { const m = M[k]; return ease(clamp((t - m.t0) / (m.t1 - m.t0))); };
const set = (id, tf, op) => { const el = document.getElementById(id); if (!el) return;
  el.style.transform = tf; el.style.opacity = op; };
const lerp = (a, b, p) => a + (b - a) * p;
// ★ 결정론: t 하나의 함수다(벽시계·CSS 애니메이션·transition 없음). 끝 값에 닿으면 transform 을 비운다 — 정지 카드와 같은 화면.
window.frame = (t) => {
  const g = prog(t, 'glow', outCubic), a = prog(t, 'ht', outExpo), b = prog(t, 'hb', outExpo), c = prog(t, 'hs', outCubic);
  set('hglow', g >= 1 ? '' : 'scale(' + lerp(0.72, 1, g) + ')', g >= 1 ? '' : String(lerp(0.35, 1, g)));
  set('ht', a >= 1 ? '' : 'translateY(' + lerp(96, 0, a) + 'px) scale(' + lerp(1.07, 1, a) + ')', '');
  set('hb', b >= 1 ? '' : 'translateX(' + lerp(-64, 0, b) + 'px)', b >= 1 ? '' : String(b));
  set('hs', c >= 1 ? '' : 'translateY(' + lerp(34, 0, c) + 'px)', c >= 1 ? '' : String(c));
};
window.frame(0);
</script></body></html>`;
  return { html, fonts };
}

/** 훅 구간 n 프레임을 mp4 로. motion=false 면 다 멈춘 화면(정지 카드)만 n 장. */
export async function renderHookMotion({ recipe, fps, n, out, motion = true, themeMeta = {} }) {
  const { html, fonts } = hookHtml(recipe, themeMeta);
  mkdirSync(dirname(out), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle' });
    await assertFontsResolve(page, fonts);
    const ff = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', out],
      { stdio: ['pipe', 'inherit', 'pipe'] });
    let err = ''; ff.stderr.on('data', (d) => { err += d; });
    for (let f = 0; f < n; f++) {
      await page.evaluate((tt) => window.frame(tt), motion ? f / fps : 99);
      const buf = await page.screenshot({ type: 'png' });
      if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
    }
    ff.stdin.end();
    const [code] = await once(ff, 'close');
    if (code !== 0) throw new Error('훅 모션 인코딩 실패: ' + err.slice(-800));
  } finally { await browser.close(); }
  const settleF = Math.ceil(SETTLE * fps);
  return { out, n, fps, motion, settleFrame: settleF, movingFrames: Math.min(n, settleF) };
}

/** 첫 프레임 밝은 픽셀 비율(%) — hook-check.mjs 와 같은 잣대(그레이 > 96). */
export function firstFrameInkPct(mp4) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', mp4, '-frames:v', '1', '-vf', 'format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 64 << 20 });
  const d = r.stdout; let ink = 0; for (let i = 0; i < d.length; i++) if (d[i] > 96) ink++;
  return (100 * ink) / d.length;
}

/** 두 영상의 지정 프레임 PSNR(dB). */
export function framePsnr(a, fa, b, fb) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', a, '-i', b, '-filter_complex',
    `[0:v]select=eq(n\\,${fa}),setpts=PTS-STARTPTS,format=yuv420p[x];[1:v]select=eq(n\\,${fb}),setpts=PTS-STARTPTS,format=yuv420p[y];[x][y]psnr`, '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (r.stderr || '').match(/average:([0-9.]+|inf)/);
  return m ? (m[1] === 'inf' ? Infinity : parseFloat(m[1])) : NaN;
}

export function loadRecipe(recipesPath, slug) {
  const raw = JSON.parse(readFileSync(recipesPath, 'utf8'));
  const list = Array.isArray(raw) ? raw : (raw.recipes || Object.values(raw));
  const r = list.find((x) => x && x.slug === slug);
  if (!r) throw new Error(`레시피에 ${slug} 가 없다`);
  return r;
}

// ── 단독 실행 ────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const slug = arg('slug'); if (!slug) { console.error('사용: --slug <레시피 슬러그> [--n 42 --fps 24 --out <mp4>] [--static] [--parity <기반.mp4>]'); process.exit(1); }
  const fps = parseInt(arg('fps', '24'), 10), n = parseInt(arg('n', '42'), 10);
  const recipe = loadRecipe(resolve(HERE, '..', '..', 'reels-recipes.json'), slug);
  const parity = arg('parity');
  const out = resolve(HERE, arg('out', join('clips', `${slug}-hook-${argv.includes('--static') ? 'static' : 'motion'}.mp4`)));
  const res = await renderHookMotion({ recipe, fps, n, out, motion: !argv.includes('--static') });
  console.log(`훅 ${res.motion ? '모션' : '정지'} ${n}프레임 @${fps} → ${out}`);
  console.log(`  움직이는 구간 f0–f${res.movingFrames - 1} (${SETTLE}s) · 이후 정지 카드와 같은 화면`);
  console.log(`  첫 프레임 잉크 ${firstFrameInkPct(out).toFixed(2)}% (hook-check 경계 1.0% · 정지 훅 실측 1.63~3.72%)`);
  if (parity) {
    const base = resolve(HERE, parity);
    if (!existsSync(base)) { console.error(`기반 영상이 없다: ${base}`); process.exit(1); }
    const mid = Math.floor(n / 2), last = n - 1;
    const p1 = framePsnr(out, last, base, last), p2 = framePsnr(out, mid, base, mid);
    console.log(`  대조(기반 정지 훅과 PSNR): 마지막 f${last} ${p1.toFixed(2)} dB · 가운데 f${mid} ${p2.toFixed(2)} dB`);
  }
}
