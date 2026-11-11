// 스킬 이펙트 (2026-11-07 샘플). 도트 프레임 애니메이션 — 그림 파일 없이 1px 사각형으로 그린다.
// 번개는 "번쩍임 → 가지 → 화면 섬광 → 굵은 줄기 → 흩어짐" 13프레임 (45ms). 나머지는 같은 틀의 짧은 연출.
// 사용: const fx = createFx(); fx.spawn("bolt", x, y) → 매 프레임 fx.tick(dt), fx.draw(). busy()면 isAnimating.
import { R } from "./primitives";

export type FxKind = "bolt" | "fire" | "frost" | "wind" | "slash" | "prism" | "hit";

interface Fx { kind: FxKind; x: number; y: number; t: number; seed: number; path: [number, number][] }

const FRAME = 45;
const DUR: Record<FxKind, number> = { bolt: 13, fire: 12, frost: 11, wind: 10, slash: 8, prism: 16, hit: 6 };

/** 같은 시드면 같은 모양 (재생 중 모양이 흔들리지 않게) */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** 1px 선 (브레젠햄) */
function line(x0: number, y0: number, x1: number, y1: number, col: string, w = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    R(x0 - (w > 1 ? 1 : 0), y0, w, 1, col);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function polyline(pts: [number, number][], upto: number, col: string, w = 1) {
  for (let i = 1; i < Math.min(pts.length, upto + 1); i++) line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], col, w);
}

/** 둥근 빛 (가장자리 옅게 → 가운데 진하게, 3겹) */
function glow(cx: number, cy: number, r: number, col: string, a = 0.5) {
  for (const [k, op] of [[1, a * 0.35], [0.66, a * 0.6], [0.33, a]] as const) {
    const rr = Math.max(1, Math.round(r * k));
    for (let dy = -rr; dy <= rr; dy++) {
      const hw = Math.round(Math.sqrt(rr * rr - dy * dy));
      R(cx - hw, cy + dy, hw * 2 + 1, 1, col, `opacity='${op.toFixed(2)}'`);
    }
  }
}

/** 위에서 대상까지 지그재그 경로 */
function boltPath(x: number, y: number, seed: number, h = 72): [number, number][] {
  const r = rng(seed);
  const pts: [number, number][] = [];
  let cx = x + Math.round((r() - 0.5) * 10);
  for (let yy = y - h; yy < y; yy += 6) {
    pts.push([cx, yy]);
    cx += Math.round((r() - 0.5) * 9);
    cx = Math.max(x - 8, Math.min(x + 8, cx));
  }
  pts.push([x, y]);
  return pts;
}

const BOLT = { dark: "#1f6fa8", mid: "#2fb7e8", hi: "#9ff0ff", core: "#ffffff" };

function drawBolt(f: Fx, fr: number) {
  const p = f.path, n = p.length - 1;
  if (fr <= 5) {
    // 1~6: 위에서부터 자라며 깜빡인다 (짝수 프레임만 보임)
    if (fr % 2 === 0) polyline(p, Math.ceil(((fr + 2) / 6) * n), BOLT.mid);
  } else if (fr === 6) polyline(p, n, BOLT.hi);
  else if (fr === 7) {
    // 섬광: 대상 둘레를 밝게
    glow(f.x, f.y - 8, 22, BOLT.hi, 0.7);
    polyline(p, n, BOLT.mid, 3);
    polyline(p, n, BOLT.core);
  } else if (fr <= 10) {
    // 굵은 줄기 + 꺾인 곳 번짐 + 발밑 불꽃
    if (fr === 8) glow(f.x, f.y - 4, 12, BOLT.mid, 0.5);
    polyline(p, n, fr === 9 ? BOLT.mid : BOLT.dark, 3);
    polyline(p, n, fr === 9 ? BOLT.core : BOLT.hi);
    p.forEach(([x, y], i) => { if (i % 3 === 1) R(x - 1, y - 1, 3, 2, BOLT.hi); });
    const r = rng(f.seed + fr);
    for (let k = 0; k < 6; k++) R(f.x + Math.round((r() - 0.5) * 14), f.y - Math.round(r() * 4), 1, 1, BOLT.hi);
  } else {
    // 흩어짐: 경로를 따라 점만 남았다가 사라진다
    const r = rng(f.seed + fr);
    const keep = fr === 11 ? 0.45 : 0.2;
    p.forEach(([x, y]) => { if (r() < keep) R(x + Math.round((r() - 0.5) * 3), y, 1, 1 + (r() < 0.3 ? 1 : 0), BOLT.mid); });
  }
}

const FIRE = ["#fff3a0", "#ffd04a", "#ff8a2a", "#e0402a", "#7a2a20", "#3a1a18"];
function drawFire(f: Fx, fr: number) {
  const r = rng(f.seed);
  const rad = 3 + fr * 2;
  // 불꽃 덩어리: 가운데에서 퍼지며 색이 식는다
  for (let k = 0; k < 40; k++) {
    const a = r() * Math.PI * 2, d = r() * rad;
    const ci = Math.min(FIRE.length - 1, Math.floor((d / rad) * 2 + fr / 3));
    R(f.x + Math.round(Math.cos(a) * d), f.y - 10 + Math.round(Math.sin(a) * d * 0.7), 2, 2, FIRE[ci]);
  }
  // 위로 오르는 불티
  for (let k = 0; k < 8; k++) R(f.x + Math.round((r() - 0.5) * 20), f.y - 10 - fr * 2 - Math.round(r() * 10), 1, 1, FIRE[Math.min(5, 1 + (fr >> 2))]);
}

function drawBurst(f: Fx, fr: number, cols: string[], shards: number) {
  const r = rng(f.seed);
  const len = 3 + fr * 2;
  for (let k = 0; k < shards; k++) {
    const a = (k / shards) * Math.PI * 2 + r() * 0.4;
    const x0 = f.x + Math.cos(a) * fr * 1.5, y0 = f.y - 12 + Math.sin(a) * fr * 1.5;
    line(x0, y0, x0 + Math.cos(a) * len * 0.5, y0 + Math.sin(a) * len * 0.5, cols[Math.min(cols.length - 1, fr >> 2)]);
  }
  if (fr < 3) R(f.x - 3, f.y - 15, 6, 6, cols[0]);
}

function drawWind(f: Fx, fr: number) {
  // 휘감는 바람: 세 겹 호(앞 밝게, 꼬리 옅게)가 돌며 좁아지고, 잎사귀가 함께 돈다
  const fade = fr > 6 ? (fr - 6) / 4 : 0;
  for (let k = 0; k < 3; k++) {
    const rad = 16 - k * 4 - fr * 0.6;
    for (let a = 0; a < 2.2; a += 0.08) {
      const ang = a + fr * 0.7 + k * 2.1;
      const col = a > 1.7 ? "#ffffff" : a > 0.9 ? "#cfffbf" : "#7fbf6a";
      if (a < 0.9 && (a * 25) % 2 < 1 - fade) continue;
      if (fade && a < fade * 2.2) continue;
      R(f.x + Math.round(Math.cos(ang) * rad), f.y - 14 + Math.round(Math.sin(ang) * rad * 0.45), a > 1.2 ? 2 : 1, 1, col);
    }
  }
  const r = rng(f.seed);
  for (let k = 0; k < 4; k++) {
    const ang = r() * 6.28 + fr * 0.8, rad = 8 + r() * 10;
    const lx = f.x + Math.round(Math.cos(ang) * rad), ly = f.y - 14 + Math.round(Math.sin(ang) * rad * 0.45) - fr;
    R(lx, ly, 2, 1, "#5fae4a"); R(lx + 1, ly - 1, 1, 1, "#8fd06a");
  }
}

function drawSlash(f: Fx, fr: number) {
  // 초승달 베기: 3프레임에 호를 긋고(가운데가 굵다), 이후 시작점부터 지워지며 끝에 불티
  const cx = f.x + 2, cy = f.y - 16, rad = 13, a0 = -2.5, a1 = 0.7;
  const head = Math.min(1, (fr + 1) / 3), tail = fr < 3 ? 0 : Math.min(1, (fr - 2) / 4);
  for (let u = tail; u <= head; u += 0.02) {
    const a = a0 + (a1 - a0) * u, th = Math.max(1, Math.round(Math.sin(Math.PI * u) * 3.5 * (1 - tail * 0.6)));
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let d = 0; d < th; d++) R(Math.round(cx + ca * (rad - d)), Math.round(cy + sa * (rad - d)), 1, 1, d === 0 ? "#9fd0ff" : "#ffffff");
    R(Math.round(cx + ca * (rad + 1)), Math.round(cy + sa * (rad + 1)), 1, 1, "#4f8fd0");
  }
  if (fr >= 2 && fr <= 5) {
    const r = rng(f.seed + fr), ex = cx + Math.cos(a1) * rad, ey = cy + Math.sin(a1) * rad;
    for (let k = 0; k < 4; k++) R(Math.round(ex + (r() - 0.3) * (fr * 3)), Math.round(ey + (r() - 0.5) * (fr * 3)), 1, 1, "#ffffff");
  }
}

const PRISM = ["#d0463a", "#3fb0d0", "#5fae4a", "#e8c04a"];
function drawPrism(f: Fx, fr: number) {
  // 4원소가 모였다가 한 점에서 터진다
  if (fr < 8) {
    PRISM.forEach((c, k) => {
      const a = (k / 4) * Math.PI * 2 + fr * 0.6, d = 26 - fr * 3;
      R(f.x + Math.round(Math.cos(a) * d) - 1, f.y - 14 + Math.round(Math.sin(a) * d * 0.6) - 1, 3, 3, c);
    });
  } else if (fr === 8) { glow(f.x, f.y - 14, 26, "#ffffff", 0.85); PRISM.forEach((c, k) => glow(f.x + [-6, 6, 0, 0][k], f.y - 14 + [0, 0, -6, 6][k], 6, c, 0.6)); }
  else {
    const k = fr - 8;
    PRISM.forEach((c, i) => {
      for (let a = 0; a < Math.PI * 2; a += 0.25) {
        const d = k * 4 + i * 2;
        R(f.x + Math.round(Math.cos(a + i) * d), f.y - 14 + Math.round(Math.sin(a + i) * d * 0.6), 1, 1, c);
      }
    });
  }
}

const HIT = ["#ffffff", "#fff6b0", "#ffc850", "#f07830", "#a04020"];
function drawHit(f: Fx, fr: number) {
  // 타격: 마름모 섬광 → 8방향 충격선이 밖으로 퍼지며 식는다
  const cx = f.x, cy = f.y - 14;
  if (fr <= 1) {
    const r = 3 - fr;
    for (let dy = -r; dy <= r; dy++) R(cx - (r - Math.abs(dy)), cy + dy, (r - Math.abs(dy)) * 2 + 1, 1, HIT[fr]);
  }
  const col = HIT[Math.min(HIT.length - 1, fr)];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2, near = 2 + fr * 3, far = near + (k % 2 ? 2 : 4) - Math.floor(fr / 2);
    if (far > near) line(cx + Math.cos(a) * near, cy + Math.sin(a) * near, cx + Math.cos(a) * far, cy + Math.sin(a) * far, col);
  }
}

export function createFx() {
  let list: Fx[] = [];
  let seq = 1;
  return {
    /** (x, y) = 대상 발밑 가운데 */
    spawn(kind: FxKind, x: number, y: number, delay = 0) {
      const seed = (seq++ * 7919) >>> 0;
      list.push({ kind, x, y, t: -delay, seed, path: kind === "bolt" ? boltPath(x, y - 6, seed) : [] });
    },
    tick(dt: number) {
      list.forEach((f) => (f.t += dt));
      list = list.filter((f) => f.t < DUR[f.kind] * FRAME);
    },
    draw() {
      for (const f of list) {
        if (f.t < 0) continue;
        const fr = Math.floor(f.t / FRAME);
        if (f.kind === "bolt") drawBolt(f, fr);
        else if (f.kind === "fire") drawFire(f, fr);
        else if (f.kind === "frost") drawBurst(f, fr, ["#ffffff", "#bfefff", "#6fbfe8"], 10);
        else if (f.kind === "wind") drawWind(f, fr);
        else if (f.kind === "slash") drawSlash(f, fr);
        else if (f.kind === "prism") drawPrism(f, fr);
        else drawHit(f, fr);
      }
    },
    busy: () => list.length > 0,
    clear: () => (list = []),
  };
}

/** 행동 → 이펙트 종류 (원소·피해 종류로 고른다) */
export function fxOf(a: { dmgType?: string; element?: string; elemAll?: boolean }): FxKind | null {
  if (a.elemAll) return "prism";
  if (a.dmgType === "magic") return a.element === "yellow" ? "bolt" : a.element === "red" ? "fire" : a.element === "blue" ? "frost" : a.element === "green" ? "wind" : "hit";
  if (a.dmgType === "physical") return "slash";
  return null;
}
