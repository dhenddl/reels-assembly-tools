// voice.mjs — 「말이 장면 길이를 정한다」 판(V-F)의 말 · 타이밍 · 오디오 합성
//
// 말: tts-words.py 가 edge-tts 라이브러리(WordBoundary)로 받은 mp3 + 어절 경계 JSON.
//   ⛔ 말 대본은 한 글자도 안 바꾼다 — 경계 JSON 의 text 가 대본 파일과 글자 단위로 같지 않으면 멈춘다.
// 절(clause) = 대본의 쉼표·마침표로 나뉜 토막. 어절 경계를 대본 문자열에 순서대로 맞춰 가른다.
// 큐(cue): 장면 JSON 에서 { "cue": "clause:3" | "clause:3:end" | "word:고장났을" | "speechEnd", "plus": s, "min": s }
//   장면 start/end 에 쓰면 절대 시각(프레임은 내림 — 컷이 말보다 먼저 온다),
//   장면 안 파라미터(switchSec 등)에 쓰면 그 장면 시작 기준 상대 시각이 된다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildSfxTrack } from './sfx-cuts.mjs';

function loadWords(JD, v) {
  const text = readFileSync(resolve(JD, v.script), 'utf8').trim();
  const W = JSON.parse(readFileSync(resolve(JD, v.words), 'utf8'));
  if (W.text !== text) throw new Error(`⛔ 어절 경계 JSON 의 대본이 ${v.script} 와 다르다 — 말 대본은 한 글자도 안 바꾼다. tts-words.py 로 다시 받는다`);
  if (v.voice && W.voice !== v.voice) throw new Error(`⛔ 목소리가 다르다: JSON ${W.voice} · 장면 JSON ${v.voice}`);
  if (v.rate && W.rate !== v.rate) throw new Error(`⛔ 속도가 다르다: JSON ${W.rate} · 장면 JSON ${v.rate}`);
  const clauses = []; let cur = [], pos = 0;
  for (const w of W.words) {
    const i = text.indexOf(w.text, pos); if (i < 0) throw new Error(`어절 「${w.text}」 를 대본에서 못 찾았다`);
    pos = i + w.text.length; cur.push(w);
    if (pos >= text.length || ',.'.includes(text[pos])) { clauses.push({ t0: cur[0].t0, t1: cur[cur.length - 1].t1, text: cur.map((x) => x.text).join(' '), words: cur }); cur = []; }
  }
  if (cur.length) clauses.push({ t0: cur[0].t0, t1: cur[cur.length - 1].t1, text: cur.map((x) => x.text).join(' '), words: cur });
  const mp3 = resolve(JD, v.mp3);
  const dur = parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3], { encoding: 'utf8' }).stdout);
  return { text, words: W.words, clauses, mp3, dur, voice: W.voice, rate: W.rate };
}

// ★ 명령 한 줄 (2026-10-06 사용자 「코드를 한 줄로 만든다」): mp3·어절 경계가 없거나 대본·목소리·속도와 어긋나면
//   tts-words.py 를 여기서 부른다. 맞으면 아무것도 안 한다 — 이미 받은 음성을 다시 받지 않는다(재합성은 미세하게 달라질 수 있다).
//   ⛔ 어긋난 채로 쓰지 않는다는 원칙(loadWords 의 ⛔)은 그대로다 — 다시 받은 뒤에도 loadWords 가 같은 대조를 한다.
function staleReason(JD, v) {
  const mp3 = resolve(JD, v.mp3), words = resolve(JD, v.words);
  if (!existsSync(mp3)) return 'mp3 없음';
  if (!existsSync(words)) return '어절 경계 JSON 없음';
  const text = readFileSync(resolve(JD, v.script), 'utf8').trim();
  const W = JSON.parse(readFileSync(words, 'utf8'));
  if (W.text !== text) return '대본이 바뀜';
  if (v.voice && W.voice !== v.voice) return `목소리 ${W.voice} → ${v.voice}`;
  if (v.rate && W.rate !== v.rate) return `속도 ${W.rate} → ${v.rate}`;
  return null;
}

export function ensureVoice(spec, JD, here) {
  for (const key of ['main', 'cta']) {
    const v = spec.voice[key]; if (!v) continue;
    const why = staleReason(JD, v); if (!why) continue;
    console.log(`말(${key}): ${why} → tts-words.py 로 받는다`);
    const args = [resolve(here, 'tts-words.py'), resolve(JD, v.script), resolve(JD, v.mp3), resolve(JD, v.words), v.voice || 'ko-KR-HyunsuMultilingualNeural', v.rate || '+50%'];
    const r = spawnSync(process.env.PYTHON || 'python', args, { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`⛔ tts-words.py 실패(${key}, exit ${r.status}) — python 과 edge-tts 가 있는지 본다 (pip install edge-tts)`);
  }
}

export function loadVoice(spec, JD) {
  const v = spec.voice;
  const main = loadWords(JD, v.main);
  const cta = v.cta ? loadWords(JD, v.cta) : null;
  return { main, cta, spec: v };
}

export function cueSec(V, c) {
  if (typeof c === 'number') return c;
  if (!c || !c.cue) throw new Error(`큐 형식이 아니다: ${JSON.stringify(c)}`);
  const [kind, a, b] = c.cue.split(':'); let s;
  if (kind === 'clause') { const cl = V.main.clauses[+a - 1]; if (!cl) throw new Error(`clause:${a} 가 없다 (절 ${V.main.clauses.length}개)`); s = b === 'end' ? cl.t1 : cl.t0; }
  else if (kind === 'word') { const w = V.main.words.find((x) => x.text === a); if (!w) throw new Error(`word:${a} 가 말에 없다`); s = w.t0; }
  else if (kind === 'speechEnd') s = V.main.words[V.main.words.length - 1].t1;
  else throw new Error(`모르는 큐: ${c.cue}`);
  return s + (c.plus || 0);
}

// 장면 프레임 배정: 다음 장면의 start 큐 → 이 장면 end 큐 → dur 순
const SEC_KEYS = ['switchSec', 'switchLenSec', 'countSec', 'popSec', 'bSec', 'hiSec', 'breakSec', 'breakLenSec'];
export function applyTiming(spec, V, FPS) {
  const toF = (s) => Math.floor(s * FPS + 1e-6);
  let cur = spec.hook.to + 1;
  spec.scenes.forEach((c, i) => {
    const nx = spec.scenes[i + 1], s = cur; let e;
    if (nx && nx.start) e = toF(cueSec(V, nx.start));
    else if (c.end) e = toF(cueSec(V, c.end));
    else e = s + Math.round(c.dur * FPS);
    if (!(e > s)) throw new Error(`장면${i + 1} 길이가 0 이하다 (f${s}–f${e})`);
    c._f0 = s; c._f1 = e; c.dur = (e - s) / FPS; cur = e;
    const t0 = s / FPS;
    for (const k of SEC_KEYS) {
      const v = c[k]; if (v == null) continue;
      const one = (x) => { if (typeof x === 'number') return x; let r = cueSec(V, x) - t0; if (x.min != null) r = Math.max(r, x.min); if (x.max != null) r = Math.min(r, x.max); return +r.toFixed(4); };
      c[k] = Array.isArray(v) ? v.map(one) : one(v);
    }
  });
  return cur;   // 마지막 장면 끝 프레임 = CTA 시작
}

// 말 토막 ↔ 장면 매핑 (겹치는 장면)
export function mapping(spec, V, FPS) {
  const segs = [{ label: '훅(원본)', f0: 0, f1: spec.hook.to + 1 }, ...spec.scenes.map((c, i) => ({ label: `장면${String(i + 1).padStart(2, '0')} ${c.type}`, f0: c._f0, f1: c._f1 }))];
  return V.main.clauses.map((cl, i) => ({ n: i + 1, t0: cl.t0, t1: cl.t1, text: cl.text,
    scenes: segs.filter((s) => s.f0 / FPS < cl.t1 && s.f1 / FPS > cl.t0).map((s) => `${s.label}(${(s.f0 / FPS).toFixed(2)}–${(s.f1 / FPS).toFixed(2)})`) }));
}

// 말 구간 = **파형에서** 잰다: 10ms 창 RMS 가 −40 dBFS 를 넘는 구간(silencedetect 와 같은 문턱) · 60ms 미만 틈은 잇는다.
//   ✏️ 어절 경계(t0)는 실제로 들리는 시작보다 80~100ms 이르다(2026-09-29 두 방법 대조). 그걸로 덕킹하면
//      절 사이 쉼에 놓인 컷 효과음까지 통째로 눌린다 — 그래서 덕킹은 파형 기준, 어절 경계는 대조로만 찍는다.
export function speechFromAudio(ffmpegPath, mp3, offset = 0, thrDb = -40) {
  const r = spawnSync(ffmpegPath, ['-v', 'error', '-i', mp3, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const n = Math.floor(r.stdout.length / 4), win = 480, thr = Math.pow(10, thrDb / 20), out = [];
  for (let i = 0; i < n; i += win) {
    let acc = 0; const m = Math.min(n, i + win); for (let k = i; k < m; k++) { const v = r.stdout.readFloatLE(k * 4); acc += v * v; }
    const on = Math.sqrt(acc / (m - i)) > thr, a = i / 48000 + offset, b = m / 48000 + offset;
    if (!on) continue;
    if (out.length && a - out[out.length - 1][1] < 0.06) out[out.length - 1][1] = b; else out.push([a, b]);
  }
  return out;
}

// 오디오: 효과음 트랙(덕킹 포함) + 본 말 + CTA 말 → loudnorm 2패스 → 48k wav
export function buildAudio({ ffmpegPath, V, spec, FPS, totalS, cutFrames, ctaStartS, hookEndS, outWav, sfxWav }) {
  const sx = spec.sfx || {}, gains = { hook: 0.5, tick: 0.45, impact: 0.6, glitch: 0.4, ...(sx.gains || {}) };
  const events = [];
  if (sx.hook !== false) events.push({ t: 0, kind: 'hook', ms: Math.round((hookEndS + 0.15) * 1000), gain: gains.hook, why: '훅 typing — 이음새 임팩트가 훅→장면01 컷에 떨어진다' });
  for (const f of cutFrames) events.push({ t: f / FPS, kind: 'tick', gain: gains.tick, why: `하드컷 f${f}` });
  spec.scenes.forEach((c, i) => (c.sfx || []).forEach((e) => {
    const local = typeof e.at === 'number' ? e.at : (cueSec(V, e.at) - c._f0 / FPS);
    events.push({ t: c._f0 / FPS + local, kind: e.kind, gain: gains[e.kind], why: `장면${i + 1} ${e.why || ''}`.trim() });
  }));
  const ctaOff = ctaStartS + (spec.voice.cta?.offset || 0);
  const speech = [...speechFromAudio(ffmpegPath, V.main.mp3, 0), ...(V.cta ? speechFromAudio(ffmpegPath, V.cta.mp3, ctaOff) : [])];
  const duckDb = sx.duckDb ?? -14;
  const { wav, placed, peak, maxGainInSpeechDb } = buildSfxTrack({ totalS, events, speech, duckDb });
  writeFileSync(sfxWav, wav);
  const T = totalS.toFixed(6), ctaMs = Math.round((ctaStartS + (spec.voice.cta?.offset || 0)) * 1000);
  const st = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const ins = ['-i', sfxWav, '-i', V.main.mp3, ...(V.cta ? ['-i', V.cta.mp3] : [])];
  const pre = [`[0:a]${st}[s]`, `[1:a]${st}[v1]`, ...(V.cta ? [`[2:a]${st},adelay=${ctaMs}|${ctaMs}[v2]`] : []),
    `[s][v1]${V.cta ? '[v2]' : ''}amix=inputs=${V.cta ? 3 : 2}:normalize=0:duration=longest,apad=whole_dur=${T},atrim=0:${T}[m]`];
  const L = { I: -14, TP: -1.5, LRA: 11, ...(spec.loudness || {}) };
  const p1 = spawnSync(ffmpegPath, ['-hide_banner', ...ins, '-filter_complex', [...pre, `[m]loudnorm=I=${L.I}:TP=${L.TP}:LRA=${L.LRA}:print_format=json[o]`].join(';'), '-map', '[o]', '-f', 'null', '-'], { encoding: 'utf8' });
  const j1 = JSON.parse((p1.stderr.match(/\{[\s\S]*?\}/g) || []).pop());
  const p2 = spawnSync(ffmpegPath, ['-y', '-hide_banner', ...ins, '-filter_complex', [...pre,
    `[m]loudnorm=I=${L.I}:TP=${L.TP}:LRA=${L.LRA}:measured_I=${j1.input_i}:measured_TP=${j1.input_tp}:measured_LRA=${j1.input_lra}:measured_thresh=${j1.input_thresh}:offset=${j1.target_offset}:linear=true:print_format=json,aresample=48000[o]`].join(';'),
    '-map', '[o]', '-c:a', 'pcm_s16le', '-ar', '48000', outWav], { encoding: 'utf8' });
  if (p2.status !== 0) throw new Error('loudnorm 2패스 실패: ' + p2.stderr.slice(-800));
  const j2 = JSON.parse((p2.stderr.match(/\{[\s\S]*?\}/g) || []).pop());
  return { placed, sfxPeak: peak, maxGainInSpeechDb, duckDb, speech, pass1: j1, pass2: j2, target: L };
}

// 최종본 음량 실측 (ebur128 · 트루피크)
export function measureLoudness(ffmpegPath, file) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const s = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const g = (re) => parseFloat((s.match(re) || [])[1]);
  return { I: g(/I:\s+(-?[0-9.]+) LUFS/), LRA: g(/LRA:\s+(-?[0-9.]+) LU/), TP: g(/Peak:\s+(-?[0-9.]+) dBFS/) };
}
