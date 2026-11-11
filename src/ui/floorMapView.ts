// 미니맵 큰 보기 — 층 하나의 구획 지도 (docs/exploration.md). 어느 화면이든 띄울 수 있는 재사용 컴포넌트.
// 지금은 D01 미니맵을 클릭해 열고, 나중에 거점에서 공략 지역을 확인할 때도 그대로 쓴다.
// 쓰는 법: const map = createFloorMapView(); map.open(층, 지금 구획?) → 열려 있는 동안 화면이 입력을 넘기고 draw를 부른다.
// 조작: 구획에 마우스 올리기 = 구획 정보, 구획 밖을 끌기 = 맵 이동, 휠 = 확대/축소, 우클릭·Esc·✕·창 밖 클릭 = 닫기.
// 공개 범위는 engine/exploreKnowledge.ts: known은 모양·정보, unknown은 ?, hidden은 안 그린다.
import type { DistrictDef, FloorDef } from "../data/dungeons";
import { GATHER_KINDS } from "../data/explore";
import { MONSTER_DB } from "../data/monsters";
import { districtVisibility, isDoorSeen, isEncountered, type DistrictVisibility } from "../engine/exploreKnowledge";
import { cached } from "../render/layerCache";
import type { LogicalPoint } from "../scenes/types";
import { C, R, T, W, btn, pen } from "../render/primitives";
import { drawTooltip, type TooltipContent } from "./tooltip";

const WIN = { x: 24, y: 20, w: 432, h: 230 };
const VIEW = { x: WIN.x + 6, y: WIN.y + 18, w: WIN.w - 12, h: WIN.h - 34 };
const CLOSE = { x: WIN.x + WIN.w - 22, y: WIN.y + 2, w: 18, h: 13 };
/** 칸 크기(px) 단계 — 확대/축소 한계 */
const ZOOMS = [2, 3, 4, 6, 8];
const ZOOM_START = 2;
/** 구획 하나가 차지하는 격자 폭 (칸). 가장 큰 구획 + 여백 */
const PITCH = 15;

const inRect = (p: LogicalPoint, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
const colsOf = (d: DistrictDef) => Math.max(...d.shape.map((l) => l.length));

/** 구획 툴팁: 큰 보기와 D01 작은 미니맵이 함께 쓴다. 공개 범위는 exploreKnowledge 규칙 그대로. */
export function districtTooltip(floor: FloorDef, d: DistrictDef, current?: string): TooltipContent {
  if (districtVisibility(floor, d.id) !== "known") return { title: "?", desc: "아직 들어가 본 적 없는 구획." };
  return {
    title: d.name,
    desc: d.habitat,
    sections: [
      { heading: "출현 가능한 적", lines: d.monsters.map((id) => (isEncountered(id) ? { text: MONSTER_DB[id].name } : { text: "? (조우한 적 없음)", color: C.sub })) },
      { heading: "채집지", lines: [{ text: d.gathers.length ? [...new Set(d.gathers.map((g) => GATHER_KINDS[g.kind].name))].join(", ") : "없음" }] },
    ],
    hint: d.id === current ? "지금 구획" : undefined,
  };
}

export function createFloorMapView() {
  let floor: FloorDef | null = null;
  let current: string | undefined;
  let zi = ZOOM_START;
  let panX = 0;
  let panY = 0;
  let mouse: LogicalPoint | null = null;
  let drag: { x: number; y: number; panX: number; panY: number } | null = null;

  const cellPx = () => ZOOMS[zi];
  const shown = () => floor!.districts.map((d) => ({ d, vis: districtVisibility(floor!, d.id) })).filter((e) => e.vis !== "hidden");

  /** 구획 왼쪽 위 화면 좌표. 격자 칸 가운데에 구획을 놓는다. */
  function rectOf(d: DistrictDef) {
    const cs = cellPx(), rows = d.shape.length, cols = colsOf(d);
    return {
      x: panX + d.pos[0] * PITCH * cs + Math.floor(((PITCH - cols) * cs) / 2),
      y: panY + d.pos[1] * PITCH * cs + Math.floor(((PITCH - rows) * cs) / 2),
      w: cols * cs,
      h: rows * cs,
    };
  }

  function centerOn(d: DistrictDef) {
    const cs = cellPx();
    panX = VIEW.x + VIEW.w / 2 - Math.round((d.pos[0] + 0.5) * PITCH * cs);
    panY = VIEW.y + VIEW.h / 2 - Math.round((d.pos[1] + 0.5) * PITCH * cs);
  }

  /** 보이는 구획 묶음이 창 밖으로 멀리 달아나지 않게 묶는다 */
  function clampPan() {
    const list = shown();
    if (!list.length) return;
    const cs = cellPx(), span = PITCH * cs;
    const xs = list.map((e) => e.d.pos[0]), ys = list.map((e) => e.d.pos[1]);
    const minX = Math.min(...xs) * span, maxX = (Math.max(...xs) + 1) * span;
    const minY = Math.min(...ys) * span, maxY = (Math.max(...ys) + 1) * span;
    const m = 40; // 최소한 이만큼은 창 안에 남긴다
    panX = Math.round(Math.max(VIEW.x + m - maxX, Math.min(VIEW.x + VIEW.w - m - minX, panX)));
    panY = Math.round(Math.max(VIEW.y + m - maxY, Math.min(VIEW.y + VIEW.h - m - minY, panY)));
  }

  function districtAt(p: LogicalPoint) {
    if (!inRect(p, VIEW)) return null;
    for (const { d, vis } of shown()) {
      const r = rectOf(d);
      if (!inRect(p, r)) continue;
      if (vis === "unknown") return d;
      const c = Math.floor((p.x - r.x) / cellPx()), l = d.shape[Math.floor((p.y - r.y) / cellPx())];
      if (l && l[c] && l[c] !== " ") return d;
    }
    return null;
  }

  function open(f: FloorDef, cur?: string) {
    floor = f;
    current = cur;
    zi = ZOOM_START;
    drag = null;
    const focus = f.districts.find((d) => d.id === cur) ?? shown()[0]?.d;
    if (focus) centerOn(focus);
    clampPan();
  }
  function close() {
    floor = null;
    drag = null;
  }

  function drawDistrict(d: DistrictDef, vis: DistrictVisibility) {
    const r = rectOf(d), cs = cellPx();
    const rows = d.shape.length, cols = colsOf(d);
    const isCur = d.id === current;
    if (vis === "unknown") {
      R(r.x, r.y, r.w, r.h, "#2A2622", `stroke='${C.cellExt}' stroke-width='1'`);
      T(r.x + r.w / 2, r.y + r.h / 2 + 4, "?", cs >= 4 ? 16 : 10, C.sub, "middle");
      return;
    }
    // 모양은 구획·배율·강조가 같으면 그대로 붙인다
    cached(`fmv:${d.id}:${cs}:${isCur ? 1 : 0}`, r.x - 1, r.y - 1, r.w + 2, r.h + 2, () => {
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        if ((d.shape[y][x] ?? " ") === " ") continue;
        R(r.x + x * cs - 1, r.y + y * cs - 1, cs + 2, cs + 2, isCur ? C.gold : "#000000");
      }
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const ch = d.shape[y][x] ?? " ";
        if (ch !== " ") R(r.x + x * cs, r.y + y * cs, cs, cs, ch === "#" ? "#5F5E5A" : d.color);
      }
    });
    if (cs >= 4) T(r.x + r.w / 2, r.y + r.h / 2 + 3, d.name, 7, C.txt, "middle");
    if (d.stairs) R(r.x + (d.stairs.cell[0] - 0.5) * cs, r.y + (d.stairs.cell[1] - 1) * cs, cs * 2, cs, "#0b0b0a");
  }

  function drawLinks() {
    const list = shown();
    const cs = cellPx();
    list.forEach(({ d }) => d.doors.forEach((door) => {
      const t = list.find((e) => e.d.id === door.to);
      if (!t || !(isDoorSeen(d.id, door.to) || isDoorSeen(door.to, d.id))) return;
      const a = rectOf(d), b = rectOf(t.d);
      const ax = a.x + Math.floor(a.w / 2), ay = a.y + Math.floor(a.h / 2), bx = b.x + Math.floor(b.w / 2), by = b.y + Math.floor(b.h / 2);
      const w = Math.max(2, cs >> 1);
      R(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax) + w, Math.abs(by - ay) + w, C.cellExt);
    }));
  }

  function draw() {
    if (!floor) return;
    R(0, 0, 480, 270, "#000000", "opacity='.55'");
    W(WIN.x, WIN.y, WIN.w, WIN.h, `미니맵 · ${floor.name}`, 1);
    btn(CLOSE.x, CLOSE.y, CLOSE.w, "X", mouse != null && inRect(mouse, CLOSE));
    R(VIEW.x, VIEW.y, VIEW.w, VIEW.h, "#0E0D0B");
    const g = pen();
    g.save();
    g.beginPath();
    g.rect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    g.clip();
    drawLinks();
    shown().forEach(({ d, vis }) => drawDistrict(d, vis));
    const hov = mouse && !drag ? districtAt(mouse) : null;
    if (hov) {
      const r = rectOf(hov);
      R(r.x - 2, r.y - 2, r.w + 4, r.h + 4, "none", `stroke='${C.txt}' stroke-width='1'`);
    }
    g.restore();
    T(WIN.x + 8, WIN.y + WIN.h - 5, "구획에 올리면 정보 · 빈 곳 끌기 이동 · 휠 확대/축소 · Esc 닫기", 6, C.sub);
    if (hov && mouse) drawTooltip(mouse.x, mouse.y, districtTooltip(floor, hov, current));
  }

  return {
    open,
    close,
    draw,
    get active() {
      return floor !== null;
    },
    onPointerDown(p: LogicalPoint, button: number) {
      mouse = p;
      if (button === 2 || inRect(p, CLOSE) || !inRect(p, WIN)) return close();
      if (inRect(p, VIEW) && !districtAt(p)) drag = { x: p.x, y: p.y, panX, panY };
    },
    onPointerMove(p: LogicalPoint) {
      mouse = p;
      if (!drag) return;
      panX = drag.panX + p.x - drag.x;
      panY = drag.panY + p.y - drag.y;
      clampPan();
    },
    onPointerUp() {
      drag = null;
    },
    /** 커서 아래 지점을 고정한 채 확대/축소 */
    onWheel(dy: number) {
      const next = Math.max(0, Math.min(ZOOMS.length - 1, zi + (dy > 0 ? -1 : 1)));
      if (next === zi) return;
      const ax = mouse && inRect(mouse, VIEW) ? mouse.x : VIEW.x + VIEW.w / 2;
      const ay = mouse && inRect(mouse, VIEW) ? mouse.y : VIEW.y + VIEW.h / 2;
      const k = ZOOMS[next] / ZOOMS[zi];
      panX = Math.round(ax - (ax - panX) * k);
      panY = Math.round(ay - (ay - panY) * k);
      zi = next;
      clampPan();
    },
    onKeyDown(key: string) {
      if (key === "Escape") close();
    },
  };
}
