// 거점 시설 — 레벨과 놓인 터로 관리한다 (docs/screens.md H01). 레벨별 이름/이미지/기능 해금은 나중에 이 레벨 값을 보고
// 갈아끼우면 된다 (지금은 숫자만).
// 터 (2026-11-09 개편): 고정 배경 그림(public/hub/hub_bg.webp, 원본 art_src/hub)에 그려진 부지 11곳(S01~S11)에만 짓는다.
// 흙터·목재 받침 9곳은 어느 시설이든, 가운데 돌 광장(S10)은 전송장치 전용, 강변(S11)은 낚시터 전용.
// (2026-11-09) 지금은 건설·업그레이드를 막고 모든 시설을 지어진 상태로 둔다 (START). 업그레이드는 나중에 시설 안에서.
// 던전 게이트는 배경에 그려진 고정 건물 (왼쪽 위). 지은 건물은 무료로 다른 터에 옮긴다 (건물이 있으면 맞바꿈).
import { warehouseCount, warehouseRemove } from "./inventory";
import { PIECES } from "./pieces";
import type { Category } from "./itemTaxonomy";
import { registerSave } from "../engine/save";

export interface FacilityDef {
  id: string;
  name: string;
  /** 비용에 목재·석재와 함께 쓰는 시설 특색 카테고리 (MAT_COST) */
  flavor: Category;
  maxLevel: number;
  /** 옮길 수 없는 시설 */
  fixed?: boolean;
  /** 거점에 짓지 않는 시설 (그림이 없어 2026-11-09 빼 둠) */
  hidden?: boolean;
}

export const FACILITIES: FacilityDef[] = [
  { id: "workshop", name: "작업대", flavor: "금속", maxLevel: 3 },
  { id: "warehouse", name: "창고", flavor: "실소재", maxLevel: 3 },
  { id: "gate", name: "던전 게이트", flavor: "원석", maxLevel: 1, fixed: true },
  { id: "forge", name: "대장간", flavor: "광석", maxLevel: 3 },
  { id: "alchemy", name: "연금술 공방", flavor: "약재료", maxLevel: 3 },
  { id: "shrine", name: "신전", flavor: "원석", maxLevel: 3, hidden: true }, // 그림이 없어 거점에서 뺐다 (H05는 dev 탭으로만)
  { id: "archive", name: "기록 보관소", flavor: "실소재", maxLevel: 3 },
  { id: "herb", name: "약초밭", flavor: "식물", maxLevel: 3 },
  { id: "trade", name: "교역소", flavor: "동물소재", maxLevel: 3 },
  { id: "portal", name: "전송장치", flavor: "원소", maxLevel: 3 },
  { id: "kitchen", name: "취사장", flavor: "식재료", maxLevel: 3 },
  { id: "fishing", name: "낚시터", flavor: "어패류", maxLevel: 3 }, // 2026-11-09: 강변 S11 전용
];
export const facilityDef = (id: string) => FACILITIES.find((f) => f.id === id);

export interface Plot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "land" | "deck" | "plaza" | "river" | "gate";
  /** 이 시설만 지을 수 있다 (없으면 아무 시설) */
  only?: string[];
  /** 아직 지을 수 없는 터: 이유 */
  locked?: string;
}
/** 부지 = 배경 그림의 흙터 영역 (art_src/hub/maps/hub_placements.json game_bbox, 480×270). 마지막은 던전 게이트(배경 고정). */
const S = (id: string, x0: number, y0: number, x1: number, y1: number, kind: Plot["kind"], more: Partial<Plot> = {}): Plot => ({ id, x: x0, y: y0, w: x1 - x0, h: y1 - y0, kind, ...more });
export const PLOTS: Plot[] = [
  S("S01", 164, 30, 233, 84, "land"),
  S("S02", 254, 20, 317, 82, "deck"),
  S("S03", 323, 27, 395, 84, "land"),
  S("S04", 46, 108, 127, 162, "land"),
  S("S05", 294, 108, 395, 164, "land"),
  S("S06", 43, 181, 113, 234, "land"),
  S("S07", 129, 186, 193, 230, "deck"),
  S("S08", 224, 180, 298, 234, "land"),
  S("S09", 332, 181, 400, 234, "land"),
  S("S10", 182, 113, 249, 156, "plaza", { only: ["portal"] }),
  S("S11", 396, 173, 478, 248, "river", { only: ["fishing"] }),
  S("GATE", 42, 16, 124, 78, "gate"),
];
export const GATE_PLOT = PLOTS.length - 1;

/** 이 터에 이 시설을 놓을 수 없는 이유 (없으면 null). */
export function plotBlock(id: string, plot: number): string | null {
  const p = PLOTS[plot];
  if (!p || plot === GATE_PLOT) return "지을 수 없는 자리";
  if (p.locked) return p.locked;
  if (p.only && !p.only.includes(id)) return `광장에는 ${p.only.map((x) => facilityDef(x)!.name).join("·")}만 지을 수 있다`;
  if (id === "portal" && !p.only?.includes(id)) return "전송장치는 가운데 돌 광장에만 지을 수 있다";
  if (id === "fishing" && !p.only?.includes(id)) return "낚시터는 강변에만 지을 수 있다";
  return null;
}

/** 건물 그림 (public/hub/<file>.png), iw·ih = 원본 크기. 그림 비율은 바꾸지 않는다 (2026-11-09 사용자).
 *  - 흙터·목재 받침: 부지 네모(귀퉁이 말뚝이 꼭짓점)가 안 보이게 가로세로 같은 비율로 키워 덮는다. 가로 가운데·부지 바닥에 붙여 위로 솟는다.
 *  - 돌 광장(S10, 전송장치): 돌 원 가운데에 받침이 오게 놓는다 (크기는 패키지 배치 높이 48.8).
 *  그림이 없는 시설은 거점에 짓지 않는다 (hidden). */
/** dx = 그림만 옆으로 미는 양 (논리 px, 2026-11-09 사용자: 취사장 조금 오른쪽) */
export const HUB_ART: Record<string, { file: string; iw: number; ih: number; dx?: number }> = {
  workshop: { file: "workshop", iw: 212, ih: 172 },
  archive: { file: "archive", iw: 202, ih: 209 },
  forge: { file: "blacksmith", iw: 222, ih: 219 },
  alchemy: { file: "alchemy_lab", iw: 206, ih: 200 },
  warehouse: { file: "storage", iw: 200, ih: 174 },
  trade: { file: "trading_post", iw: 197, ih: 220 },
  herb: { file: "herb_garden", iw: 160, ih: 206 },
  portal: { file: "teleport_portal", iw: 159, ih: 220 },
  kitchen: { file: "kitchen", iw: 209, ih: 265, dx: 6 },
  fishing: { file: "fishing_dock_river_overlay", iw: 323, ih: 290 },
};
export const hubArtSrc = (file: string) => `${import.meta.env.BASE_URL}hub/${file}.png`;
export const HUB_BG = `${import.meta.env.BASE_URL}hub/hub_bg.webp`;
/** 거점 그림 전부 (시작할 때 미리 불러온다) */
export const hubImages = () => [HUB_BG, ...Object.values(HUB_ART).map((a) => hubArtSrc(a.file))];
/** 부지를 덮을 때 바닥을 부지 아래로 내리는 양 (아래 말뚝까지 가리게) */
const COVER_DROP = 2;
const PLAZA = { h: 48.8, foot: 0.16 }; // 받침(그림 아래 16%) 가운데가 원 가운데
const RIVER_BOX = [397.608, 171.583, 79.522, 73.454] as const; // building_positions.csv fishing_dock
/** 이 터에 놓인 건물 그림의 자리 */
export function artRect(id: string, plot: number) {
  const p = PLOTS[plot], a = HUB_ART[id];
  if (!a) return { x: p.x + 6, y: p.y + 8, w: p.w - 12, h: p.h - 12 };
  if (p.kind === "river") {
    // 강변: 패키지 배치 칸 그대로 (강 그림과 맞물리게), 칸 안에 비율 유지
    const [bx, by, bw, bh] = RIVER_BOX;
    const k = Math.min(bw / a.iw, bh / a.ih), w = a.iw * k, h = a.ih * k;
    return { x: bx + (bw - w) / 2, y: by + bh - h, w, h };
  }
  if (p.kind === "plaza") {
    const h = PLAZA.h, w = (a.iw / a.ih) * h;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    return { x: cx - w / 2, y: cy + h * PLAZA.foot - h, w, h };
  }
  const k = Math.max(p.w / a.iw, (p.h + COVER_DROP) / a.ih);
  const w = a.iw * k, h = a.ih * k;
  return { x: p.x + (p.w - w) / 2 + (a.dx ?? 0), y: p.y + p.h + COVER_DROP - h, w, h };
}

const levels = new Map<string, number>();
/** 시설 id → 터 번호. 레벨 1 이상인 시설만 있다. */
const plotOf = new Map<string, number>();
const plotIdx = (id: string) => PLOTS.findIndex((p) => p.id === id);
/** 처음부터 지어진 시설 (2026-11-09: 건설을 막고 전부 지어 둔다). S02는 비워 둔다 (맞는 시설 없음). */
const START: [string, string][] = [
  ["workshop", "S01"], ["archive", "S03"], ["forge", "S04"], ["alchemy", "S05"], ["warehouse", "S06"], ["trade", "S07"],
  ["kitchen", "S08"], ["herb", "S09"], ["portal", "S10"], ["fishing", "S11"], ["gate", "GATE"],
];
/** 건설·업그레이드를 막아 둔 동안: 세이브에 없던 START 시설도 지은 상태로 */
function ensureStart() {
  for (const [id, pid] of START) {
    if (!levels.get(id)) levels.set(id, 1);
    if (plotOf.has(id)) continue;
    const i = plotIdx(pid);
    if (!facilityAt(i)) plotOf.set(id, i);
  }
  seatHomeless();
}
function resetLayout() {
  levels.clear();
  plotOf.clear();
  START.forEach(([id, p]) => {
    levels.set(id, 1);
    plotOf.set(id, plotIdx(p));
  });
}
resetLayout();
/** 터가 없는 지은 시설(옛 세이브)을 빈 터에 앉힌다 */
function seatHomeless() {
  for (const [id, n] of levels) {
    if (n <= 0 || plotOf.has(id) || facilityDef(id)?.hidden) continue;
    const free = PLOTS.findIndex((_, i) => !plotBlock(id, i) && !facilityAt(i));
    if (free >= 0) plotOf.set(id, free);
  }
}

registerSave(
  "facilities3", // 2026-11-09 고정 배경 11터 개편 (터는 "S01" 같은 이름으로 저장)
  () => ({ levels: Object.fromEntries(levels), plots: Object.fromEntries([...plotOf].map(([k, i]) => [k, PLOTS[i].id])) }),
  (v) => {
    const d = v as { levels: Record<string, number>; plots: Record<string, string> };
    resetLayout();
    Object.entries(d.levels).forEach(([k, n]) => facilityDef(k) && levels.set(k, n));
    plotOf.clear();
    plotOf.set("gate", GATE_PLOT);
    levels.set("gate", Math.max(1, levels.get("gate") ?? 1));
    Object.entries(d.plots ?? {}).forEach(([k, pid]) => {
      const i = plotIdx(pid);
      if (k !== "gate" && facilityDef(k) && !facilityDef(k)!.hidden && i >= 0 && !plotBlock(k, i) && !facilityAt(i)) plotOf.set(k, i);
    });
    ensureStart();
  }
);
registerSave(
  "facilities2", // 옛 7×5 격자 세이브: 터 번호는 버리고 레벨만 가져와 빈 터에 앉힌다 (새로 저장하지 않음)
  () => undefined,
  (v) => {
    const d = v as { levels?: Record<string, number> } | undefined;
    if (!d?.levels) return;
    Object.entries(d.levels).forEach(([k, n]) => facilityDef(k) && n > (levels.get(k) ?? 0) && levels.set(k, n));
    ensureStart();
  }
);

export function getLevel(id: string) {
  return levels.get(id) ?? 0;
}

export const plotIndexOf = (id: string) => plotOf.get(id) ?? -1;
/** 이 터에 놓인 시설 id (없으면 null). */
export function facilityAt(plot: number): string | null {
  for (const [id, p] of plotOf) if (p === plot) return id;
  return null;
}
/** 아직 짓지 않은 시설 */
export const unbuilt = () => FACILITIES.filter((f) => getLevel(f.id) === 0 && !f.hidden);

// ---- 건설·업그레이드 비용 = 정해진 소재 아이템 (2026-11-08 2차, docs/screens.md H01 비용) ----
// 화면에는 아이템 이름으로 보인다 ("나뭇가지 4"). 하급·중급 같은 등급 분류는 설계용일 뿐 게임에 드러내지 않는다.
// Lv1(짓기) 나뭇가지·동굴 돌멩이 (B1F) / Lv2 튼튼한 통나무(B2F~) + 시설 특색 소재 / Lv3 튼튼한 통나무 + 고대 석주 조각(B4F~) + 특색 상위 소재.
export interface MatCost {
  itemId: string;
  n: number;
}
/** 시설 특색 카테고리 → [Lv2에 쓰는 소재, Lv3에 쓰는 소재] */
const FLAVOR_MAT: Partial<Record<Category, [string, string]>> = {
  금속: ["m:철광석", "m:철모래"],
  실소재: ["m:거미줄", "m:질긴 거미실"],
  광석: ["m:철광석", "m:은광석"],
  약재료: ["m:마력초", "m:야광초"],
  원석: ["m:작은 결정", "m:동굴 산호"],
  식물: ["m:솜털풀", "m:거대 마력초"],
  동물소재: ["m:커다란 뼈", "m:거대한 엄니"],
  원소: ["m:마석 파편", "m:골렘 코어"],
  식재료: ["m:야생감자", "m:신선한 고기"],
};
const MAT_COST = (f: Category): MatCost[][] => {
  const [f2, f3] = FLAVOR_MAT[f] ?? ["m:철광석", "m:철모래"];
  return [
    [{ itemId: "m:나뭇가지", n: 4 }, { itemId: "m:동굴 돌멩이", n: 2 }],
    [{ itemId: "m:튼튼한 통나무", n: 3 }, { itemId: "m:동굴 돌멩이", n: 3 }, { itemId: f2, n: 2 }],
    [{ itemId: "m:튼튼한 통나무", n: 4 }, { itemId: "m:고대 석주 조각", n: 1 }, { itemId: f3, n: 2 }],
  ];
};
export const costName = (c: MatCost) => PIECES[c.itemId]?.name ?? c.itemId;
export const costHave = (c: MatCost) => warehouseCount((x) => x === c.itemId);

export function nextCost(id: string): MatCost[] | null {
  const def = facilityDef(id);
  if (!def) return null;
  const lvl = getLevel(id);
  if (lvl >= def.maxLevel) return null;
  return MAT_COST(def.flavor)[lvl] ?? null;
}

/** 같은 소재가 두 칸에 나오면 합쳐서 센다 */
function totals(cost: MatCost[]): Map<string, number> {
  const m = new Map<string, number>();
  cost.forEach((c) => m.set(c.itemId, (m.get(c.itemId) ?? 0) + c.n));
  return m;
}
const canAfford = (cost: MatCost[]) => [...totals(cost)].every(([id, n]) => warehouseCount((x) => x === id) >= n);
function spend(cost: MatCost[]): boolean {
  if (!canAfford(cost)) return false;
  totals(cost).forEach((n, id) => warehouseRemove((x) => x === id, n));
  return true;
}

export function canUpgrade(id: string) {
  const cost = nextCost(id);
  return cost != null && canAfford(cost);
}

/** 이미 지은 시설의 레벨을 올린다. */
export function upgrade(id: string): boolean {
  if (getLevel(id) === 0) return false;
  const cost = nextCost(id);
  if (!cost || !spend(cost)) return false;
  levels.set(id, getLevel(id) + 1);
  return true;
}

/** 빈 터에 새로 짓는다 (Lv 1). */
export function build(id: string, plot: number): boolean {
  if (getLevel(id) !== 0 || plotBlock(id, plot) || facilityAt(plot)) return false;
  const cost = nextCost(id);
  if (!cost || !spend(cost)) return false;
  levels.set(id, 1);
  plotOf.set(id, plot);
  return true;
}

/** 옮길 수 없는 이유 (없으면 null). */
export function moveBlockReason(id: string, plot: number): string | null {
  const from = plotIndexOf(id);
  if (from < 0 || !PLOTS[plot]) return "옮길 수 없다";
  if (facilityDef(id)?.fixed) return `${facilityDef(id)!.name}는 옮길 수 없다`;
  const block = plotBlock(id, plot);
  if (block) return block;
  const other = facilityAt(plot);
  if (other && other !== id && plotBlock(other, from)) return `${facilityDef(other)!.name}는 그 자리로 갈 수 없다`;
  return null;
}

/** 다른 터로 옮긴다. 그 터에 건물이 있으면 맞바꾼다. 무료. */
export function moveFacility(id: string, plot: number): boolean {
  if (moveBlockReason(id, plot)) return false;
  const from = plotIndexOf(id);
  const other = facilityAt(plot);
  plotOf.set(id, plot);
  if (other) plotOf.set(other, from);
  return true;
}
