// review.mjs — 컷/10초 비교. reel-review.mjs 의 cutsPer10s() 와 **같은 명령·같은 임계**(0.3 · 0.05)를 쓴다.
// 왜 reel-review.mjs 를 직접 안 돌리나: 그 도구는 out/<slug>/<slug>-reels.mp4 만 읽고
//   out/.reelreview/ 와 out/<slug>/<slug>-review-sheet.png 에 **쓴다** — 기존 out/reels-rule-silent/ 를 건드린다.
// 추가: <mp4>.bounds.json(render-cuts.mjs 가 쓴다)이 있으면 **컷 경계 프레임의 장면 점수**를 따로 찍는다.
//   node review.mjs <a.mp4> <b.mp4> ...
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
const CUT_SCENE = 0.3, MID_SCENE = 0.05;
for (const mp4 of process.argv.slice(2)) {
  const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mp4]).toString());
  const fps = eval(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', mp4]).toString().trim());
  const r = spawnSync('ffmpeg', ['-i', mp4, '-vf', `select='gt(scene,0)',metadata=print:key=lavfi.scene_score`, '-f', 'null', '-'], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const rows = [...out.matchAll(/pts_time:([0-9.]+)[^\n]*\n[^\n]*lavfi\.scene_score=([0-9.]+)/g)].map((m) => [parseFloat(m[1]), parseFloat(m[2])]);
  if (!rows.length) { console.log(`${mp4}\n  ⛔ 장면 점수를 한 줄도 못 읽었다 — 도구 문제로 본다`); continue; }
  const v = rows.map((x) => x[1]);
  const cuts = rows.filter((x) => x[1] > CUT_SCENE);
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const mid = (v.filter((x) => x > MID_SCENE).length / v.length) * 100;
  console.log(`${mp4}\n  길이 ${dur.toFixed(3)}s · 하드컷(>${CUT_SCENE}) ${cuts.length} · 컷/10s ${(cuts.length / dur * 10).toFixed(2)} · 평균 변화량 ${avg.toFixed(4)} · 0.05 초과 ${mid.toFixed(1)}%`);
  console.log(`  하드컷 시각: ${cuts.map((x) => `${x[0].toFixed(3)}(${x[1].toFixed(2)})`).join(' ') || '없음'}`);
  const bj = mp4.replace(/\.mp4$/, '.bounds.json');
  if (existsSync(bj)) {
    const B = JSON.parse(readFileSync(bj, 'utf8'));
    const byFrame = new Map(rows.map(([t, s]) => [Math.round(t * fps), s]));
    const sc = (f) => byFrame.get(f) ?? 0;   // select 에 안 걸린 프레임 = 점수 0
    const all = [];
    for (const b of B.bounds) { const i = sc(b.in), o = sc(b.out); all.push(i, o); console.log(`  컷${b.cut} ${b.type.padEnd(16)} 들어감 f${b.in} ${i.toFixed(3)} · 나옴 f${b.out} ${o.toFixed(3)}`); }
    console.log(`  경계 점수 범위 ${Math.min(...all).toFixed(3)}–${Math.max(...all).toFixed(3)} · >0.3 인 경계 ${all.filter((x) => x > CUT_SCENE).length}/${all.length}`);
  }
}
