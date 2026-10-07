// palette.mjs — 카드뉴스·릴스가 같이 쓰는 색·폰트의 단일 출처
//
// 2026-08-10 신설. 그 전엔 render.js와 make-termcast.mjs가 같은 팔레트를 각자
// 복사해 갖고 있었다. **같은 소재의 캐러셀과 릴스가 같은 색이어야 하는데
// 한쪽만 고치면 조용히 어긋난다** — 그것도 이미지라 코드로는 안 잡힌다.
//
// 시리즈별로 색을 바꾸려면 slides.json의 meta에 넣는다:
//
//   "palette": { "accent": "#d29922", "accentDim": "#9e6a03", "onAccent": "#26190a" },
//   "fonts":   { "sans": "'Nanum Pen Script', sans-serif" }
//
// 릴스는 같은 파일을 가리키게 한다:
//   node make-termcast.mjs --palette-from watch-time-drift.json ...
//
// 넣은 키만 덮어쓰고 나머지는 아래 기본값을 쓴다.

import { existsSync } from "node:fs";

// ⚠️ 이 값이 지금까지 발행한 카드·릴스의 색이다. 바꾸면 과거분과 어긋난다.
export const DEFAULT_PALETTE = {
  bg:        "#0d1117",   // 슬라이드 바탕
  panel:     "#161b22",   // 상단 크롬 바 · 통계/차트 블록
  line:      "#30363d",   // 경계선 · 차트 그리드
  text:      "#e6edf3",   // 본문
  dim:       "#9aa4b2",   // 보조 텍스트 · 라벨
  accent:    "#3fb950",   // 강조
  accentDim: "#238636",   // 배지 테두리
  onAccent:  "#04260f",   // 강조 배경 위에 얹는 글자색
  danger:    "#f85149",   // 나쁜 값(표 lo · 차트 bad)
  info:      "#58a6ff",   // 중립 곡선
  dots:      ["#ff5f56", "#ffbd2e", "#27c93f"],  // 터미널 신호등 3개
};

// ⚠️ 2026-10-07 정정: sans 첫 순위가 'Pretendard Variable' 이었는데 이 PC 에 설치된 적이 없다.
//    🔬 레지스트리 글꼴 389개에 0 · 크로미움에서 'Pretendard Variable', monospace 너비 = monospace 너비(800.0).
//    ▶ 지금까지 발행한 한글 sans 는 전부 대체 다음 순위 'Noto Sans KR' 로 그려졌다. 그 모양을 정본으로 고정한다
//    (사용자 결정 — 「Noto Sans KR 고정」). Pretendard 를 스택에 남겨두면 누가 설치하는 날 화면이 조용히 바뀐다.
//    🔬 스택만 바꾼 렌더 = 바꾸기 전과 스틸 10/10 바이트 동일(reels-one-command --stills) — Pretendard 가 한 번도 안 쓰였다는 세 번째 확인.
//    ▶ 시스템에 기대는 위험은 @font-face 가 아니라 assertFontsResolve() 게이트로 막는다(빠지면 렌더 전에 던진다).
//    ⛔ @font-face 로 파일을 거는 건 시험했고 뺐다 — 같은 파일인데 url()·local() 둘 다 스틸 2/10(01 termCard·05 limits)이
//       바뀌었다(잉크 중심 y 703→698). 변수 글꼴 굵기를 시스템 경로와 다르게 그린다. 「화면 안 바뀐다」가 사용자 결정의 조건이다.
export const DEFAULT_FONTS = {
  sans: "'Noto Sans KR', 'Malgun Gothic', sans-serif",
  mono: "'Cascadia Code', 'D2Coding', Consolas, monospace",
};

// 저장소에 같이 든 글꼴 사본 (Noto Sans KR 변수 글꼴 · SIL OFL 1.1 — 재배포 가능 · C:/Windows/Fonts 와 md5 같음).
// ▶ 다른 PC 에서 렌더하면 이 파일을 **시스템에 설치**한다(위 이유로 @font-face 아님). 안 깔려 있으면 게이트가 멈춘다.
export const FONT_FILES = {
  "Noto Sans KR": "assets/fonts/NotoSansKR-VF.ttf",
};

/**
 * 스택 첫 순위 글꼴이 실제로 그려지는지 렌더 페이지 안에서 잰다. 아니면 던진다.
 * ⛔ document.fonts.check() 로 판정하지 않는다 — 없는 글꼴에도 true 를 준다.
 * 판정: 그 글꼴 + 대체(monospace·serif) 너비가 대체 단독 너비와 둘 다 같으면 없는 것이다.
 */
export async function assertFontsResolve(page, fonts) {
  const fams = Object.entries(fonts).map(([k, v]) => [k, v.split(",")[0].trim().replace(/^['"]|['"]$/g, "")]);
  const bad = await page.evaluate(async (fams) => {
    await document.fonts.ready;
    const c = document.createElement("canvas").getContext("2d"), s = "ABCabc 가나다라 0123 모션";
    const w = (f) => { c.font = `64px ${f}`; return c.measureText(s).width; };
    const out = [];
    for (const [k, fam] of fams) {
      await document.fonts.load(`64px '${fam}'`, s).catch(() => {});
      if (w(`'${fam}', monospace`) === w("monospace") && w(`'${fam}', serif`) === w("serif")) out.push(`${k}: '${fam}'`);
    }
    return out;
  }, fams);
  if (!bad.length) return;
  const msg = `글꼴이 실제로 안 그려진다(대체 글꼴로 빠짐) — ${bad.join(" · ")}`;
  // 글꼴 사본이 저장소에 있으면(= 글꼴을 정본으로 고정한 우리 저장소) 멈춘다.
  // 공개 자료로 받은 사람에게는 사본이 없다 — 그 PC 에서는 대체 글꼴로 그려도 되므로 경고만 한다.
  const pinned = Object.values(FONT_FILES).some((f) => existsSync(new URL(f, import.meta.url)));
  if (pinned) throw new Error(`${msg}. ${Object.values(FONT_FILES).join(", ")} 를 시스템에 설치한다`);
  console.warn(`⚠️ ${msg} — 화면 글꼴이 달라질 수 있다. 같게 하려면 Noto Sans KR 을 설치한다(무료 · Google Fonts).`);
}

// ⚠️ 색은 반드시 `#rgb`/`#rrggbb`다 — 글로우와 표 강조는 이 값에서 rgba를 만들어
//    쓰기 때문에 `green`이나 `rgb(...)`를 넣으면 그 두 군데만 조용히 깨진다.
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// ⚠️ 오타 키를 조용히 무시하면 "고쳤는데 안 바뀐다"가 된다. 이미지라 눈으로도
//    안 잡히므로 렌더 단계에서 죽인다. 발행 뒤에 발견하면 늦다.
function mergeOverrides(defaults, override, label) {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(override ?? {})) {
    if (!(k in defaults)) {
      throw new Error(`meta.${label}에 모르는 키: "${k}" — 쓸 수 있는 키: ${Object.keys(defaults).join(", ")}`);
    }
    out[k] = v;
  }
  return out;
}

/** meta.palette / meta.fonts를 기본값 위에 얹고 검증해서 돌려준다. */
export function loadTheme(meta = {}) {
  const palette = mergeOverrides(DEFAULT_PALETTE, meta.palette, "palette");
  const fonts = mergeOverrides(DEFAULT_FONTS, meta.fonts, "fonts");

  for (const [k, v] of Object.entries(palette)) {
    if (k === "dots") {
      if (!Array.isArray(v) || v.length !== 3) {
        throw new Error(`meta.palette.dots는 색 3개 배열이어야 한다 (지금: ${JSON.stringify(v)})`);
      }
      v.forEach((c, i) => {
        if (!HEX.test(c)) throw new Error(`meta.palette.dots[${i}]가 16진 색이 아니다: ${JSON.stringify(c)}`);
      });
    } else if (!HEX.test(v)) {
      throw new Error(`meta.palette.${k}가 16진 색이 아니다: ${JSON.stringify(v)} — "#rgb" 또는 "#rrggbb"만 쓴다`);
    }
  }
  for (const [k, v] of Object.entries(fonts)) {
    if (typeof v !== "string" || !v.trim()) throw new Error(`meta.fonts.${k}는 비어 있지 않은 문자열이어야 한다`);
  }
  return { palette, fonts };
}

/**
 * 반투명 배경(글로우·표 강조)은 강조색에서 파생시킨다.
 * 따로 적어두면 accent만 바꿨을 때 그 자리만 옛 색으로 남는다.
 */
export function rgba(hex, a) {
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
