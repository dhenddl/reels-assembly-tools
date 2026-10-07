// check-cta.mjs — CTA 알약 띠 실측 · 검사 (원본은 읽기만 한다)
//
//   node check-cta.mjs --measure <원본.mp4> --from 257 --to 324
//       CTA 프레임 전부에서 행마다 「bg 가 아닌 픽셀」 수의 최댓값을 재고, bg 가 아닌 행 구간을 찍는다.
//       → 알약 띠 = 맨 아래 구간. 그 위 구간(터미널 글자)과의 빈 행 간격도 찍는다.
//   node check-cta.mjs --check <결과.mp4>
//       <결과>.bounds.json 의 cta 정보로 ① 띠 밖이 bg 단색인지 ② 띠 안이 원본과 같은지(PSNR) 본다.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadTheme } from '../../palette.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const W = 1080, H = 1920, FS = W * H * 3;
const { palette } = loadTheme({});
const BG = [1, 3, 5].map((i) => parseInt(palette.bg.slice(i, i + 2), 16));
const TOL = 6;   // 디코딩 오차 허용 (0~255). 이보다 크게 벗어나면 「bg 가 아니다」

// 프레임을 하나씩 흘려 받는다 (한 번에 다 받으면 수백 MB)
function eachFrame(file, from, to, fn) {
  return new Promise((ok, no) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=between(n\\,${from}\\,${to})`, '-vsync', '0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
    let buf = Buffer.alloc(0), f = 0;
    p.stdout.on('data', (d) => { buf = Buffer.concat([buf, d]); while (buf.length >= FS) { fn(buf.subarray(0, FS), f++); buf = buf.subarray(FS); } });
    p.on('close', (c) => (c === 0 ? ok(f) : no(new Error('ffmpeg ' + c))));
  });
}
const dev = (fr, i) => Math.max(Math.abs(fr[i] - BG[0]), Math.abs(fr[i + 1] - BG[1]), Math.abs(fr[i + 2] - BG[2]));

if (arg('measure')) {
  const file = arg('measure'), from = +arg('from'), to = +arg('to');
  const rowMax = new Array(H).fill(0);
  const nf = await eachFrame(file, from, to, (fr) => { for (let y = 0; y < H; y++) { let c = 0; const o = y * W * 3; for (let x = 0; x < W; x++) if (dev(fr, o + x * 3) > TOL) c++; if (c > rowMax[y]) rowMax[y] = c; } });
  const segs = []; let s = -1;
  for (let y = 0; y < H; y++) { if (rowMax[y] > 0 && s < 0) s = y; if (rowMax[y] === 0 && s >= 0) { segs.push([s, y - 1]); s = -1; } }
  if (s >= 0) segs.push([s, H - 1]);
  console.log(`bg ${palette.bg} = (${BG}) · 허용 ${TOL} · CTA 프레임 ${nf}개 (f${from}–f${to})`);
  console.log(`bg 가 아닌 행 구간 ${segs.length}개 — 마지막 5개: ${segs.slice(-5).map((a) => `${a[0]}–${a[1]}`).join('  ')}`);
  const last = segs[segs.length - 1], prev = segs[segs.length - 2];
  console.log(`▶ 알약 띠(맨 아래 구간) y ${last[0]}–${last[1]} · 바로 위 구간 끝 y ${prev[1]} · 사이 빈 행 ${last[0] - prev[1] - 1}px`);
  process.exit(0);
}

if (arg('check')) {
  const out = arg('check'), B = JSON.parse(readFileSync(out.replace(/\.mp4$/, '.bounds.json'), 'utf8'));
  if (B.cta.mode === 'sting') {   // 스팅 모드: 결과 CTA 구간 ↔ 스팅 원본(+마지막 프레임 정지) PSNR
    const c = B.cta, st = resolve(dirname(resolve(out)), c.sting), n = c.n, hold = c.hold || 0;
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', st, '-i', out, '-lavfi',
      `[0:v]setpts=PTS-STARTPTS${hold > 0 ? `,tpad=stop_mode=clone:stop=${hold}` : ''}[a];[1:v]trim=start_frame=${c.at}:end_frame=${c.at + n},setpts=PTS-STARTPTS[b];[a][b]psnr`, '-f', 'null', '-'], { encoding: 'utf8' });
    const m = (r.stderr || '').match(/PSNR y:\S+ u:\S+ v:\S+ average:(\S+) min:(\S+)/);
    const fr = ((r.stderr || '').match(/frame=\s*(\d+)/g) || []).pop();
    console.log(`스팅: 결과 f${c.at}–f${c.at + n - 1} (${n}f = 스팅 ${c.stingFrames}f + 정지 ${hold}f) ↔ ${c.sting} · PSNR 평균 ${m ? m[1] : '?'} · 최저 ${m ? m[2] : '?'} · 비교 ${fr || '?'}`);
    console.log(`판정: ${m && parseFloat(m[2]) > 40 ? '✅ 스팅 그대로 · 정지는 마지막 프레임' : '⛔ 확인 필요'}`);
    process.exit(0);
  }
  const base = resolve(dirname(resolve(out)), B.base), c = B.cta, n0 = c.to - c.from + 1, n = c.n || n0, hold = n - n0;
  const { y0, y1 } = c.band;
  let outsideBad = 0, outsideMax = 0, frames = 0; const hist = new Map();
  await eachFrame(out, c.at, c.at + n - 1, (fr) => {
    frames++;
    for (let y = 0; y < H; y++) { if (y >= y0 && y <= y1) continue; const o = y * W * 3;
      for (let x = 0; x < W; x++) { const d = dev(fr, o + x * 3); if (d > outsideMax) outsideMax = d; if (d > TOL) outsideBad++; hist.set(d, (hist.get(d) || 0) + 1); } }
  });
  const px = frames * W * (H - (y1 - y0 + 1));
  console.log(`① 띠 밖 (y 0–${y0 - 1} · ${y1 + 1}–${H - 1}) · 결과 f${c.at}–f${c.at + n - 1} · ${frames}프레임 · ${px.toLocaleString('en-US')}픽셀`);
  console.log(`   bg ${palette.bg} 에서 최대 편차 ${outsideMax} · 허용(${TOL}) 넘은 픽셀 ${outsideBad} · 편차 분포 ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([d, k]) => `${d}:${k}`).join(' ')}`);
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', base, '-i', out, '-lavfi',
    `[0:v]trim=start_frame=${c.from}:end_frame=${c.to + 1},setpts=PTS-STARTPTS,crop=${W}:${y1 - y0 + 1}:0:${y0}${hold > 0 ? `,tpad=stop_mode=clone:stop=${hold}` : ''}[a];[1:v]trim=start_frame=${c.at}:end_frame=${c.at + n},setpts=PTS-STARTPTS,crop=${W}:${y1 - y0 + 1}:0:${y0}[b];[a][b]psnr`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (r.stderr || '').match(/PSNR y:\S+ u:\S+ v:\S+ average:(\S+) min:(\S+)/);
  console.log(`② 띠 안 (y ${y0}–${y1}) 원본 f${c.from}–f${c.to}${hold > 0 ? ` + 마지막 프레임 정지 ${hold}f` : ''} ↔ 결과 ${n}f · PSNR 평균 ${m ? m[1] : '?'} · 최저 ${m ? m[2] : '?'}`);
  console.log(`판정: ${outsideBad === 0 && m && parseFloat(m[2]) > 40 ? '✅ 띠 밖 bg 단색 · 띠 안 원본과 같음' : '⛔ 확인 필요'}`);
}
