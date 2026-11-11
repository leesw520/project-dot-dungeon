// reference/reference_wireframes.html 26–36행 토큰, 38–50행 그리기 함수.
// 호출 모양을 유지해서 이후 화면을 같은 줄로 옮길 수 있게 한다.
import { requestRedraw } from "./frame";

export const C = {
  wood: "#854F0B",
  woodD: "#412402",
  woodL: "#BA7517",
  panelIn: "#5A3507",
  listRow: "#4A2B05",
  listRowSel: "#633806",
  night: "#042C53",
  floor: "#633806",
  floor2: "#71461A",
  hubFloor: "#71461A",
  hubFloor2: "#7A4C1C",
  dark: "#2C2C2A",
  screenBg: "#1F1F1E",
  cell: "#444441",
  cellExt: "#5F5E5A",
  cellLocked: "#2C2C2A",
  aura: "#85B7EB",
  hp: "#E24B4A",
  mp: "#378ADD",
  lim: "#EF9F27",
  allyBar: "#085041",
  foeBar: "#993C1D",
  foe: "#993C1D",
  txt: "#F1EFE8",
  sub: "#B4B2A9",
  gold: "#FAC775",
  good: "#97C459",
  node: "#7F77DD",
  tipBg: "#04342C",
  tipLine: "#5DCAA5",
  statusCtrl: "#AFA9EC",
  floorLoot: "#2A1A06",
  allyColors: ["#1D9E75", "#5DCAA5", "#378ADD", "#9FE1CB"] as const,
};

export const PIECE = {
  red: "#D85A30",
  blue: "#378ADD",
  green: "#639922",
  purple: "#7F77DD",
  amber: "#BA7517",
  steel: "#B4B2A9",
  crimson: "#E24B4A",
  yellow: "#BA7517",
  white: "#F1EFE8",
  black: "#4B3F8A",
} as const;

export const VIEW_W = 480;
export const VIEW_H = 270;

let ctx: CanvasRenderingContext2D | null = null;

export function bind(context: CanvasRenderingContext2D) {
  ctx = context;
  ctx.imageSmoothingEnabled = false;
}

/** paint 동안만 그리기 대상을 ctx로 바꾼다 (layerCache의 오프스크린 캔버스용). */
export function withPen(context: CanvasRenderingContext2D, paint: () => void) {
  const prev = ctx;
  ctx = context;
  try {
    paint();
  } finally {
    ctx = prev;
  }
}

export function pen(): CanvasRenderingContext2D {
  if (!ctx) throw new Error("bind(ctx) 전에 그릴 수 없다");
  return ctx;
}

function px(value: number) {
  return Math.round(value);
}

interface Extra {
  opacity: number | undefined;
  stroke: string | undefined;
  strokeWidth: number | undefined;
}
// 같은 ex 문자열은 매번 정규식을 돌리지 않는다. 투명도처럼 값이 계속 바뀌는 문자열이 쌓이지 않게 크기를 묶는다.
const extraCache = new Map<string, Extra>();

function parseExtra(ex: string): Extra {
  let e = extraCache.get(ex);
  if (!e) {
    if (extraCache.size > 512) extraCache.clear();
    e = parseExtraRaw(ex);
    extraCache.set(ex, e);
  }
  return e;
}

function parseExtraRaw(ex: string): Extra {
  const opacity = /opacity='([^']+)'/.exec(ex);
  const stroke = /stroke='([^']+)'/.exec(ex);
  const strokeWidth = /stroke-width='([^']+)'/.exec(ex);
  return {
    opacity: opacity ? Number(opacity[1]) : undefined,
    stroke: stroke?.[1],
    strokeWidth: strokeWidth ? Number(strokeWidth[1]) : undefined,
  };
}

/** 참조 R. ex는 SVG 속성 문자열(stroke, stroke-width, opacity) 그대로. */
export function R(x: number, y: number, w: number, h: number, fill: string, ex?: string) {
  const g = pen();
  const dx = px(x);
  const dy = px(y);
  const dw = px(w);
  const dh = px(h);
  if (!ex) {
    // 가장 흔한 경우(단색 채우기)는 save/restore 없이 바로 칠한다.
    if (fill && fill !== "none") {
      g.fillStyle = fill;
      g.fillRect(dx, dy, dw, dh);
    }
    return;
  }
  const extra = parseExtra(ex);
  g.save();
  if (extra.opacity != null) g.globalAlpha = extra.opacity;
  if (fill && fill !== "none") {
    g.fillStyle = fill;
    g.fillRect(dx, dy, dw, dh);
  }
  if (extra.stroke) {
    // 1.5px 선은 정수 칸으로 반올림한다. 서브픽셀 선은 확대하면 흐려진다.
    const t = Math.max(1, Math.round(extra.strokeWidth ?? 1));
    g.fillStyle = extra.stroke;
    g.fillRect(dx, dy, dw, t);
    g.fillRect(dx, dy + dh - t, dw, t);
    g.fillRect(dx, dy, t, dh);
    g.fillRect(dx + dw - t, dy, t, dh);
  }
  g.restore();
}

function fontFor(size: number) {
  return `${size}px ${size <= 7 ? "Galmuri9" : "Galmuri11"}, monospace`;
}

/** T()로 그렸을 때의 논리 폭. 줄바꿈 계산용. */
export function textWidth(s: string, sz?: number) {
  const g = pen();
  g.save();
  g.font = fontFor(sz || 8);
  const w = g.measureText(s).width;
  g.restore();
  return w;
}

/** maxW 안에 들어가게 잘라 끝에 …을 붙인다. 고정 칸에 쓰는 글자가 밖으로 삐져나가지 않게. */
export function fitText(s: string, maxW: number, sz?: number) {
  if (textWidth(s, sz) <= maxW) return s;
  let t = s;
  while (t.length && textWidth(t + "…", sz) > maxW) t = t.slice(0, -1);
  return t + "…";
}

/** 지름 2r 픽셀 원. 줄마다 1px 사각형으로 채워 경계가 흐려지지 않게 한다. half로 왼쪽/오른쪽 반만. */
export function disc(cx: number, cy: number, r: number, fill: string, half?: "left" | "right") {
  for (let dy = -r; dy < r; dy++) {
    const hw = Math.round(Math.sqrt(r * r - (dy + 0.5) * (dy + 0.5)));
    const x0 = half === "right" ? cx : cx - hw;
    const w = half ? hw : hw * 2;
    R(x0, cy + dy, w, 1, fill);
  }
}

const images = new Map<string, HTMLImageElement>();

/** 이미지가 다 불러와졌는가 (처음 부르면 불러오기 시작, 다 받으면 다시 그리기 요청) — 고정 레이어 캐시 키용 */
export function imgReady(src: string): boolean {
  let im = images.get(src);
  if (!im) {
    im = new Image();
    im.onload = requestRedraw;
    im.src = src;
    images.set(src, im);
  }
  return im.complete && im.naturalWidth > 0;
}

/** 이미지를 미리 불러 둔다 (2026-11-09: 시작할 때 거점·캐릭터 그림 — 화면에 들어간 뒤 자리표시가 보이지 않게). */
export function preloadImages(srcs: string[]) {
  srcs.forEach((s) => imgReady(s));
}

/** public/ 아래 이미지를 그린다. 처음 부르면 불러오기만 하고 false — 다 받아지면 다시 그리기를 요청해 그때부터 그려진다. */
export function img(x: number, y: number, w: number, h: number, src: string, alpha = 1, smooth = false): boolean {
  let im = images.get(src);
  if (!im) {
    im = new Image();
    im.onload = requestRedraw;
    im.src = src;
    images.set(src, im);
  }
  if (!im.complete || !im.naturalWidth) return false;
  const g = pen();
  if (alpha < 1) g.globalAlpha = alpha;
  if (smooth) {
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
  }
  g.drawImage(im, px(x), px(y), px(w), px(h));
  if (smooth) g.imageSmoothingEnabled = false;
  if (alpha < 1) g.globalAlpha = 1;
  return true;
}

const tinted = new Map<string, HTMLCanvasElement>();
/** 이미지 실루엣 테두리 (2026-11-09 거점 호버): 그림 모양을 color로 칠해 사방 t만큼 밀어 그린다. 그 위에 그림을 다시 그리면 테두리만 남는다. */
export function imgOutline(x: number, y: number, w: number, h: number, src: string, color: string, t = 1): boolean {
  const im = images.get(src);
  if (!im || !im.complete || !im.naturalWidth) return false;
  const key = `${src}|${color}`;
  let c = tinted.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    const g2 = c.getContext("2d")!;
    g2.drawImage(im, 0, 0);
    g2.globalCompositeOperation = "source-in";
    g2.fillStyle = color;
    g2.fillRect(0, 0, c.width, c.height);
    tinted.set(key, c);
  }
  const g = pen();
  g.imageSmoothingEnabled = true;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    g.drawImage(c, px(x + Math.cos(a) * t), px(y + Math.sin(a) * t), px(w), px(h));
  }
  g.imageSmoothingEnabled = false;
  return true;
}

/**
 * 고해상도 도트 게이지 (2026-11-08). 논리 좌표로 놓되, 칸은 화면 실제 화소 단위(2화소 칸 + 1화소 틈)로 잘게 그린다.
 * fills = [비율, 색] 순서대로 겹쳐 칠한다 (앞 것이 0~비율1, 다음 것이 비율1~비율2 …). 테두리는 1화소 어두운 선.
 */
export function gauge(x: number, y: number, w: number, h: number, fills: ReadonlyArray<readonly [number, string]>, empty = C.cell) {
  const g = pen();
  const S = g.getTransform().a || 1;
  const u = 1 / S; // 화면 1화소의 논리 길이
  g.fillStyle = "#120C04";
  g.fillRect(x, y, w, h);
  const ix = x + u, iy = y + u, iw = w - 2 * u, ih = h - 2 * u;
  // 화면 배율이 1이면 칸을 나누지 않는다 (1화소 칸+1화소 틈은 줄무늬로 탁해진다)
  const fine = S >= 2;
  const cellW = fine ? Math.max(1, Math.round(S * 0.67)) * u : iw, gap = fine ? u : 0, step = cellW + gap;
  const n = Math.max(1, Math.floor((iw + gap) / step));
  const used = n * step - gap, off = (iw - used) / 2;
  const cuts = fills.map(([f, c]) => [Math.max(0, Math.min(1, f)), c] as const);
  if (!fine) {
    // 연속 막대: 비율 구간마다 화소 단위로 칠한다
    let p = 0;
    g.fillStyle = empty;
    g.fillRect(ix, iy, iw, ih);
    for (const [cut, c] of cuts) {
      const e = Math.round(cut * iw * S) / S;
      if (e > p) { g.fillStyle = c; g.fillRect(ix + p, iy, e - p, ih); p = e; }
    }
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fillRect(ix, iy, iw, u);
    return;
  }
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / n; // 이 칸의 끝 비율
    let col = empty;
    let start = 0;
    for (const [cut, c] of cuts) {
      if (cut > start && t <= cut + 0.5 / n) { col = c; break; }
      start = Math.max(start, cut);
    }
    g.fillStyle = col;
    g.fillRect(ix + off + i * step, iy, cellW, ih);
  }
  // 윗줄 밝은 반사 (1화소)
  g.fillStyle = "rgba(255,255,255,0.18)";
  g.fillRect(ix, iy, iw, u);
}

/** 참조 T. y는 베이스라인. */
export function T(x: number, y: number, s: string, sz?: number, col?: string, anc?: "start" | "middle" | "end") {
  const g = pen();
  const size = sz || 8;
  const align = anc || "start";
  g.font = fontFor(size);
  g.fillStyle = col || C.txt;
  g.textAlign = align === "middle" ? "center" : align === "end" ? "right" : "left";
  g.textBaseline = "alphabetic";
  g.fillText(s, px(x), px(y));
}

/** 참조 W. 바깥 woodD, 안쪽 2px, 제목 띠 12px. */
export function W(x: number, y: number, w: number, h: number, title?: string, dark?: unknown) {
  R(x, y, w, h, C.woodD);
  R(x + 2, y + 2, w - 4, h - 4, dark ? C.night : C.panelIn);
  if (title) {
    R(x + 2, y + 2, w - 4, 12, C.woodL);
    T(x + 6, y + 11, title, 8, C.woodD);
  }
}

/** 참조 G. 칸 높이 6, 간격 1. i < aura 오라, i < hp HP, 나머지 빈칸. */
export function G(x: number, y: number, n: number, au: number, hp: number, cw?: number) {
  const width = cw || 4;
  for (let i = 0; i < n; i++) R(x + i * (width + 1), y, width, 6, i < au ? C.aura : i < hp ? C.hp : C.cell);
}

export function grid(x: number, y: number, cols: number, rows: number, cs: number, fill?: string) {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) R(x + c * cs, y + r * cs, cs - 2, cs - 2, fill || C.cell);
}

/** 참조 piece. 칸 위 2px는 흰색 35%. */
/** col: 한 색, 또는 칸마다 색 (cells와 같은 순서 — 칸별 속성 도트, docs/crafting.md 1장). */
export function piece(x: number, y: number, cs: number, cells: ReadonlyArray<readonly [number, number]>, col: string | readonly string[]) {
  cells.forEach(([c, r], i) => {
    R(x + c * cs, y + r * cs, cs - 2, cs - 2, typeof col === "string" ? col : col[i] ?? col[0]);
    R(x + c * cs, y + r * cs, cs - 2, 2, "#ffffff", "opacity='.35'");
  });
}

export interface SilhouetteEdge {
  side: "top" | "bottom" | "left" | "right";
  c: number;
  r: number;
  /** top/bottom: 오른쪽으로 이어진 칸 수. left/right: 아래로 이어진 칸 수. */
  len: number;
}

/**
 * 조각의 칸 하나하나가 아니라 "전체 실루엣" 윤곽선만 그린다 (구멍 안쪽 경계는 제외).
 * piece()가 실제로 칠하는 영역은 칸마다 (c*cs, r*cs, cs-2, cs-2) — 즉 왼쪽·위쪽은 격자선에
 * 붙고 오른쪽·아래쪽만 2px 줄어든다. 여기서도 똑같은 식을 써서 변마다 정확히 그 칠해진
 * 경계를 따라가게 한다. len>1인 구간은 칸 사이 2px 틈을 건너뛰어 한 번에 그어서,
 * 한 줄로 이어진 칸들이 테두리에서 끊기지 않고 계속 이어지게 한다.
 */
export function silhouette(x: number, y: number, cs: number, edges: ReadonlyArray<SilhouetteEdge>, color: string, opts?: { width?: number; alpha?: number; dash?: [number, number] }) {
  if (!edges.length) return;
  const g = pen();
  g.save();
  g.globalAlpha = opts?.alpha ?? 0.6;
  g.strokeStyle = color;
  g.lineWidth = opts?.width ?? 1;
  if (opts?.dash) g.setLineDash(opts.dash);
  g.beginPath();
  edges.forEach(({ side, c, r, len }) => {
    // piece()가 칠하는 실제 사각형: left=c*cs, top=r*cs, right=left+(cs-2), bottom=top+(cs-2).
    const left = x + c * cs;
    const top = y + r * cs;
    const span = (len - 1) * cs + (cs - 2); // 구간 전체 길이 (중간 틈 포함해서 한 번에)
    if (side === "top") {
      g.moveTo(left, top);
      g.lineTo(left + span, top);
    } else if (side === "bottom") {
      const edgeY = top + (cs - 2);
      g.moveTo(left, edgeY);
      g.lineTo(left + span, edgeY);
    } else if (side === "left") {
      g.moveTo(left, top);
      g.lineTo(left, top + span);
    } else {
      const edgeX = left + (cs - 2);
      g.moveTo(edgeX, top);
      g.lineTo(edgeX, top + span);
    }
  });
  g.stroke();
  g.setLineDash([]);
  g.restore();
}

export function btn(x: number, y: number, w: number, s: string, hl?: unknown) {
  R(x, y, w, 14, C.woodD);
  R(x + 1, y + 1, w - 2, 12, hl ? C.gold : C.woodL);
  T(x + w / 2, y + 10, s, 8, C.woodD, "middle");
}

export function charTabs() {
  ["전사", "도적", "마법사", "사제"].forEach((n, i) => {
    R(10 + i * 60, 6, 56, 18, i == 0 ? C.gold : C.woodL);
    R(14 + i * 60, 9, 12, 12, C.allyColors[i]);
    T(30 + i * 60, 19, n, 8, C.woodD);
  });
}

export function integerScale(width: number, height: number) {
  return Math.max(1, Math.min(Math.floor(width / VIEW_W), Math.floor(height / VIEW_H)));
}

export function logicalPoint(clientX: number, clientY: number, rect: DOMRect, scale: number) {
  return {
    x: Math.floor((clientX - rect.left) / scale),
    y: Math.floor((clientY - rect.top) / scale),
  };
}
