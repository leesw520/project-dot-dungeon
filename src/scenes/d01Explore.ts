// D01 탐색 — 타일 길 놓기 (docs/exploration.md). 그림 에셋 없이 도트(R)로만 그린다.
// 구획(고정 모양) 안에 입구에서 이어지게 길 타일을 하나씩 놓는다.
// - 맵 고정 심볼: 채집 포인트(덮으면 소재), 보물상자(한 번만, 다음 원정부터 사라짐), 휴식 포인트(체류 +).
// - 타일에 붙은 심볼: 적(놓으면 그 수만큼 전투), 아이템(놓으면 획득). 전투가 싫으면 미루거나(교환·강행) 지운다.
// - 조작 상태 2개: 맵 확인(기본, 휠 확대/축소) · 배치 모드(현재 타일을 클릭해 진입, 휠 회전, 우클릭 취소).
// - 체류 시간: 남은 배치 횟수. 0이면 귀환. 휴식 포인트로 늘어난다.
// - 입구·출구는 틀 바깥으로 튀어나온 칸(data/dungeons.ts ExitDef). 입구에서 이어 놓고, 출구의 연결 지점까지 닿아야 지나간다.
// - 시야: 깐 길에서 멀수록 어둡고 해상도가 낮다. 판(바닥·길·심볼)과 시야를 오프스크린 한 장에 구워 두고 변할 때만 다시 굽는다.
//   시점(카메라)은 그 한 장을 옮겨 붙일 뿐이라 이동·확대는 다시 굽지 않는다 (ui-spec.md 9장).
import { C, G, R, T, btn, fitText, pen, textWidth, withPen } from "../render/primitives";
import { requestRedraw } from "../render/frame";
import { drawTooltip, type TooltipContent } from "../ui/tooltip";
import { PARTY, type FormSlot } from "../data/battle";
import { MONSTER_DB, SIZE_SLOTS } from "../data/monsters";
import { PIECES, type Cell } from "../data/pieces";
import { DUNGEONS, type DistrictDef, type ExitDef, type GatherPoint } from "../data/dungeons";
import {
  DECKS, EXPLORE_SKILLS, GATHER_KINDS, PATH_PIECES, STAY, VISION, visionRange,
  type EnemySize, type ExploreSkillId, type GatherKind,
} from "../data/explore";
import { applyRotFlip, bounds } from "../engine/transform";
import { goTo, goToWithBack } from "../engine/nav";
import { restoreVitals, spendVital, vitalsOf } from "../engine/partyVitals";
import { exploreMods } from "../engine/party";
import { requestEncounter, takeEncounterResult } from "../engine/encounter";
import { getLastResult, handOverFoundLoot, partyLv } from "../engine/battleResult";
import { districtVisibility, isDoorSeen, isEncountered, markDoorSeen, markEncountered, markVisited } from "../engine/exploreKnowledge";
import { addItem, loseBag, moveBagToWarehouse, ownedItems } from "../data/inventory";
import { registerSave } from "../engine/save";
import { clearBags } from "./b03Loot";
import { createFloorMapView, districtTooltip } from "../ui/floorMapView";
import { createDiscoveryFx, type Discovery } from "./d01Discovery";
import type { Scene } from "./types";

const DUNGEON = DUNGEONS[0];
/** 지금 층 (원정의 floor 번호를 따른다 — 내려가기·이어하기에서 바꾼다) */
let FLOOR = DUNGEON.floors[0];
const CS = 16; // 판 칸 크기 (구운 그림 기준)
const VIEW = { x: 138, y: 18, w: 202, h: 236 }; // 판이 보이는 창. 그 안에서 시점 이동·확대
const ZOOMS = [0.5, 1, 1.5, 2]; // 배율 2 화면에서 정수 픽셀로 떨어지는 값만
const ZOOM_START = 1;
const PAN_SPEED = 170; // 화면 px/초
const VOID = "#0b0a08"; // 구획 밖
const PANEL_R = 342;
/** 다음 타일 칸 수 (보이는 최대). 기본은 현재 타일만 보이고, 예지(코어)로 n개 공개 (2026-11-07). */
const NEXT_SLOTS = 3;
const ENGAGE_MS = 700;

const K = (c: number, r: number) => `${c},${r}`;
const same = (a: Cell, c: number, r: number) => a[0] === c && a[1] === r;

// ---------- 난수 (원정 시드) ----------
/** state()는 지금 내부 값 — mulberry(state())로 같은 자리에서 이어 굴린다 (세이브). */
type Rng = (() => number) & { state: () => number };
function mulberry(seed: number): Rng {
  let a = seed >>> 0;
  const f = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  f.state = () => a;
  return f;
}

// ---------- 상태 ----------
/** 타일에 붙은 심볼. idx = 타일 기본 모양(PATH_PIECES.cells)의 칸 번호 — 회전·반전해도 같은 칸을 따라간다. */
type PieceSym =
  | { idx: number; kind: "enemy"; size: EnemySize; mons: string[]; boss?: true }
  | { idx: number; kind: "item"; item: string } // 옛 세이브용 (2026-11-08부터 타일 아이템은 채집 심볼로)
  | { idx: number; kind: "gather"; gather: GatherKind };
interface QueuedPiece { id: string; syms: PieceSym[] }
interface Placed { cells: Cell[]; tone: number; syms: Array<{ cell: Cell; sym: PieceSym }> }
interface DistrictState {
  def: DistrictDef;
  path: Set<string>;
  placed: Placed[];
  rng: Rng;
  queue: QueuedPiece[];
  foresee: boolean;
  /** 이번 원정의 채집지 (자리·개수는 원정 시드로 무작위, rollGathers) */
  gathers: GatherPoint[];
  /** 이번 원정에서 캔 채집 포인트 / 쓴 휴식 포인트 (칸 키) */
  gathered: Set<string>;
  rested: Set<string>;
  /** 칸별 시야 단계 (0 선명 … VISION.blocks 끝). 없으면 가장 어두운 단계 */
  vis: Map<string, number>;
  /** 라이트로 밝힌 곳 [열, 줄, 반경]. 다음 타일을 놓으면 꺼진다 (세이브 안 함) */
  lights: Array<[number, number, number]>;
}

interface Expedition {
  seed: number;
  districts: Map<string, DistrictState>;
  cur: string;
  /** 남은 배치 횟수 (체류 시간) */
  stay: number;
  stayMax: number;
  battles: number;
  loot: string[];
  /** 이번 원정에서 연 보물상자 (열린 채로 보인다) */
  openedNow: Set<string>;
  /** 덮어서 전투가 남은 적 심볼 (덮은 순서대로 한 번씩 B01) */
  pending: Array<{ district: string; placed: number; sym: number }>;
  /** 전투에서 이긴 적 심볼 ("구획:타일:심볼") */
  beaten: Set<string>;
  uses: Record<ExploreSkillId, number>;
  /** 시야 수정값 (탐색 능력·스킬 자리). TODO(spec) */
  visionMods: number[];
  rot: 0 | 1 | 2 | 3;
  flip: boolean;
  /** 지금 층 번호 (DUNGEON.floors 순서, 0 = B1F) */
  floor: number;
  /** 원정 기록 (귀환 정산 E01용, 2026-11-08). 옛 세이브에는 없을 수 있다 */
  log?: ExpeditionLog;
}
interface ExpeditionLog {
  gold: number;
  exp: number;
  /** 쓰러뜨린 적 이름 → 수 */
  kills: Record<string, number>;
  /** 원정 시작 때 레벨 */
  startLv: Record<string, number>;
  gathers: number;
  chests: number;
}
const newLog = (): ExpeditionLog => ({ gold: 0, exp: 0, kills: {}, startLv: Object.fromEntries(PARTY.map((p) => [p.name, partyLv(p.name)])), gathers: 0, chests: 0 });

/** 귀환 정산 화면(E01)에 넘기는 요약 */
export interface ExpeditionSummary {
  outcome: "return" | "lose";
  reason: string;
  floorName: string;
  /** 가져온(패배면 잃은) 아이템 [id, 개수] */
  items: Array<[string, number]>;
  gold: number;
  exp: number;
  kills: Array<[string, number]>;
  levels: Array<{ name: string; from: number; to: number }>;
  battles: number;
  stayUsed: number;
  districts: number;
  gathers: number;
  chests: number;
}
let lastSummary: ExpeditionSummary | null = null;
export const getExpeditionSummary = () => lastSummary;
function summarize(outcome: ExpeditionSummary["outcome"], reason: string): ExpeditionSummary {
  const log = X.log ?? newLog();
  const items = new Map<string, number>();
  for (const o of ownedItems((o) => o.location === "bag")) items.set(o.itemId, (items.get(o.itemId) ?? 0) + o.count);
  return {
    outcome, reason, floorName: FLOOR.name,
    items: [...items.entries()].sort((a, b) => b[1] - a[1]),
    gold: log.gold, exp: log.exp,
    kills: Object.entries(log.kills).sort((a, b) => b[1] - a[1]),
    levels: PARTY.map((p) => ({ name: p.name, from: log.startLv[p.name] ?? partyLv(p.name), to: partyLv(p.name) })),
    battles: X.battles, stayUsed: Math.max(0, X.stayMax - X.stay), districts: X.districts.size, gathers: log.gathers, chests: log.chests,
  };
}

/** 지금까지 연 보물상자 — 다음 원정부터는 아예 안 보인다. 세이브 "chests" 칸. */
const openedEver = new Set<string>();
registerSave("chests", () => [...openedEver], (v) => {
  openedEver.clear();
  (v as string[]).forEach((id) => openedEver.add(id));
});

let X: Expedition; // 맨 아래에서 시작 (아래 함수·상수가 먼저 정의돼야 한다)
const UI = {
  mouse: null as { x: number; y: number } | null,
  banner: "",
  bannerT: 0,
  /** 0보다 크면 이 시간 뒤 B01로 */
  engageT: 0,
  /** 띄울 발견 연출 (맨 앞이 지금) */
  discoveries: [] as Discovery[],
  /** B03 전리품 분배로 넘길 것 (발견·타일 아이템) */
  found: [] as string[],
  /** 0보다 크면 이 시간 뒤 B03으로 */
  lootT: 0,
  /** B03에 다녀오는 중 (돌아오면 남은 전투로 이어 간다) */
  awayForLoot: false,
  /** 시점: 창 가운데가 보는 구운 그림 위 좌표 (px) */
  cam: { x: 0, y: 0 },
  zoom: ZOOM_START,
  /** 누르고 있는 시점 이동 (키 또는 화살표) */
  panKeys: new Set<string>(),
  panArrow: null as null | [number, number],
  /** 배치 모드: 현재 타일을 집어 든 상태. 아니면 맵 확인 상태 */
  placing: false,
  /** 왼쪽 메뉴의 탐색 스킬 목록이 펼쳐져 있는가 */
  skillsOpen: false,
  skillScroll: 0,
  /** 라이트 사용 중: 밝힐 길 칸 고르기 (쓰는 사람·반경·MP) */
  lighting: null as null | { owner: string; radius: number; mp: number },
};
const discoveryFx = createDiscoveryFx();
const bigMap = createFloorMapView();

function stayStart() {
  const avg = PARTY.reduce((t, p) => t + partyLv(p.name), 0) / PARTY.length;
  return STAY.base + Math.round(avg * STAY.perLevel) + exploreMods().stay; // 공용 [야영]
}

function newExpedition(seed: number): Expedition {
  FLOOR = DUNGEON.floors[0];
  restoreVitals();
  const stay = stayStart();
  const ex: Expedition = {
    seed, districts: new Map(), cur: FLOOR.startDistrict, stay, stayMax: stay, battles: 0, loot: [],
    openedNow: new Set(), pending: [], beaten: new Set(),
    uses: Object.fromEntries(EXPLORE_SKILLS.map((s) => [s.id, s.uses])) as Record<ExploreSkillId, number>,
    visionMods: exploreMods().vision ? [exploreMods().vision] : [],
    rot: 0, flip: false, floor: 0, log: newLog(),
  };
  const def = districtDef(FLOOR.startDistrict);
  enterDistrict(ex, def.id, def.start!);
  return ex;
}

/**
 * 채집지 무작위 배치 (2026-11-08): 구획 견본(def.gathers)의 종류·비율로, 원정 시드마다 다른 자리·개수.
 * 바위·구획 밖·입구/통로/계단 연결 칸·상자·휴식 자리를 피하고, 채집지끼리는 붙지 않게 (8방향 이웃 금지).
 * 같은 원정 안에서는 늘 같은 결과 (세이브를 불러와도 같다).
 */
function rollGathers(def: DistrictDef, seed: number): GatherPoint[] {
  if (!def.gathers.length) return [];
  let h = seed | 0;
  for (const ch of def.id) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761);
  const rng = mulberry(h ^ 0x5bd1e995);
  // 2026-11-08 2차: 개수를 줄였다 (견본 수 × 0.8~1.2) — 대신 한 곳에서 2~3개
  const [lo, hi] = def.gatherCount ?? [Math.max(2, Math.round(def.gathers.length * 0.8)), Math.max(2, Math.round(def.gathers.length * 1.2))];
  const want = lo + Math.floor(rng() * (hi - lo + 1));
  const block = new Set<string>([...def.chests.map((c) => K(...c.cell)), ...def.rests.map((r) => K(...r))]);
  for (const e of [...def.doors, ...(def.start ? [def.start] : []), ...(def.stairs ? [def.stairs] : [])]) {
    const [c, r] = inner(e);
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) block.add(K(c + dc, r + dr));
  }
  const free: Cell[] = [];
  def.shape.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "." && !block.has(K(c, r))) free.push([c, r]); }));
  const out: GatherPoint[] = [];
  const near = (c: number, r: number) => out.some((g) => Math.abs(g.cell[0] - c) <= 1 && Math.abs(g.cell[1] - r) <= 1);
  while (out.length < want && free.length) {
    const [c, r] = free.splice(Math.floor(rng() * free.length), 1)[0];
    if (near(c, r)) continue;
    out.push({ cell: [c, r], kind: def.gathers[Math.floor(rng() * def.gathers.length)].kind });
  }
  return out;
}

/** 채집지 한 곳에서 얻는 개수 [최소, 최대] · 아이템 심볼 하나에서 얻는 개수 (2026-11-08) */
const GATHER_YIELD: [number, number] = [2, 3];
const ITEM_SYMBOL_YIELD = 2;

/** 채집 한 번: 구획 드롭 표(없으면 채집지 기본 목록)에서 GATHER_YIELD개 + 공용 코어 확률로 하나 더. 발견 연출을 쌓는다. */
function gatherAt(s: DistrictState, kind: GatherKind, msgs: string[]) {
  const g = { kind };
  // 구획 드롭 표(가중치, docs/dungeon-themes.md)가 있으면 그쪽, 없으면 채집지 기본 목록
  const table = s.def.gatherLoot?.[g.kind];
  const rollItem = (): string => {
    if (table?.length) {
      let roll = s.rng() * table.reduce((t, [, w]) => t + w, 0);
      for (const [id, w] of table) if ((roll -= w) < 0) return id;
      return table[table.length - 1][0];
    }
    const loot = GATHER_KINDS[g.kind].loot;
    return loot[Math.floor(s.rng() * loot.length)];
  };
  // 2026-11-08: 채집지 한 곳에서 GATHER_YIELD개 (2~3개, 개수마다 따로 뽑는다) — 채집지 수는 줄이고 한 번에 많이
  const n = GATHER_YIELD[0] + Math.floor(s.rng() * (GATHER_YIELD[1] - GATHER_YIELD[0] + 1));
  const got = new Map<string, number>();
  for (let i = 0; i < n; i++) { const it = rollItem(); got.set(it, (got.get(it) ?? 0) + 1); }
  // 공용 [채광]·[벌목]·[채취]: 확률로 1개 더
  const grp = GATHER_GROUP[g.kind], pct = grp ? exploreMods().gather[grp] : 0;
  if (pct > 0 && s.rng() * 100 < pct) { const it = rollItem(); got.set(it, (got.get(it) ?? 0) + 1); msgs.push(`${PIECES[it]?.name ?? it} 하나 더`); }
  for (const [item, k] of got) {
    for (let i = 0; i < k; i++) gain(item);
    UI.discoveries.push({ kind: "gather", item, count: k });
  }
}

/** 필드에 고정된 심볼 칸 (채집지·상자·휴식·통로·계단·중간 보스) — 타일 심볼과 겹치지 않게 */
function fieldSymbolCells(s: DistrictState): string[] {
  const d = s.def;
  const out = [...s.gathers.map((g) => K(...g.cell)), ...d.chests.map((c) => K(...c.cell)), ...d.rests.map((r) => K(...r)), ...d.doors.map((x) => K(...x.cell))];
  if (d.stairs) out.push(K(...d.stairs.cell));
  const b = stairsBoss(s);
  if (b) out.push(K(...b.cell));
  return out;
}
/** 계단 앞(계단 바로 안쪽 칸)에 고정된 중간 보스 (2026-11-08). 계단 구획의 midBoss, 없으면 그 층 첫 중간 보스. */
function stairsBoss(s: DistrictState): { id: string; cell: Cell } | null {
  if (!s.def.stairs) return null;
  const id = s.def.midBoss ?? FLOOR.districts.find((d) => d.midBoss)?.midBoss;
  return id ? { id, cell: inner(s.def.stairs) } : null;
}
/** 이 구획의 계단 보스를 이번 원정에서 쓰러뜨렸는가 */
function bossBeaten(s: DistrictState): boolean {
  return s.placed.some((p, pi) => p.syms.some((y, si) => y.sym.kind === "enemy" && y.sym.boss && X.beaten.has(`${s.def.id}:${pi}:${si}`)));
}

/** 출구의 연결 지점 = 바깥 칸에서 구획 쪽으로 한 칸 안 */
function inner(e: ExitDef): Cell {
  const [c, r] = e.cell;
  return e.side === "left" ? [c + 1, r] : e.side === "right" ? [c - 1, r] : e.side === "top" ? [c, r + 1] : [c, r - 1];
}

const districtDef = (id: string) => FLOOR.districts.find((d) => d.id === id)!;
const cell = (def: DistrictDef, c: number, r: number) => (r >= 0 && r < def.shape.length && c >= 0 && c < def.shape[r].length ? def.shape[r][c] : " ");
const st = () => X.districts.get(X.cur)!;

function weighted<T extends string>(rng: () => number, table: Partial<Record<T, number>> | Array<[T, number]>): T {
  const entries = (Array.isArray(table) ? table : Object.entries(table)) as Array<[T, number]>;
  let roll = rng() * entries.reduce((t, [, w]) => t + w, 0);
  for (const [k, w] of entries) if ((roll -= w) < 0) return k;
  return entries[0][0];
}

/** 적 팀 하나 (2026-11-08, docs/monsters.md 5장 적 팀): 구획 전투력 범위(def.power) 안에서 목표치를 굴리고,
 *  구획 몬스터를 뽑아 전투력(power) 합이 목표에 닿을 때까지 채운다 (목표 ×1.15까지 허용).
 *  몬스터 뽑기는 1/√전투력 가중 (강적일수록 드물게). 첫 몬스터는 목표를 넘어도 들어간다 → 강적은 혼자, 약한 몹은 여럿. "혼자만 나오는" 몬스터(group 1, 중형 이상)는 늘 혼자.
 *  같은 몬스터 최대 수(group)·적진 6칸·최대 5마리는 넘지 않는다. 심볼 크기는 하나로 통일 ("m"). */
const MAX_TEAM = 5; // 한 전투 최대 마리 수
function rollGroup(s: DistrictState): { mons: string[]; size: EnemySize } {
  const list = s.def.monsters;
  // 뽑기 가중치 = 1/√전투력: 강한 몹일수록 덜 나온다 (강적은 가끔, 약한 몹은 자주)
  const wts = list.map((id) => 1 / Math.sqrt(MONSTER_DB[id].power));
  const wsum = wts.reduce((a, b) => a + b, 0);
  const pick = () => {
    let r = s.rng() * wsum;
    for (let i = 0; i < list.length; i++) if ((r -= wts[i]) < 0) return list[i];
    return list[list.length - 1];
  };
  const solo = (id: string) => MONSTER_DB[id].group <= 1 && MONSTER_DB[id].size !== "small";
  const [lo, hi] = s.def.power;
  const target = lo + s.rng() * (hi - lo);
  const first = pick();
  const mons = [first];
  let sum = MONSTER_DB[first].power;
  let slots = SIZE_SLOTS[MONSTER_DB[first].size];
  if (!solo(first)) {
    for (let tries = 0; sum < target && mons.length < MAX_TEAM && tries < 16; tries++) {
      const m = pick();
      const d = MONSTER_DB[m];
      if (solo(m) || mons.filter((x) => x === m).length >= d.group || slots + SIZE_SLOTS[d.size] > 6 || sum + d.power > target * 1.15) continue;
      mons.push(m);
      sum += d.power;
      slots += SIZE_SLOTS[d.size];
    }
  }
  return { mons, size: "m" };
}

/** 덱에서 한 장: 타일 칸마다 적/아이템 심볼을 굴린다 (구획 서식지 비율). */
/** 채집지 → 공용 채집 코어 묶음 */
const GATHER_GROUP: Partial<Record<GatherKind, "rock" | "wood" | "herb">> = {
  rubble: "rock", crystal: "rock", sand: "rock", tree: "wood", corpse: "wood", web: "wood", bush: "herb", flower: "herb", mushroom: "herb", pool: "herb",
};

function drawPiece(s: DistrictState): QueuedPiece {
  const id = weighted(s.rng, DECKS[s.def.deck]);
  const sy = s.def.symbols;
  const syms: PieceSym[] = [];
  // 공용 [사전 정찰]·[보물찾기]: 적·아이템 심볼 비율 ±%
  const em = exploreMods();
  const enemyRate = sy.enemy * Math.max(0, 1 - em.enemyDown / 100), itemRate = sy.item * (1 + em.itemUp / 100);
  PATH_PIECES[id].cells.forEach((_, idx) => {
    const roll = s.rng();
    if (roll < enemyRate) {
      const { mons, size } = rollGroup(s);
      syms.push({ idx, kind: "enemy", size, mons });
    } else if (roll < enemyRate + itemRate && s.def.gathers.length) {
      // 2026-11-08: 타일 아이템 대신 이 구획의 채집지 하나 (종류는 구획 견본 비율대로) — 놓으면 바로 채집
      syms.push({ idx, kind: "gather", gather: s.def.gathers[Math.floor(s.rng() * s.def.gathers.length)].kind });
    }
  });
  return { id, syms };
}
function fillQueue(s: DistrictState) {
  while (s.queue.length < NEXT_SLOTS + 1) s.queue.push(drawPiece(s));
}

function enterDistrict(ex: Expedition, id: string, entry: ExitDef) {
  let s = ex.districts.get(id);
  if (!s) {
    const def = districtDef(id);
    const rng = mulberry(ex.seed ^ (id.length * 7919 + id.charCodeAt(0) * 131));
    const ns: DistrictState = { def, path: new Set(), placed: [], rng, queue: [], foresee: false, gathers: rollGathers(def, ex.seed), gathered: new Set(), rested: new Set(), vis: new Map(), lights: [] };
    fillQueue(ns);
    ex.districts.set(id, ns);
    s = ns;
  }
  s.path.add(K(...entry.cell));
  ex.cur = id;
  ex.rot = 0;
  ex.flip = false;
  UI.placing = false;
  markVisited(id);
  refreshVision(ex, s);
  // 들어온 입구가 창 가운데
  UI.cam = { x: (entry.cell[0] + 1.5) * CS, y: (entry.cell[1] + 1.5) * CS };
  UI.zoom = ZOOM_START;
}

// ---------- 시야 ----------
const visionOf = (ex: Expedition) => visionRange(ex.visionMods);

/** 길이 깔린 칸(입구 포함)에서의 거리로 칸별 시야 단계를 다시 잰다. 길·시야가 바뀔 때만 부른다. */
function refreshVision(ex: Expedition, s: DistrictState) {
  const { cols, rows } = dims(s.def);
  const v = visionOf(ex);
  const last = VISION.blocks.length - 1;
  const src = [...s.path].map((k) => k.split(",").map(Number));
  s.vis.clear();
  for (let r = -1; r <= rows; r++) for (let c = -1; c <= cols; c++) {
    let d = Infinity;
    for (const [pc, pr] of src) d = Math.min(d, Math.hypot(c - pc, r - pr));
    let lv = d <= v ? 0 : Math.min(last, Math.ceil(d - v));
    // 라이트: 고른 칸에서 반경 안은 선명, 바깥은 거리만큼 어두워진다
    for (const [lc, lr, rad] of s.lights) {
      const dl = Math.hypot(c - lc, r - lr);
      lv = Math.min(lv, dl <= rad ? 0 : Math.min(last, Math.ceil(dl - rad)));
    }
    s.vis.set(K(c, r), lv);
  }
  // 통로를 시야 안에 두면 그 너머 구획이 미니맵에 ?로 뜬다
  s.def.doors.forEach((d) => { if (s.vis.get(K(...d.cell)) === 0) markDoorSeen(s.def.id, d.to); });
}

/** 또렷이 알아볼 수 있는 칸인가 (툴팁·미리보기가 심볼을 알려 줘도 되는 범위) */
const canSee = (s: DistrictState, c: number, r: number) => (s.vis.get(K(c, r)) ?? 99) <= 1;

// ---------- 배치 판정 ----------
const curPiece = () => st().queue[0];
const curShape = (): Cell[] => applyRotFlip(PATH_PIECES[curPiece().id].cells, X.rot, X.flip);
const enemyCount = (p: QueuedPiece) => p.syms.filter((y) => y.kind === "enemy").length;

function dims(def: DistrictDef) {
  return { cols: Math.max(...def.shape.map((l) => l.length)), rows: def.shape.length };
}

/** 구운 그림 크기: 구획 + 사방 1칸 (튀어나온 입구·출구 자리) */
function worldSize(def: DistrictDef) {
  const { cols, rows } = dims(def);
  return { w: (cols + 2) * CS, h: (rows + 2) * CS };
}

/** 지금 시점에서 구획 칸 (0,0)의 화면 좌표와 칸 크기 */
function viewOrigin() {
  const z = ZOOMS[UI.zoom];
  return {
    x: VIEW.x + Math.floor(VIEW.w / 2) - Math.round(UI.cam.x * z) + CS * z,
    y: VIEW.y + Math.floor(VIEW.h / 2) - Math.round(UI.cam.y * z) + CS * z,
    cs: CS * z,
  };
}

function clampCam() {
  const { w, h } = worldSize(st().def);
  UI.cam.x = Math.max(0, Math.min(w, UI.cam.x));
  UI.cam.y = Math.max(0, Math.min(h, UI.cam.y));
}

function zoomBy(step: number) {
  const next = Math.max(0, Math.min(ZOOMS.length - 1, UI.zoom + step));
  if (next === UI.zoom) return;
  // 커서 아래 지점이 그대로 있게
  const m = UI.mouse && inView(UI.mouse) ? UI.mouse : null;
  const ax = (m?.x ?? VIEW.x + VIEW.w / 2) - (VIEW.x + VIEW.w / 2), ay = (m?.y ?? VIEW.y + VIEW.h / 2) - (VIEW.y + VIEW.h / 2);
  const z0 = ZOOMS[UI.zoom], z1 = ZOOMS[next];
  UI.cam.x += ax / z0 - ax / z1;
  UI.cam.y += ay / z0 - ay / z1;
  UI.zoom = next;
  clampCam();
}

const inView = (p: { x: number; y: number }) => p.x >= VIEW.x && p.x < VIEW.x + VIEW.w && p.y >= VIEW.y && p.y < VIEW.y + VIEW.h;

function canPlace(s: DistrictState, shape: Cell[], oc: number, or: number) {
  let touches = false;
  for (const [dc, dr] of shape) {
    const c = oc + dc, r = or + dr;
    if (cell(s.def, c, r) !== ".") return false;
    if (s.path.has(K(c, r))) return false;
    if (s.path.has(K(c - 1, r)) || s.path.has(K(c + 1, r)) || s.path.has(K(c, r - 1)) || s.path.has(K(c, r + 1))) touches = true;
  }
  return touches;
}

/** 현재 타일을 어느 방향으로든(반전은 거울 걸음이 남았을 때만) 놓을 수 있는가 */
function anyPlacement(s: DistrictState): boolean {
  const base = PATH_PIECES[s.queue[0].id].cells;
  const flips = (X.uses.mirror ?? 0) > 0 ? [false, true] : [false];
  const o = dims(s.def);
  for (const f of flips) for (let rot = 0; rot < 4; rot++) {
    const shape = applyRotFlip(base, rot as 0 | 1 | 2 | 3, f);
    for (let r = -3; r < o.rows; r++) for (let c = -3; c < o.cols; c++) if (canPlace(s, shape, c, r)) return true;
  }
  return false;
}

/** 타일을 놓을 수 없는 대기 상태인가 (발견 연출·전투 들어가기·남은 전투) */
const busy = () => discoveryFx.active || bigMap.active || UI.engageT > 0 || UI.lootT > 0 || X.pending.length > 0;

function hoverOrigin(): { c: number; r: number; hc: number; hr: number } | null {
  const m = UI.mouse;
  if (!m || !inView(m)) return null;
  const o = viewOrigin(), d = dims(st().def);
  const hc = Math.floor((m.x - o.x) / o.cs), hr = Math.floor((m.y - o.y) / o.cs);
  if (hc < 0 || hr < 0 || hc >= d.cols || hr >= d.rows) return null;
  const b = bounds(curShape());
  return { c: hc - (b.maxC >> 1), r: hr - (b.maxR >> 1), hc, hr };
}

const chestVisible = (id: string) => X.openedNow.has(id) || !openedEver.has(id);

/** 배치 모드 들어가기: 현재 타일을 집어 든다 */
function startPlacing() {
  if (busy()) return;
  if (X.stay <= 0) return banner("체류 시간이 다했다 — 귀환해야 한다");
  UI.lighting = null;
  UI.placing = true;
}

/** 배치 취소: 맵 확인 상태로, 타일은 제자리로 (회전·반전도 되돌린다) */
function cancelPlacing() {
  UI.placing = false;
  X.rot = 0;
  X.flip = false;
}

const rotateTile = (dir: 1 | 3) => { X.rot = ((X.rot + dir) % 4) as 0 | 1 | 2 | 3; };

function place(oc: number, or: number) {
  const s = st();
  if (X.stay <= 0) return banner("체류 시간이 다했다 — 귀환해야 한다");
  const shape = curShape();
  if (!canPlace(s, shape, oc, or)) return;
  const piece = curPiece();
  const cells = shape.map(([dc, dr]): Cell => [oc + dc, or + dr]);
  cells.forEach(([c, r]) => s.path.add(K(c, r)));
  s.lights = []; // 라이트는 다음 타일을 놓으면 꺼진다
  const placedIdx = s.placed.length;
  // 타일 심볼은 필드 심볼(채집지·상자·휴식·통로·계단·중간 보스) 칸에서는 사라진다 — 겹치지 않게 (2026-11-08)
  const fieldCells = new Set(fieldSymbolCells(s));
  const kept: PieceSym[] = piece.syms.filter((sym) => !fieldCells.has(K(...cells[sym.idx])));
  // 계단 앞 중간 보스: 그 칸을 덮으면 보스 전투 (이기기 전에는 내려갈 수 없다)
  const boss = stairsBoss(s);
  if (boss && !bossBeaten(s)) {
    const bi = cells.findIndex(([c, r]) => same(boss.cell, c, r));
    if (bi >= 0) kept.push({ idx: bi, kind: "enemy", size: "m", mons: [boss.id], boss: true });
  }
  s.placed.push({ cells, tone: placedIdx % 2, syms: kept.map((sym) => ({ cell: cells[sym.idx], sym })) });
  if (X.flip) X.uses.mirror--;
  X.stay--;
  const msgs: string[] = [];
  const covers = (at: Cell) => cells.some(([c, r]) => same(at, c, r));

  // 타일의 아이템 심볼 → 바로 획득, 적 심볼 → 전투 대기
  kept.forEach((sym, i) => {
    // 아이템 심볼: 2개씩 (2026-11-08 — 심볼은 줄이고 한 번에 많이)
    if (sym.kind === "item") { for (let k = 0; k < ITEM_SYMBOL_YIELD; k++) gain(sym.item); msgs.push(`${PIECES[sym.item].name} ×${ITEM_SYMBOL_YIELD} 획득`); }
    else if (sym.kind === "gather") { gatherAt(s, sym.gather, msgs); if (X.log) X.log.gathers++; }
    else X.pending.push({ district: s.def.id, placed: placedIdx, sym: i });
  });
  // 맵 심볼. 채집지는 종류만 보이고, 무슨 조각이 나올지는 캘 때 정해진다.
  s.gathers.forEach((g) => {
    if (!covers(g.cell) || s.gathered.has(K(...g.cell))) return;
    s.gathered.add(K(...g.cell));
    gatherAt(s, g.kind, msgs);
    if (X.log) X.log.gathers++;
  });
  s.def.chests.forEach((ch) => {
    if (!covers(ch.cell) || !chestVisible(ch.id) || X.openedNow.has(ch.id)) return;
    X.openedNow.add(ch.id);
    openedEver.add(ch.id);
    // 중요 아이템(스토리상 꼭 얻어야 하는 것)은 가방을 거치지 않고 바로 거점 창고로 — 버릴 일 자체가 없게
    const key = PIECES[ch.item].kind === "key";
    if (key) addItem(ch.item, 1, "warehouse");
    else gain(ch.item);
    UI.discoveries.push({ kind: "chest", item: ch.item, key });
    if (X.log) X.log.chests++;
  });
  s.def.rests.forEach((rc) => {
    if (!covers(rc) || s.rested.has(K(...rc))) return;
    s.rested.add(K(...rc));
    const restN = STAY.restBonus + exploreMods().rest; // 공용 [휴식]
    X.stay += restN;
    msgs.push(`휴식 포인트 — 체류 +${restN}`);
  });
  // 출구의 연결 지점에 닿으면 바깥 칸까지 길이 이어진다
  s.def.doors.forEach((d) => {
    if (!covers(inner(d))) return;
    s.path.add(K(...d.cell));
    msgs.push("통로가 이어졌다");
  });
  if (s.def.stairs && covers(inner(s.def.stairs))) {
    s.path.add(K(...s.def.stairs.cell));
    msgs.push("아래로 내려가는 구멍에 닿았다");
  }
  refreshVision(X, s);

  s.queue.shift();
  fillQueue(s);
  cancelPlacing();
  if (msgs.length) banner(msgs.join(" / "));
  if (UI.discoveries.length) discoveryFx.start(UI.discoveries[0]);
  else afterEvents();
}

/** 탐색에서 얻은 것: 원정 기록에 남기고, B03 전리품 분배로 넘길 묶음에 넣는다. */
function gain(item: string) {
  X.loot.push(item);
  UI.found.push(item);
}

/** 발견 연출이 다 끝난 뒤: 전리품 분배 → 남은 전투 → 체류 시간 → 막힘 순 */
function afterEvents(prefix?: string) {
  if (UI.found.length) {
    banner([prefix, "전리품을 챙긴다…"].filter(Boolean).join(" / "));
    UI.lootT = ENGAGE_MS;
    return;
  }
  if (X.pending.length) return engageSoon(prefix ? [prefix] : []);
  const s = st();
  const tail = X.stay <= 0 ? "체류 시간이 다했다 — 귀환해야 한다" : !anyPlacement(s) ? "놓을 자리가 없다 — 귀환해야 한다" : "";
  if (prefix || tail) banner([prefix, tail].filter(Boolean).join(" / "));
}

function banner(s: string) {
  UI.banner = s;
  UI.bannerT = 2600;
}

// ---------- 전투 연결 (engine/encounter.ts) ----------
function pendingSym() {
  const p = X.pending[0];
  if (!p) return null;
  const s = X.districts.get(p.district)!.placed[p.placed].syms[p.sym];
  return s.sym.kind === "enemy" ? { cell: s.cell, mons: s.sym.mons, key: `${p.district}:${p.placed}:${p.sym}` } : null;
}

/** 심볼의 몬스터 목록 → 편성. 전열부터 크기 칸 수 3까지 채우고 나머지는 후열 (battle-rules.md 2.1). */
function formOf(mons: string[]): FormSlot[] {
  let front = 0;
  return mons.map((mon) => {
    const n = SIZE_SLOTS[MONSTER_DB[mon].size];
    const col = front + n <= 3 ? "f" : "b";
    if (col === "f") front += n;
    return { mon, col };
  });
}

function engageSoon(msgs: string[] = []) {
  const e = pendingSym();
  if (!e) return;
  const left = X.pending.length > 1 ? ` (남은 전투 ${X.pending.length})` : "";
  banner([...msgs, `적과 맞닥뜨렸다! ${e.mons.map((m) => MONSTER_DB[m].name).join("·")}${left}`].join(" / "));
  UI.engageT = ENGAGE_MS;
}

function toLoot() {
  handOverFoundLoot(UI.found);
  UI.found = [];
  UI.awayForLoot = true;
  goTo("b03");
}

function engage() {
  const e = pendingSym();
  if (!e) return;
  e.mons.forEach(markEncountered);
  requestEncounter(formOf(e.mons), st().def.battleBg ?? "cave");
  goTo("b01");
}

/** B01(승리면 B02·B03을 거쳐) 또는 B03(발견한 것 분배)에서 돌아왔을 때 */
function onEnter() {
  UI.panKeys.clear();
  UI.panArrow = null;
  if (UI.placing) cancelPlacing();
  if (UI.awayForLoot) {
    UI.awayForLoot = false;
    return afterEvents("분배 완료");
  }
  const res = takeEncounterResult();
  if (res === "win") {
    const e = pendingSym();
    if (e) X.beaten.add(e.key);
    X.pending.shift();
    X.battles++;
    // 원정 기록: 이번 전투의 골드·경험치·쓰러뜨린 적
    const r = getLastResult();
    if (r && r.outcome === "win") {
      const log = (X.log ??= newLog());
      log.gold += r.gold;
      log.exp += r.expTotal;
      for (const d of r.defeated) log.kills[d.name] = (log.kills[d.name] ?? 0) + 1;
    }
    return afterEvents("승리");
  }
  if (res === "lose") {
    // 패배: 가방에 든 것을 전부 잃고 거점으로 (2026-11-07 사용자 결정, exploration.md 6장). TODO(spec): 골드·경험치 처리
    lastSummary = summarize("lose", "전멸");
    const n = loseBag();
    clearBags();
    X.loot = [];
    active = false;
    expeditionOver = `전멸 — 가방에 든 ${n}개를 모두 잃었다`;
    return goTo("e01"); // 원정 정산 → 거점
  }
  if (X.pending.length) banner("전투가 남아 있다 — 금색 테두리 적을 클릭하면 전투");
}

// ---------- 스킬 · 이동 ----------
function useSkill(id: ExploreSkillId) {
  if (busy()) return;
  const s = st();
  if (!(X.uses[id] > 0)) return banner("사용 횟수가 남지 않았다");
  if (id === "skip") { s.queue.shift(); fillQueue(s); cancelPlacing(); }
  else if (id === "swap") { [s.queue[0], s.queue[1]] = [s.queue[1], s.queue[0]]; cancelPlacing(); }
  else if (id === "erase") {
    const i = s.queue[0].syms.findIndex((y) => y.kind === "enemy");
    if (i < 0) return banner("현재 타일에 적 심볼이 없다");
    s.queue[0] = { ...s.queue[0], syms: s.queue[0].syms.filter((_, k) => k !== i) };
  } else if (id === "foresee") { if (s.foresee) return banner("이미 예지 중이다"); s.foresee = true; }
  else if (id === "mirror") { X.flip = !X.flip; return; } // 뒤집어 놓을 때 소모
  X.uses[id]--;
  if (!anyPlacement(s)) banner("놓을 자리가 없다 — 귀환해야 한다");
}

function openDoors(s: DistrictState) {
  return s.def.doors.filter((d) => s.path.has(K(...d.cell)));
}

/** 문을 지나 옆 구획으로. 진행도 1 — 체류 시간(남은 배치)을 STAY.doorCost만큼 쓴다. */
function goThrough(to: string) {
  if (busy()) return;
  if (X.stay < STAY.doorCost) return banner("체류 시간이 모자라 넘어갈 수 없다 — 귀환해야 한다");
  const back = districtDef(to).doors.find((d) => d.to === X.cur)!;
  enterDistrict(X, to, back);
  X.stay -= STAY.doorCost;
  const s = st();
  banner(`${s.def.name} — ${s.def.habitat} / 체류 −${STAY.doorCost}`);
  if (X.stay <= 0) banner(`${s.def.name} / 체류 시간이 다했다 — 귀환해야 한다`);
  else if (!anyPlacement(s)) banner("놓을 자리가 없다 — 귀환해야 한다");
}

function returnHome(reason: string) {
  // 원정에서 얻은 것은 B03 분배 때 보유 목록(가방)에 들어가 있다. 귀환하면 가방을 전부 창고로 (2026-11-07).
  lastSummary = summarize("return", reason);
  const n = moveBagToWarehouse();
  clearBags();
  active = false;
  expeditionOver = `${reason} — 가방의 ${n}개를 창고에 넣었다`;
  goTo("e01"); // 원정 정산 → 거점
}

/** 지금 열어 둔 층 수 (2026-11-08: 1층만 — 2층부터 "개발 중입니다") */
const OPEN_FLOORS = 1;
/** 계단으로 다음 층에 내려간다 (올라올 수 없다). 다음 층 첫 구획의 입구로 들어간다. */
function descend() {
  if (busy()) return;
  const cur = st();
  if (stairsBoss(cur) && !bossBeaten(cur)) return banner(`${MONSTER_DB[stairsBoss(cur)!.id].name}을(를) 쓰러뜨려야 내려갈 수 있다`);
  const next = DUNGEON.floors[X.floor + 1];
  if (!next) return banner("더 내려갈 곳이 없다");
  if (X.floor + 1 >= OPEN_FLOORS) return banner(`${next.name}는 개발 중입니다`);
  X.floor++;
  FLOOR = next;
  const def = districtDef(FLOOR.startDistrict);
  enterDistrict(X, def.id, def.start!);
  banner(`${FLOOR.name} ${def.name} — ${def.habitat}`);
}

/** 원정이 끝났으면 그 이유 (거점이 한 번 읽어 안내한다). 다음 원정은 거점의 던전 게이트에서. */
let expeditionOver: string | null = null;
export function takeExpeditionResult(): string | null {
  const s = expeditionOver;
  expeditionOver = null;
  return s;
}
/** 거점 던전 게이트: 새 원정을 시작한다 (HP·MP 가득, 탐색 패시브 다시 계산, 가방은 빈 채로). */
/** 식품: 체류 횟수 + (원정 중일 때만). 늘린 수 */
export function addStay(n: number): number {
  if (!active) return 0;
  X.stay += n;
  return n;
}

export function beginExpedition() {
  X = newExpedition((X.seed * 1664525 + 1013904223) >>> 0);
  active = true;
  banner(`${st().def.name} — 원정 시작`);
}

/** 원정 중인가 (거점 게이트로 나가 아직 귀환·패배하지 않음). 새로고침하면 이 값을 보고 D01에서 이어 한다. */
let active = false;
export const expeditionActive = () => active;
/** 연출·전투 대기 중이 아니라 저장해도 되는 순간인가 (engine/save 차단 조건). */
export const expeditionSettled = () => !(discoveryFx.active || UI.engageT > 0 || UI.lootT > 0 || UI.discoveries.length > 0);

// 세이브 "expedition" 칸 — 원정 임시 데이터. 귀환·패배하면 null. 시야(vis)는 불러올 때 다시 잰다.
interface SavedDistrict {
  id: string; path: string[]; placed: Placed[]; rng: number; queue: QueuedPiece[]; foresee: boolean; gathered: string[]; rested: string[];
}
registerSave(
  "expedition",
  () => {
    if (!active) return null;
    const { districts, openedNow, beaten, ...rest } = X;
    const ds: SavedDistrict[] = [...districts.values()].map((s) => ({
      id: s.def.id, path: [...s.path], placed: s.placed, rng: s.rng.state(), queue: s.queue, foresee: s.foresee,
      gathered: [...s.gathered], rested: [...s.rested],
    }));
    return { ...rest, openedNow: [...openedNow], beaten: [...beaten], districts: ds };
  },
  (v) => {
    if (!v) return;
    const d = v as Omit<Expedition, "districts" | "openedNow" | "beaten"> & { districts: SavedDistrict[]; openedNow: string[]; beaten: string[] };
    FLOOR = DUNGEON.floors[d.floor ?? 0] ?? DUNGEON.floors[0];
    const districts = new Map<string, DistrictState>();
    for (const sd of d.districts) {
      const def = districtDef(sd.id);
      if (!def) continue;
      districts.set(sd.id, {
        def, path: new Set(sd.path), placed: sd.placed, rng: mulberry(sd.rng), queue: sd.queue, foresee: sd.foresee, gathers: rollGathers(def, d.seed),
        gathered: new Set(sd.gathered), rested: new Set(sd.rested), vis: new Map(), lights: [],
      });
    }
    X = { ...d, districts, openedNow: new Set(d.openedNow), beaten: new Set(d.beaten) };
    districts.forEach((s) => refreshVision(X, s));
    const last = [...st().path].pop()!.split(",").map(Number);
    UI.cam = { x: (last[0] + 0.5) * CS, y: (last[1] + 0.5) * CS };
    UI.zoom = ZOOM_START;
    UI.placing = false;
    active = true;
  }
);

// ---------- 그리기 ----------
type Hit = { x: number; y: number; w: number; h: number; key: string };
let hits: Hit[] = [];
const hit = (x: number, y: number, w: number, h: number, key: string) => hits.push({ x, y, w, h, key });

const PATH_TONES = ["#B89B6A", "#A88B5C"];
const PATH_HI = "#D8C08E";

/** 구획 틀 + 바깥으로 튀어나온 입구·출구 칸. 틀 테두리가 그 칸까지 감싼다. */
function drawBoardBase(def: DistrictDef, ox: number, oy: number) {
  const { cols, rows } = dims(def);
  const cells: Array<[number, number, string]> = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (cell(def, c, r) !== " ") cells.push([c, r, cell(def, c, r)]);
  [...def.doors, ...(def.start ? [def.start] : []), ...(def.stairs ? [def.stairs] : [])].forEach((e) => cells.push([e.cell[0], e.cell[1], "."]));
  cells.forEach(([c, r]) => R(ox + c * CS - 3, oy + r * CS - 3, CS + 6, CS + 6, def.color));
  cells.forEach(([c, r, ch]) => {
    const x = ox + c * CS, y = oy + r * CS;
    R(x, y, CS, CS, "#1A1712");
    if (ch === "#") {
      R(x + 1, y + 1, CS - 2, CS - 2, "#5F5E5A");
      R(x + 1, y + 1, CS - 2, 3, "#888780");
      R(x + 3, y + 7, 3, 2, "#444441");
      R(x + 9, y + 10, 4, 2, "#444441");
    } else {
      R(x + 1, y + 1, CS - 2, CS - 2, "#2E2921");
      if ((c * 7 + r * 13) % 5 === 0) R(x + 4 + ((c * 3) % 6), y + 5 + ((r * 5) % 6), 2, 1, "#3A342A");
    }
  });
}

/** 적 심볼 (칸 하나에 들어가는 털뭉치). 크기(소·중·대)는 몸집으로. */
function drawEnemyMark(x: number, y: number, cs: number, _size: EnemySize, alpha = 1) {
  const ex = alpha < 1 ? `opacity='${alpha}'` : undefined;
  const frac = _size === "l" ? 0.92 : 0.72; // 2026-11-08: 심볼 크기 하나로 (팀 규모는 전투력으로). "l"은 계단 앞 중간 보스만
  const s = Math.max(3, Math.round(cs * frac));
  const ox = x + Math.floor((cs - s) / 2), oy = y + Math.floor((cs - s) / 2);
  R(ox, oy + 1, s, s - 1, C.foe, ex);
  R(ox + 1, oy, s - 2, 1, C.foe, ex);
  R(ox, oy + 1, s, Math.max(1, s >> 3), "#C4572E", ex);
  const e = 1;
  const ey = oy + Math.floor(s / 2) - 1;
  R(ox + Math.floor(s / 2) - e - 1, ey, e, e, C.gold, ex);
  R(ox + Math.floor(s / 2) + 1, ey, e, e, C.gold, ex);
}

/** 아이템 심볼: 작은 꾸러미 */
/** 작은 칸(타일 미리보기)용 채집 심볼: 종류 색 점 */
const GATHER_DOT: Record<GatherKind, string> = { bush: "#4F8A1C", tree: "#7A5A2A", flower: "#D85A8A", rubble: "#8A8880", pool: "#378ADD", crystal: "#AFA9EC", mushroom: "#C27A5A", sand: "#C9B48A", corpse: "#D3CEBF", web: "#E8E6E0" };
function drawGatherDot(x: number, y: number, cs: number, kind: GatherKind) {
  const s = Math.max(3, Math.round(cs * 0.55));
  R(x + Math.floor((cs - s) / 2), y + Math.floor((cs - s) / 2), s, s, GATHER_DOT[kind]);
}
function drawItemMark(x: number, y: number, cs: number) {
  const s = Math.max(3, Math.round(cs * 0.5));
  const ox = x + Math.floor((cs - s) / 2), oy = y + Math.floor((cs - s) / 2) + 1;
  R(ox, oy, s, s - 1, "#C9A24A");
  R(ox, oy, s, 1, "#F2D58A");
  R(ox + Math.floor(s / 2) - 1, oy - 1, 2, 1, "#8A6A2A");
}

function drawPath(s: DistrictState, ox: number, oy: number) {
  const pend = pendingSym();
  s.placed.forEach((p, pi) => {
    const set = new Set(p.cells.map(([c, r]) => K(c, r)));
    p.cells.forEach(([c, r]) => {
      const x = ox + c * CS, y = oy + r * CS;
      const l = set.has(K(c - 1, r)) ? 0 : 1, t = set.has(K(c, r - 1)) ? 0 : 1;
      const rr = set.has(K(c + 1, r)) ? 0 : 1, b = set.has(K(c, r + 1)) ? 0 : 1;
      R(x + l, y + t, CS - l - rr, CS - t - b, PATH_TONES[p.tone]);
      if (t) R(x + l, y + t, CS - l - rr, 2, PATH_HI);
      R(x + 4 + ((c + r) % 3) * 3, y + 8, 2, 2, "#8F7650");
    });
    // 타일에 붙어 온 적: 남은 전투는 금색 테두리, 이긴 적은 흐린 X 자국
    p.syms.forEach((ps, si) => {
      if (ps.sym.kind !== "enemy") return;
      const x = ox + ps.cell[0] * CS, y = oy + ps.cell[1] * CS;
      const key = `${s.def.id}:${pi}:${si}`;
      if (X.beaten.has(key)) {
        for (let i = 0; i < 6; i++) { R(x + 5 + i, y + 5 + i, 1, 1, "#7A5A3A"); R(x + 10 - i, y + 5 + i, 1, 1, "#7A5A3A"); }
        return;
      }
      drawEnemyMark(x, y, CS, ps.sym.size);
      if (pend?.key === key) R(x, y, CS, CS, "none", `stroke='${C.gold}' stroke-width='1'`);
    });
  });
  // 입구(타일이 아닌 길 칸)
  s.path.forEach((k) => {
    if (s.placed.some((p) => p.cells.some(([c, r]) => K(c, r) === k))) return;
    const [c, r] = k.split(",").map(Number);
    R(ox + c * CS + 1, oy + r * CS + 1, CS - 2, CS - 2, PATH_TONES[0]);
    R(ox + c * CS + 1, oy + r * CS + 1, CS - 2, 2, PATH_HI);
    R(ox + c * CS + 5, oy + r * CS + 5, 6, 6, C.gold);
  });
}

/** 바깥 칸의 통로: 닫힘(어두운 구멍) · 열림(금색) */
function drawDoor(d: ExitDef, ox: number, oy: number, open: boolean) {
  const x = ox + d.cell[0] * CS, y = oy + d.cell[1] * CS;
  if (open) {
    R(x + 4, y + 4, 8, 8, C.gold);
    R(x + 6, y + 6, 4, 4, "#7A5A1A");
    return;
  }
  R(x + 3, y + 3, 10, 10, "#3A3020");
  R(x + 4, y + 4, 8, 8, "#120f0a");
}

function drawChestMark(x: number, y: number, open: boolean) {
  R(x + 2, y + 6, 12, 8, "#2C1A08");
  R(x + 3, y + 7, 10, 6, "#8A5A22");
  R(x + 3, y + 9, 10, 1, "#5A3A14");
  if (open) {
    R(x + 2, y + 2, 12, 4, "#2C1A08");
    R(x + 3, y + 3, 10, 2, "#6A4418");
    R(x + 4, y + 7, 8, 1, "#1A1006");
  } else {
    R(x + 2, y + 3, 12, 4, "#2C1A08");
    R(x + 3, y + 4, 10, 2, "#A8743A");
    R(x + 7, y + 6, 2, 3, C.gold);
  }
}

/** 채집지 심볼 (16×16 도트). 종류만 알려 준다 — 덤불·나무·꽃밭·돌무더기·물웅덩이·결정·버섯. */
function drawGatherMark(x: number, y: number, kind: GatherKind) {
  switch (kind) {
    case "bush":
      R(x + 3, y + 7, 10, 6, "#3B6D11");
      R(x + 2, y + 9, 12, 4, "#3B6D11");
      R(x + 5, y + 5, 6, 3, "#4F8A1C");
      R(x + 4, y + 8, 3, 2, "#6FA83A");
      R(x + 9, y + 6, 2, 2, "#6FA83A");
      R(x + 10, y + 10, 2, 2, "#2C520C");
      R(x + 3, y + 13, 10, 1, "#1C3407");
      break;
    case "tree":
      R(x + 7, y + 9, 2, 5, "#633806");
      R(x + 6, y + 13, 4, 1, "#412402");
      R(x + 3, y + 3, 10, 7, "#3B6D11");
      R(x + 4, y + 2, 8, 1, "#3B6D11");
      R(x + 4, y + 3, 4, 2, "#6FA83A");
      R(x + 5, y + 7, 2, 2, C.lim);
      R(x + 10, y + 5, 2, 2, C.lim);
      break;
    case "flower":
      R(x + 3, y + 9, 1, 4, "#4F8A1C");
      R(x + 8, y + 7, 1, 6, "#4F8A1C");
      R(x + 12, y + 10, 1, 3, "#4F8A1C");
      R(x + 2, y + 7, 3, 3, "#ED93B1");
      R(x + 7, y + 4, 3, 3, C.gold);
      R(x + 11, y + 8, 3, 3, "#F1EFE8");
      R(x + 3, y + 8, 1, 1, C.gold);
      R(x + 8, y + 5, 1, 1, "#BA7517");
      R(x + 2, y + 13, 12, 1, "#2C520C");
      break;
    case "rubble":
      R(x + 2, y + 9, 6, 4, "#5F5E5A");
      R(x + 7, y + 10, 7, 3, "#5F5E5A");
      R(x + 5, y + 5, 6, 5, "#888780");
      R(x + 5, y + 5, 6, 1, "#B4B2A9");
      R(x + 2, y + 9, 6, 1, "#888780");
      R(x + 9, y + 11, 2, 1, "#BA7517"); // 광석 반짝
      R(x + 2, y + 13, 12, 1, "#2C2C2A");
      break;
    case "pool":
      R(x + 3, y + 6, 10, 7, "#185FA5");
      R(x + 2, y + 8, 12, 3, "#185FA5");
      R(x + 4, y + 7, 8, 5, "#378ADD");
      R(x + 5, y + 8, 4, 1, "#85B7EB");
      R(x + 8, y + 10, 3, 1, "#85B7EB");
      break;
    case "crystal":
      R(x + 3, y + 7, 3, 6, "#7F77DD");
      R(x + 4, y + 5, 1, 2, "#7F77DD");
      R(x + 7, y + 3, 3, 10, "#AFA9EC");
      R(x + 8, y + 2, 1, 1, "#AFA9EC");
      R(x + 11, y + 8, 2, 5, "#378ADD");
      R(x + 8, y + 4, 1, 5, "#ffffff", "opacity='.6'");
      R(x + 2, y + 13, 12, 1, "#3C3489");
      break;
    case "mushroom":
      R(x + 4, y + 9, 2, 4, "#F1EFE8");
      R(x + 2, y + 6, 6, 3, "#D85A30");
      R(x + 3, y + 5, 4, 1, "#D85A30");
      R(x + 3, y + 7, 1, 1, "#F1EFE8");
      R(x + 6, y + 6, 1, 1, "#F1EFE8");
      R(x + 10, y + 10, 2, 3, "#F1EFE8");
      R(x + 9, y + 8, 4, 2, "#7F77DD");
      R(x + 2, y + 13, 12, 1, "#2C2C2A");
      break;
    case "sand":
      // 모래 더미: 낮은 언덕 + 알갱이
      R(x + 2, y + 10, 12, 3, "#C9A86A");
      R(x + 4, y + 8, 8, 2, "#D8BC80");
      R(x + 6, y + 7, 4, 1, "#E6D09C");
      R(x + 5, y + 11, 1, 1, "#8F7440");
      R(x + 9, y + 10, 1, 1, "#8F7440");
      R(x + 11, y + 12, 1, 1, "#3B3A36"); // 검은 알갱이 (화약)
      R(x + 2, y + 13, 12, 1, "#5A4A28");
      break;
    case "corpse":
      // 쓰러진 짐승의 뼈: 두개골 + 갈비뼈
      R(x + 2, y + 8, 4, 4, "#E8E4D8");
      R(x + 3, y + 9, 1, 1, "#2C2C2A");
      R(x + 6, y + 9, 7, 1, "#D3CEBF");
      R(x + 7, y + 7, 1, 5, "#D3CEBF");
      R(x + 9, y + 7, 1, 5, "#D3CEBF");
      R(x + 11, y + 7, 1, 5, "#D3CEBF");
      R(x + 2, y + 13, 12, 1, "#3A2E22");
      break;
    case "web":
      // 거미줄: 방사선 + 고리
      R(x + 8, y + 2, 1, 12, "#D9D7D0", "opacity='.85'");
      R(x + 2, y + 8, 12, 1, "#D9D7D0", "opacity='.85'");
      for (let i = 0; i < 5; i++) { R(x + 4 + i * 2, y + 4 + i * 2, 1, 1, "#D9D7D0"); R(x + 12 - i * 2, y + 4 + i * 2, 1, 1, "#D9D7D0"); }
      R(x + 5, y + 5, 7, 1, "#B4B2A9", "opacity='.7'");
      R(x + 5, y + 11, 7, 1, "#B4B2A9", "opacity='.7'");
      R(x + 5, y + 5, 1, 7, "#B4B2A9", "opacity='.7'");
      R(x + 11, y + 5, 1, 7, "#B4B2A9", "opacity='.7'");
      R(x + 10, y + 6, 2, 2, "#2C2C2A"); // 거미
      break;
  }
}

function drawRestMark(x: number, y: number, used: boolean) {
  // 모닥불: 장작 + 불꽃 (쓰면 재)
  R(x + 3, y + 11, 10, 2, "#5A3A14");
  R(x + 5, y + 10, 6, 1, "#7A5220");
  if (used) { R(x + 5, y + 9, 6, 2, "#5F5E5A"); return; }
  R(x + 6, y + 5, 4, 5, C.lim);
  R(x + 7, y + 3, 2, 3, C.lim);
  R(x + 7, y + 7, 2, 3, "#FFE9A8");
}

function drawSymbols(s: DistrictState, ox: number, oy: number) {
  const def = s.def;
  def.doors.forEach((d) => drawDoor(d, ox, oy, s.path.has(K(...d.cell))));
  if (def.stairs) {
    const [c, r] = def.stairs.cell, x = ox + c * CS, y = oy + r * CS;
    const on = s.path.has(K(c, r));
    if (!on) R(x + 1, y + 1, CS - 2, CS - 2, "#0b0b0a");
    for (let i = 0; i < 4; i++) R(x + 2 + i, y + 3 + i * 3, CS - 4 - i * 2, 2, on ? "#5F5E5A" : "#444441");
  }
  s.gathers.forEach((g) => {
    const x = ox + g.cell[0] * CS, y = oy + g.cell[1] * CS;
    drawGatherMark(x, y, g.kind);
    if (s.gathered.has(K(...g.cell))) R(x + 1, y + 1, CS - 2, CS - 2, "#1A1712", "opacity='.65'"); // 캔 자리: 어둡게
  });
  def.chests.forEach((ch) => {
    if (!chestVisible(ch.id)) return; // 예전 원정에서 연 상자는 안 보인다
    drawChestMark(ox + ch.cell[0] * CS, oy + ch.cell[1] * CS, X.openedNow.has(ch.id));
  });
  def.rests.forEach((rc) => drawRestMark(ox + rc[0] * CS, oy + rc[1] * CS, s.rested.has(K(...rc))));
  // 계단 앞 중간 보스 (이기면 사라진다): 크게, 금색 테두리
  const boss = stairsBoss(s);
  if (boss && !bossBeaten(s) && !s.path.has(K(...boss.cell))) {
    const x = ox + boss.cell[0] * CS, y = oy + boss.cell[1] * CS;
    R(x, y, CS, CS, "none", `stroke='${C.gold}' stroke-width='1'`);
    drawEnemyMark(x, y, CS, "l");
  }
}

/** 놓기 미리보기는 시점·배율을 따라 화면에 바로 그린다 (구운 그림 위) */
function drawGhost(s: DistrictState) {
  if (!UI.placing || busy() || X.stay <= 0) return;
  const h = hoverOrigin();
  if (!h) return;
  const { x: ox, y: oy, cs } = viewOrigin();
  const shape = curShape();
  const piece = curPiece();
  const ok = canPlace(s, shape, h.c, h.r);
  const fieldCells = new Set(fieldSymbolCells(s));
  shape.forEach(([dc, dr], i) => {
    const c = h.c + dc, r = h.r + dr;
    if (cell(s.def, c, r) === " " && !ok) return;
    const x = ox + c * cs, y = oy + r * cs;
    R(x + 1, y + 1, cs - 2, cs - 2, ok ? PATH_HI : C.hp, `opacity='${ok ? 0.55 : 0.4}'`);
    const sym = fieldCells.has(K(c, r)) ? undefined : piece.syms.find((y2) => y2.idx === i); // 필드 심볼 칸에서는 타일 심볼이 사라진다
    if (sym?.kind === "enemy") drawEnemyMark(x, y, cs, sym.size, 0.85);
    else if (sym?.kind === "item") drawItemMark(x, y, cs);
    else if (sym?.kind === "gather") drawGatherMark(x, y, sym.gather);
    if (!ok || !canSee(s, c, r)) return;
    const gain = s.gathers.some((g) => same(g.cell, c, r) && !s.gathered.has(K(c, r)))
      || s.def.chests.some((ch) => same(ch.cell, c, r) && chestVisible(ch.id) && !X.openedNow.has(ch.id))
      || s.def.rests.some((rc) => same(rc, c, r) && !s.rested.has(K(c, r)));
    if (gain) {
      const m = Math.round(cs * 0.5) - 1, l = Math.round(cs * 0.6), o2 = Math.round(cs * 0.2);
      R(x + m, y + o2, 2, l, C.good);
      R(x + o2, y + m, l, 2, C.good);
    }
  });
}

// ---------- 구운 그림 (판 + 시야) ----------
let world: { cv: HTMLCanvasElement; g: CanvasRenderingContext2D; key: string } | null = null;

/** 그림을 바꾸는 값. 이게 같으면 다시 굽지 않는다. */
function worldKey(s: DistrictState) {
  return [s.def.id, s.path.size, s.placed.length, s.gathered.size, s.rested.size, X.openedNow.size, X.beaten.size, X.pending.length, X.seed, visionOf(X), s.lights.join(";")].join("|");
}

function bakeWorld(s: DistrictState) {
  const key = worldKey(s);
  if (world?.key === key) return world.cv;
  const { w, h } = worldSize(s.def);
  if (!world || world.cv.width !== w || world.cv.height !== h) {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const g = cv.getContext("2d", { willReadFrequently: true })!;
    g.imageSmoothingEnabled = false;
    world = { cv, g, key };
  }
  world.key = key;
  const g = world.g;
  g.fillStyle = VOID;
  g.fillRect(0, 0, w, h);
  withPen(g, () => {
    drawBoardBase(s.def, CS, CS);
    drawPath(s, CS, CS);
    drawSymbols(s, CS, CS);
  });
  // 시야: 칸마다 단계만큼 블록으로 뭉개고 어둡게
  const img = g.getImageData(0, 0, w, h);
  const a = img.data;
  const last = VISION.blocks.length - 1;
  for (let wy = 0; wy < h; wy += CS) for (let wx = 0; wx < w; wx += CS) {
    const lv = s.vis.get(K(wx / CS - 1, wy / CS - 1)) ?? last;
    if (lv === 0) continue;
    const b = VISION.blocks[lv], keep = 1 - VISION.dims[lv];
    for (let by = wy; by < wy + CS; by += b) for (let bx = wx; bx < wx + CS; bx += b) {
      let rr = 0, gg = 0, bb = 0;
      for (let y = by; y < by + b; y++) for (let x = bx; x < bx + b; x++) {
        const i = (y * w + x) * 4;
        rr += a[i]; gg += a[i + 1]; bb += a[i + 2];
      }
      const n = b * b;
      rr = (rr / n) * keep; gg = (gg / n) * keep; bb = (bb / n) * keep;
      for (let y = by; y < by + b; y++) for (let x = bx; x < bx + b; x++) {
        const i = (y * w + x) * 4;
        a[i] = rr; a[i + 1] = gg; a[i + 2] = bb;
      }
    }
  }
  g.putImageData(img, 0, 0);
  return world.cv;
}

/** 창 가장자리 시점 이동 화살표: 평소 반투명, 마우스를 올리면 드러난다 */
const ARROWS: Array<{ key: string; dx: number; dy: number; x: number; y: number; w: number; h: number }> = [
  { key: "pan:l", dx: -1, dy: 0, x: VIEW.x, y: VIEW.y + 96, w: 12, h: 44 },
  { key: "pan:r", dx: 1, dy: 0, x: VIEW.x + VIEW.w - 12, y: VIEW.y + 96, w: 12, h: 44 },
  { key: "pan:u", dx: 0, dy: -1, x: VIEW.x + 79, y: VIEW.y, w: 44, h: 12 },
  { key: "pan:d", dx: 0, dy: 1, x: VIEW.x + 79, y: VIEW.y + VIEW.h - 12, w: 44, h: 12 },
];

function drawArrow(a: (typeof ARROWS)[number], hover: boolean) {
  const ex = `opacity='${hover ? 0.95 : 0.22}'`;
  const col = hover ? C.gold : C.txt;
  const cx = a.x + Math.floor(a.w / 2), cy = a.y + Math.floor(a.h / 2);
  for (let i = 0; i < 7; i++) {
    const len = 1 + (6 - i) * 2 + 1; // 끝이 뾰족한 삼각형: 안쪽이 넓다
    const o = 3 - i;
    if (a.dx) R(cx + o * -a.dx - 0, cy - (len >> 1), 1, len, col, ex);
    else R(cx - (len >> 1), cy + o * -a.dy, len, 1, col, ex);
  }
}

function drawField(s: DistrictState) {
  const g = pen();
  R(VIEW.x, VIEW.y, VIEW.w, VIEW.h, VOID);
  g.save();
  g.beginPath();
  g.rect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
  g.clip();
  const cv = bakeWorld(s);
  const o = viewOrigin(), z = ZOOMS[UI.zoom];
  g.drawImage(cv, o.x - o.cs, o.y - o.cs, cv.width * z, cv.height * z);
  drawGhost(s);
  drawLightPreview(s);
  g.restore();
  R(VIEW.x - 1, VIEW.y - 1, VIEW.w + 2, 1, C.woodD);
  R(VIEW.x - 1, VIEW.y + VIEW.h, VIEW.w + 2, 1, C.woodD);
  R(VIEW.x - 1, VIEW.y, 1, VIEW.h, C.woodD);
  R(VIEW.x + VIEW.w, VIEW.y, 1, VIEW.h, C.woodD);
  // 열린 통로 칸 클릭으로 이동 (창 안에 보일 때만)
  openDoors(s).forEach((d) => {
    const x = o.x + d.cell[0] * o.cs, y = o.y + d.cell[1] * o.cs;
    if (inView({ x: x + o.cs / 2, y: y + o.cs / 2 })) hit(x, y, o.cs, o.cs, `door:${d.to}`);
  });
  ARROWS.forEach((a) => hit(a.x, a.y, a.w, a.h, a.key));
  const hk = UI.mouse ? hitAt(UI.mouse) : null;
  ARROWS.forEach((a) => drawArrow(a, hk === a.key));
}

/** 타일 하나를 상자 가운데에 (심볼 포함) */
function drawPieceBox(p: QueuedPiece, x: number, y: number, w: number, h: number, cs: number, rot: 0 | 1 | 2 | 3 = 0, flip = false, col = PATH_TONES[0], lifted = false) {
  const shape = applyRotFlip(PATH_PIECES[p.id].cells, rot, flip);
  const b = bounds(shape);
  const px = x + Math.floor((w - (b.maxC + 1) * cs) / 2), py = y + Math.floor((h - (b.maxR + 1) * cs) / 2);
  shape.forEach(([c, r], i) => {
    if (lifted) {
      // 배치 모드: 칸에서 집어 든 자국 — 회색 반투명
      R(px + c * cs, py + r * cs, cs - 1, cs - 1, "#8A8880", "opacity='.45'");
      return;
    }
    R(px + c * cs, py + r * cs, cs - 1, cs - 1, col);
    R(px + c * cs, py + r * cs, cs - 1, Math.max(1, cs >> 3), PATH_HI);
    const sym = p.syms.find((y2) => y2.idx === i);
    if (sym?.kind === "enemy") drawEnemyMark(px + c * cs, py + r * cs, cs - 1, sym.size);
    else if (sym?.kind === "item") drawItemMark(px + c * cs, py + r * cs, cs - 1);
    else if (sym?.kind === "gather") drawGatherDot(px + c * cs, py + r * cs, cs - 1, sym.gather);
  });
}

function panel(x: number, y: number, w: number, h: number, title?: string) {
  R(x, y, w, h, C.woodD);
  R(x + 1, y + 1, w - 2, h - 2, "#141210");
  if (title) T(x + 5, y + 10, title, 7, C.gold);
}

/** 왼쪽 기능 메뉴. 항목을 늘릴 자리를 남겨 둔다 (패널은 출현 가능한 적 위까지). */
const MENU_ITEMS: Array<{ key: string; label: string; arrow?: boolean }> = [
  { key: "menu:party", label: "파티" },
  { key: "menu:form", label: "대열" },
  { key: "menu:bag", label: "가방" },
  { key: "menu:status", label: "스테이터스" },
  { key: "menu:skill", label: "탐색 스킬", arrow: true },
];
const MENU_X = 4, MENU_Y = 20, MENU_ROW_H = 20;
const FLY = { x: 136, w: 132, rowH: 22, maxRows: 4 };

function drawLeft() {
  panel(MENU_X, MENU_Y, 130, 194, "메뉴");
  MENU_ITEMS.forEach((m, i) => {
    const y = MENU_Y + 14 + i * (MENU_ROW_H + 2);
    const on = m.key === "menu:skill" && UI.skillsOpen;
    hit(MENU_X + 4, y, 122, MENU_ROW_H, m.key);
    R(MENU_X + 4, y, 122, MENU_ROW_H, on ? "#3A4A1E" : UI.mouse && hitAt(UI.mouse) === m.key ? "#3A3224" : "#2A2418");
    T(MENU_X + 12, y + 14, m.label, 8, C.txt);
    if (m.arrow) T(MENU_X + 120, y + 14, "▶", 7, C.sub, "end");
  });
  // 출현 가능한 적: 조우한 적은 자리표시 초상화, 아직이면 ? (TODO(spec): 몬스터 초상화 그림)
  panel(4, 218, 130, 38, "출현 가능한 적");
  st().def.monsters.forEach((id, i) => {
    const x = 9 + i * 18, y = 231, known = isEncountered(id);
    R(x, y, 16, 16, known ? MONSTER_DB[id].color : "#2A2622", `stroke='${C.cellExt}' stroke-width='1'`);
    if (known) {
      R(x + 4, y + 6, 2, 2, C.gold);
      R(x + 10, y + 6, 2, 2, C.gold);
    } else T(x + 8, y + 12, "?", 8, C.sub, "middle");
    hit(x, y, 16, 16, `mon:${id}`);
  });
  T(6, 266, `시야 ${visionOf(X).toFixed(1)}`, 6, C.sub);
}

/** 탐색 스킬 목록 행: 사용형(층마다 횟수) + 코어 판에 꽂힌 탐색 패시브(등불·학습 …, 2026-11-07). */
type FlyRow =
  | { kind: "use"; sk: (typeof EXPLORE_SKILLS)[number] }
  | { kind: "passive"; name: string; owner: string; desc: string; id: string }
  | { kind: "light"; name: string; owner: string; desc: string; id: string; radius: number; mp: number };
function flyRows(): FlyRow[] {
  const pas: FlyRow[] = exploreMods().owners.map((o): FlyRow => {
    const lt = o.skill.explore?.light;
    const base = { name: o.skill.name, owner: o.name, desc: o.skill.lines.join(" "), id: o.skill.id };
    return lt ? { kind: "light", ...base, radius: lt.radius, mp: lt.mp } : { kind: "passive", ...base };
  });
  return [...EXPLORE_SKILLS.map((sk) => ({ kind: "use" as const, sk })), ...pas];
}

/** 탐색 스킬 하위 목록: 메뉴 옆으로 펼친다. 많아지면 휠로 스크롤. 패시브는 늘 켜져 있어 클릭하지 않는다. */
function drawSkillFlyout() {
  if (!UI.skillsOpen) return;
  const all = flyRows();
  const rows = Math.min(FLY.maxRows, all.length);
  const y0 = MENU_Y + 14 + MENU_ITEMS.findIndex((m) => m.key === "menu:skill") * (MENU_ROW_H + 2);
  const h = rows * FLY.rowH + 4;
  R(FLY.x, y0, FLY.w, h, C.woodD);
  R(FLY.x + 1, y0 + 1, FLY.w - 2, h - 2, "#141210");
  hit(FLY.x, y0, FLY.w, h, "fly");
  all.slice(UI.skillScroll, UI.skillScroll + rows).forEach((row, i) => {
    const y = y0 + 2 + i * FLY.rowH;
    if (row.kind === "light") {
      // 사용형 (MP): 누르면 밝힐 길 칸 고르기. MP가 모자라면 흐리게
      const key = `lskill:${row.id}:${row.owner}`;
      const mp = vitalsOf(row.owner).mp;
      const ok = mp >= row.mp;
      const on = UI.lighting?.owner === row.owner;
      hit(FLY.x + 3, y, FLY.w - 8, 20, key);
      R(FLY.x + 3, y, FLY.w - 8, 20, on ? "#3A4A1E" : UI.mouse && hitAt(UI.mouse) === key && ok ? "#3A3224" : ok ? "#2A2418" : "#1C1A16");
      R(FLY.x + 3, y, 2, 20, PARTY.find((p) => p.name === row.owner)?.color ?? C.sub);
      T(FLY.x + 9, y + 9, row.name, 8, ok ? C.txt : C.cellExt);
      T(FLY.x + 9, y + 17, row.owner, 6, C.sub);
      T(FLY.x + FLY.w - 8, y + 9, `MP ${row.mp}`, 6, ok ? C.mp : C.hp, "end");
      T(FLY.x + FLY.w - 8, y + 17, `${mp}`, 6, C.sub, "end");
      return;
    }
    if (row.kind === "passive") {
      const key = `pskill:${row.id}`;
      hit(FLY.x + 3, y, FLY.w - 8, 20, key);
      R(FLY.x + 3, y, FLY.w - 8, 20, "#1E2A16");
      R(FLY.x + 3, y, 2, 20, PARTY.find((p) => p.name === row.owner)?.color ?? C.sub);
      T(FLY.x + 9, y + 9, row.name, 8, C.good);
      T(FLY.x + 9, y + 17, row.owner, 6, C.sub);
      T(FLY.x + FLY.w - 8, y + 9, "패시브", 6, C.good, "end");
      return;
    }
    const sk = row.sk;
    const left = X.uses[sk.id];
    const active = (sk.id === "mirror" && X.flip) || (sk.id === "foresee" && st().foresee);
    const key = `skill:${sk.id}`;
    hit(FLY.x + 3, y, FLY.w - 8, 20, key);
    R(FLY.x + 3, y, FLY.w - 8, 20, active ? "#3A4A1E" : UI.mouse && hitAt(UI.mouse) === key ? "#3A3224" : left > 0 ? "#2A2418" : "#1C1A16");
    R(FLY.x + 3, y, 2, 20, PARTY.find((p) => p.name === sk.owner)?.color ?? C.sub);
    T(FLY.x + 9, y + 9, sk.name, 8, left > 0 ? C.txt : C.cellExt);
    T(FLY.x + 9, y + 17, sk.owner, 6, C.sub);
    for (let k = 0; k < sk.uses; k++) R(FLY.x + FLY.w - 13 - k * 6, y + 4, 4, 4, k < left ? C.gold : C.cell);
  });
  if (all.length > rows) {
    const trackH = h - 4, barH = Math.max(8, Math.round((trackH * rows) / all.length));
    const barY = y0 + 2 + Math.round(((trackH - barH) * UI.skillScroll) / (all.length - rows));
    R(FLY.x + FLY.w - 3, barY, 2, barH, C.cellExt);
  }
}

/** 모래시계 (도트, 11×17). k = 남은 비율(위쪽 모래). warn이면 붉게. */
function drawHourglass(x: number, y: number, k: number, warn: boolean) {
  const frame = "#C9A24A", glass = "#3A3328", sand = warn ? C.hp : "#F2D58A";
  R(x, y, 11, 2, frame);
  R(x, y + 15, 11, 2, frame);
  // 위 유리 4줄 (넓→좁), 허리, 아래 유리 4줄 (좁→넓)
  const top = [[1, 9], [2, 7], [3, 5], [4, 3]];
  const bottom = [[4, 3], [3, 5], [2, 7], [1, 9]];
  const topSand = Math.round(4 * k);
  top.forEach(([ox, w], i) => R(x + ox, y + 2 + i * 1.5, w, 2, 4 - i <= topSand ? sand : glass));
  R(x + 5, y + 8, 1, 1, sand);
  bottom.forEach(([ox, w], i) => R(x + ox, y + 9 + i * 1.5, w, 2, i >= topSand ? sand : glass));
}

function drawRight() {
  const s = st();
  const p = curPiece();
  panel(PANEL_R, 20, 134, 76, "현재 타일");
  R(PANEL_R + 6, 32, 60, 60, "#0E0D0B");
  drawPieceBox(p, PANEL_R + 6, 32, 60, 60, 12, X.rot, X.flip, PATH_TONES[0], UI.placing);
  if (UI.placing) R(PANEL_R + 6, 32, 60, 60, "none", `stroke='${C.gold}' stroke-width='1'`);
  hit(PANEL_R + 6, 32, 60, 60, "piece:0");
  T(PANEL_R + 72, 42, PATH_PIECES[p.id].name, 8, C.txt);
  const en = enemyCount(p);
  T(PANEL_R + 72, 54, `${PATH_PIECES[p.id].cells.length}칸${X.flip ? " · 뒤집음" : ""}`, 6, C.sub);
  if (en) T(PANEL_R + 128, 54, `적 ${en}`, 7, C.hp, "end");
  T(PANEL_R + 72, 68, "다음", 6, C.sub);
  const n = Math.min(NEXT_SLOTS, exploreMods().foresee + (s.foresee ? NEXT_SLOTS : 0));
  for (let i = 0; i < NEXT_SLOTS; i++) {
    const x = PANEL_R + 72 + i * 20, y = 72;
    R(x, y, 18, 18, "#0E0D0B");
    if (i < n) { drawPieceBox(s.queue[i + 1], x, y, 18, 18, 4, 0, false, "#8F7650"); hit(x, y, 18, 18, `piece:${i + 1}`); }
    else T(x + 9, y + 12, "?", 7, C.cellExt, "middle");
  }

  // 작은 미니맵: 지금 구획을 가운데 두고 주변을 본다 (전체는 클릭해서 큰 보기). 지금·지나온 구획, 발견한 통로 너머는 ?
  panel(PANEL_R, 100, 134, 96, `미니맵 ${FLOOR.name}`);
  hit(PANEL_R, 100, 134, 96, "minimap");
  const gw = 36, gh = 24;
  const curDef = s.def;
  const mx = PANEL_R + 52 - curDef.pos[0] * gw, my = 144 - curDef.pos[1] * gh; // 구획 상자(30×18)의 왼쪽 위 기준
  const box = { x: PANEL_R + 2, y: 113, w: 130, h: 81 };
  const vis = (id: string) => districtVisibility(FLOOR, id);
  const g = pen();
  g.save();
  g.beginPath();
  g.rect(box.x, box.y, box.w, box.h);
  g.clip();
  FLOOR.districts.forEach((d) => d.doors.forEach((door) => {
    const t = districtDef(door.to);
    if (vis(d.id) === "hidden" || vis(t.id) === "hidden" || !(isDoorSeen(d.id, t.id) || isDoorSeen(t.id, d.id))) return;
    const ax = mx + d.pos[0] * gw + 14, ay = my + d.pos[1] * gh + 8, bx = mx + t.pos[0] * gw + 14, by = my + t.pos[1] * gh + 8;
    R(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax) + 2, Math.abs(by - ay) + 2, C.cellExt);
  }));
  FLOOR.districts.forEach((d) => {
    const v = vis(d.id);
    if (v === "hidden") return;
    const x = mx + d.pos[0] * gw, y = my + d.pos[1] * gh;
    // 창에 걸친 만큼만 툴팁 자리로 잡는다 (패널 밖으로 삐져나간 부분은 안 보인다)
    const hx = Math.max(box.x, x), hy = Math.max(box.y, y), hw = Math.min(box.x + box.w, x + 30) - hx, hh = Math.min(box.y + box.h, y + 18) - hy;
    if (hw > 0 && hh > 0) hit(hx, hy, hw, hh, `dist:${d.id}`);
    if (v === "unknown") {
      R(x, y, 30, 18, "#2A2622", `stroke='${C.cellExt}' stroke-width='1'`);
      T(x + 15, y + 13, "?", 8, C.sub, "middle");
      return;
    }
    R(x, y, 30, 18, d.id === X.cur ? C.gold : d.color);
    if (d.id !== X.cur) R(x + 1, y + 1, 28, 16, "#000000", "opacity='.3'");
    if (openDoors(s).some((door) => door.to === d.id)) {
      R(x - 1, y - 1, 32, 1, C.good);
      R(x - 1, y + 18, 32, 1, C.good);
    }
    if (d.stairs) R(x + 24, y + 12, 4, 4, "#0b0b0a");
  });
  g.restore();

  // 체류 시간 · 귀환
  panel(PANEL_R, 200, 134, 56);
  const warn = X.stay <= 3;
  drawHourglass(PANEL_R + 8, 207, Math.max(0, Math.min(1, X.stay / X.stayMax)), warn);
  T(PANEL_R + 24, 222, `${X.stay}`, 16, warn ? C.hp : C.txt);
  T(PANEL_R + 27 + textWidth(`${X.stay}`, 16), 222, "회 남음", 7, C.sub);
  hit(PANEL_R + 4, 204, 90, 22, "stay");
  T(PANEL_R + 128, 213, `전투 ${X.battles}`, 6, C.sub, "end");
  const stairsReached = !!s.def.stairs && s.path.has(K(...s.def.stairs.cell));
  const mustReturn = X.stay <= 0 || (!busy() && !anyPlacement(s));
  if (stairsReached) {
    btn(PANEL_R + 6, 236, 60, "내려가기", true);
    hit(PANEL_R + 6, 236, 60, 14, "descend");
    btn(PANEL_R + 68, 236, 60, "귀환", mustReturn);
    hit(PANEL_R + 68, 236, 60, 14, "return");
  } else {
    btn(PANEL_R + 6, 236, 122, "귀환", mustReturn);
    hit(PANEL_R + 6, 236, 122, 14, "return");
  }
}

function draw() {
  hits = [];
  R(0, 0, 480, 270, C.screenBg);
  const s = st();
  drawField(s);
  drawRight();
  drawLeft();
  drawSkillFlyout();
  // 위쪽 바는 판 그림보다 나중에 — 시점을 옮겨도 그 위로 안 올라오게
  R(0, 0, 480, 16, C.dark);
  T(6, 11, `${DUNGEON.name} ${FLOOR.name}`, 8);
  R(84, 4, 8, 8, s.def.color);
  T(96, 11, s.def.name, 8, C.gold);
  const hx = 100 + Math.ceil(textWidth(s.def.name, 8));
  T(hx, 11, fitText(s.def.habitat, 424 - hx, 6), 6, C.sub);
  btn(430, 1, 46, "메뉴");
  T(140, 265, UI.placing ? "클릭 놓기 · 휠/R 회전 · F 반전 · 우클릭 취소 · WASD 시점" : "현재 타일 클릭: 배치 · 휠 확대/축소 · WASD 시점", 6, UI.placing ? C.gold : C.sub);

  if (UI.bannerT > 0) {
    const w = 196;
    R(VIEW.x + 3, 232, w, 20, "rgba(4,6,12,.9)", `stroke='${C.gold}' stroke-width='1'`);
    T(VIEW.x + 3 + w / 2, 245, fitText(UI.banner, w - 8, 6), 6, C.gold, "middle");
  }
  if (discoveryFx.active) { discoveryFx.draw(); return; } // 연출 중엔 툴팁 없음
  if (bigMap.active) { bigMap.draw(); return; }
  if (UI.mouse && hitAt(UI.mouse) === "menu:party") return drawPartyTip(UI.mouse.x, UI.mouse.y);
  const tip = tooltip();
  if (tip && UI.mouse) drawTooltip(UI.mouse.x, UI.mouse.y, tip);
}

/** 파티 툴팁: 이름 + HP 바(10칸) + 수치만 */
function drawPartyTip(mx: number, my: number) {
  const w = 164, rowH = 13, h = PARTY.length * rowH + 6;
  const x = Math.min(480 - w - 2, mx + 12), y = Math.min(270 - h - 2, my + 12);
  R(x, y, w, h, C.tipBg, `stroke='${C.tipLine}' stroke-width='1'`);
  PARTY.forEach((p, i) => {
    const v = vitalsOf(p.name), ry = y + 4 + i * rowH;
    R(x + 5, ry, 9, 9, p.color);
    T(x + 18, ry + 8, p.name, 7, C.txt);
    G(x + 52, ry + 2, 10, 0, Math.ceil((v.hp / v.hpMax) * 10), 5);
    T(x + w - 5, ry + 8, `${v.hp}/${v.hpMax}`, 6, C.sub, "end");
  });
}

function hitAt(p: { x: number; y: number }) {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (p.x >= h.x && p.x < h.x + h.w && p.y >= h.y && p.y < h.y + h.h) return h.key;
  }
  return null;
}

function symLines(p: QueuedPiece) {
  return p.syms.map((y) =>
    y.kind === "enemy"
      ? { text: `적: ${y.mons.map((m) => (isEncountered(m) ? MONSTER_DB[m].name : "?")).join("·")}`, color: C.hp }
      : y.kind === "gather"
        ? { text: `채집지: ${GATHER_KINDS[y.gather].name}`, color: C.good }
        : { text: `아이템: ${PIECES[y.item].name}`, color: C.gold }
  );
}

function tooltip(): TooltipContent | null {
  const m = UI.mouse;
  if (!m) return null;
  const key = hitAt(m);
  if (key?.startsWith("pskill:")) {
    const r = flyRows().find((x) => x.kind === "passive" && `pskill:${x.id}` === key);
    if (r && r.kind === "passive") return { title: r.name, attrs: `${r.owner} · 탐색 패시브 (스킬 코어)`, desc: r.desc, hint: "항상 적용" };
  }
  if (key?.startsWith("lskill:")) {
    const r = flyRows().find((x) => x.kind === "light" && `lskill:${x.id}:${x.owner}` === key);
    if (r && r.kind === "light") {
      const mp = vitalsOf(r.owner).mp;
      return { title: r.name, attrs: `${r.owner} · 탐색 스킬 (스킬 코어) · MP ${r.mp}`, desc: r.desc, hint: mp >= r.mp ? `클릭 → 밝힐 길 칸 클릭 (남은 MP ${mp})` : `MP가 모자라다 (남은 MP ${mp})` };
    }
  }
  if (key?.startsWith("skill:")) {
    const sk = EXPLORE_SKILLS.find((x) => `skill:${x.id}` === key)!;
    return { title: sk.name, attrs: `${sk.owner} · 층마다 ${sk.uses}회 · 남은 ${X.uses[sk.id]}회`, desc: sk.desc, hint: "클릭해서 사용" };
  }
  if (key?.startsWith("piece:")) {
    const p = st().queue[Number(key.slice(6))];
    const lines = symLines(p);
    return {
      title: PATH_PIECES[p.id].name, attrs: `길 타일 · ${PATH_PIECES[p.id].cells.length}칸`,
      sections: [{ heading: "붙은 심볼", lines: lines.length ? lines : [{ text: "없음", color: C.sub }] }],
      hint: key === "piece:0" ? (UI.placing ? "클릭: 배치 취소" : "클릭: 배치 모드") : "놓으면 적 심볼마다 전투",
    };
  }
  if (key?.startsWith("mon:")) {
    const id = key.slice(4), mon = MONSTER_DB[id];
    return isEncountered(id)
      ? { title: mon.name, attrs: `Lv${mon.lv}`, desc: mon.dex.desc }
      : { title: "?", attrs: "조우한 적 없음", desc: "이 구획 어딘가에 도사리고 있다." };
  }
  if (key?.startsWith("dist:")) return districtTooltip(FLOOR, districtDef(key.slice(5)), X.cur);
  if (key?.startsWith("pan:")) return { title: "시점 이동", hint: "누르고 있으면 이동 · WASD·방향키도 같다" };
  if (key === "stay") {
    return {
      title: "체류 시간", attrs: `남은 배치 ${X.stay} · 시작 ${X.stayMax}`,
      desc: "도트의 힘을 버틸 수 있는 시간. 타일을 하나 놓을 때마다 1 줄고, 다 되면 귀환해야 한다.",
      sections: [
        { heading: "쓰는 것", lines: [{ text: "타일 하나 놓기 −1" }, { text: `문을 지나 다른 구획으로 −${STAY.doorCost}` }] },
        { heading: "늘리기", lines: [{ text: `휴식 포인트를 길로 덮으면 +${STAY.restBonus}` }, { text: "성장할수록 시작 값이 늘어난다", color: C.sub }] },
      ],
    };
  }
  if (key === "return") return { title: "귀환", desc: "원정을 마치고 소재를 가지고 거점으로 돌아간다." };
  if (key === "descend") return { title: "아래로 내려가기", desc: "다음 층으로. 올라올 수 없다." };
  if (key?.startsWith("door:")) {
    const to = key.slice(5);
    return { title: "통로", desc: `${districtVisibility(FLOOR, to) === "known" ? districtDef(to).name : "?"}(으)로 이어진다.`, hint: `클릭해서 이동 · 체류 −${STAY.doorCost}` };
  }
  // 판 위 심볼
  const s = st();
  if (!inView(m)) return null;
  const o = viewOrigin();
  const c = Math.floor((m.x - o.x) / o.cs), r = Math.floor((m.y - o.y) / o.cs);
  if (!canSee(s, c, r)) return null; // 어둠 속은 알 수 없다
  const pend = pendingSym();
  if (pend && X.pending[0].district === X.cur && same(pend.cell, c, r)) {
    return { title: "적 무리", sections: [{ heading: "구성", lines: pend.mons.map((id) => ({ text: `${MONSTER_DB[id].name} Lv${MONSTER_DB[id].lv}` })) }], hint: "클릭하면 전투" };
  }
  const bs = stairsBoss(s);
  if (bs && same(bs.cell, c, r) && !bossBeaten(s)) {
    const m = MONSTER_DB[bs.id];
    return { title: `중간 보스: ${isEncountered(bs.id) ? m.name : "?"}`, attrs: isEncountered(bs.id) ? `Lv${m.lv}` : "", desc: "계단 앞을 지키고 있다. 쓰러뜨려야 아래로 내려갈 수 있다.", hint: "이 칸을 길로 덮으면 전투" };
  }
  const ga = s.gathers.find((g) => same(g.cell, c, r));
  if (ga) {
    const k = GATHER_KINDS[ga.kind];
    return { title: k.name, attrs: "채집지 · 무엇이 나올지는 캐 봐야 안다", desc: k.hint, hint: s.gathered.has(K(c, r)) ? "이번 원정에서 캤다" : "길로 덮으면 채집" };
  }
  const ch = s.def.chests.find((x) => same(x.cell, c, r) && chestVisible(x.id));
  if (ch) return { title: "보물상자", desc: X.openedNow.has(ch.id) ? "열린 상자. 비어 있다." : "길로 덮으면 연다. 한 번 열면 다시 나오지 않는다." };
  const rc = s.def.rests.find((x) => same(x, c, r));
  if (rc) return { title: "휴식 포인트", desc: `길로 덮으면 체류 시간 +${STAY.restBonus}.`, hint: s.rested.has(K(c, r)) ? "이번 원정에서 썼다" : "TODO(spec): 회복 효과" };
  if (s.def.stairs && same(s.def.stairs.cell, c, r)) return { title: "아래로 가는 구멍", desc: "바로 앞 칸까지 길을 이으면 내려갈 수 있다." };
  if (s.def.doors.some((d) => same(d.cell, c, r))) return { title: "통로", desc: "바로 앞 칸까지 길을 이으면 지나갈 수 있다." };
  return null;
}

function onPointerDown(p: { x: number; y: number }, button: number) {
  UI.mouse = p; // 움직임 없이 바로 누른 경우에도 그 칸 기준으로
  if (discoveryFx.active) return advanceDiscovery();
  if (bigMap.active) return bigMap.onPointerDown(p, button);
  if (UI.engageT > 0 || UI.lootT > 0) return;
  if (button === 2) {
    if (UI.lighting) { UI.lighting = null; return banner("라이트 취소"); }
    if (UI.placing) cancelPlacing(); // 맵 확인 상태에서는 우클릭 기능 없음
    return;
  }
  const key = hitAt(p);
  if (key === "piece:0" && !UI.skillsOpen) return UI.placing ? cancelPlacing() : startPlacing();
  if (key === "menu:skill") { UI.skillsOpen = !UI.skillsOpen; return; }
  if (UI.skillsOpen && key !== "fly" && !key?.startsWith("skill:") && !key?.startsWith("pskill:") && !key?.startsWith("lskill:")) { UI.skillsOpen = false; return; } // 바깥 클릭은 닫기만
  if (key?.startsWith("lskill:")) return startLight(key);
  if (UI.lighting) return pickLight();
  if (key?.startsWith("pskill:")) return;
  if (key === "menu:form") return goToWithBack("d06", "d01");
  if (key === "menu:bag") return goToWithBack("d03", "d01");
  if (key === "menu:status") return goToWithBack("p01", "d01");
  if (key?.startsWith("pan:")) {
    const a = ARROWS.find((x) => x.key === key)!;
    UI.panArrow = [a.dx, a.dy];
    return;
  }
  if (key === "minimap" || key?.startsWith("dist:")) return bigMap.open(FLOOR, X.cur);
  if (key?.startsWith("skill:")) return useSkill(key.slice(6) as ExploreSkillId);
  if (key?.startsWith("door:")) return goThrough(key.slice(5));
  if (key === "return") return returnHome(X.stay <= 0 ? "체류 시간 끝" : "귀환");
  if (key === "descend") return descend();
  const h = hoverOrigin();
  if (X.pending.length) {
    const e = pendingSym()!;
    if (h && X.pending[0].district === X.cur && same(e.cell, h.hc, h.hr)) engage();
    else banner("전투가 남아 있다 — 금색 테두리 적을 클릭하면 전투");
    return;
  }
  if (h && UI.placing) place(h.c, h.r);
}

// ---------- 라이트 (2026-11-08, exploration.md 7장) ----------
/** 마우스 아래 칸 (구획 밖 입구 칸도 — 깔린 길에 포함되므로) */
function cellUnderMouse(): { hc: number; hr: number } | null {
  const m = UI.mouse;
  if (!m || !inView(m)) return null;
  const o = viewOrigin();
  return { hc: Math.floor((m.x - o.x) / o.cs), hr: Math.floor((m.y - o.y) / o.cs) };
}
/** 탐색 메뉴에서 라이트를 누름: MP가 되면 밝힐 칸 고르기로 */
function startLight(key: string) {
  const r = flyRows().find((x) => x.kind === "light" && `lskill:${x.id}:${x.owner}` === key);
  if (!r || r.kind !== "light" || busy()) return;
  if (vitalsOf(r.owner).mp < r.mp) return banner(`${r.owner}의 MP가 모자라다 (MP ${r.mp} 필요)`);
  if (UI.placing) cancelPlacing();
  UI.skillsOpen = false;
  UI.lighting = { owner: r.owner, radius: r.radius, mp: r.mp };
  banner("라이트 — 밝힐 길 칸을 클릭 · 우클릭 취소");
}
/** 밝힐 칸 클릭: 깔린 길 칸이어야 한다. MP를 쓰고 그 칸에서 반경만큼 밝힌다. */
function pickLight() {
  const L = UI.lighting!;
  const h = cellUnderMouse();
  const s = st();
  if (!h || !s.path.has(K(h.hc, h.hr))) return banner("길이 깔린 칸을 골라야 한다 · 우클릭 취소");
  if (!spendVital(L.owner, "mp", L.mp)) { UI.lighting = null; return banner("MP가 모자라다"); }
  s.lights.push([h.hc, h.hr, L.radius]);
  refreshVision(X, s);
  UI.lighting = null;
  banner(`라이트 — 주변 ${L.radius}칸이 밝아졌다 (${L.owner} MP −${L.mp}) · 다음 타일을 놓으면 꺼진다`);
}
/** 라이트 고르는 중: 마우스 아래 길 칸에서 반경 안 칸을 옅게 표시 */
function drawLightPreview(s: DistrictState) {
  const L = UI.lighting;
  if (!L) return;
  const h = cellUnderMouse();
  if (!h) return;
  const { x: ox, y: oy, cs } = viewOrigin();
  const ok = s.path.has(K(h.hc, h.hr));
  const { cols, rows } = dims(s.def);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (Math.hypot(c - h.hc, r - h.hr) > L.radius || cell(s.def, c, r) === " ") continue;
    R(ox + c * cs + 1, oy + r * cs + 1, cs - 2, cs - 2, ok ? "#FFF3C0" : C.hp, "opacity='0.22'");
  }
  R(ox + h.hc * cs, oy + h.hr * cs, cs, cs, "none", `stroke='${ok ? "#ffffff" : C.hp}' stroke-width='1'`);
}

function advanceDiscovery() {
  if (!discoveryFx.advance()) return;
  UI.discoveries.shift();
  if (UI.discoveries.length) discoveryFx.start(UI.discoveries[0]);
  else afterEvents();
}

X = newExpedition(20261104);

// 개발용: 콘솔에서 상태 확인·자동 배치 (`__d01.state()`, `__d01.place(c, r, rot)`, `__d01.go(구획 id)`, `__d01.advance()`, `__d01.descend()` 계단 없이 다음 층)
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__d01 = {
    state: () => X,
    canPlace: (c: number, r: number) => canPlace(st(), curShape(), c, r),
    cellsAt: (c: number, r: number) => curShape().map(([dc, dr]) => K(c + dc, r + dr)),
    place: (c: number, r: number, rot: 0 | 1 | 2 | 3 = 0) => { X.rot = rot; place(c, r); requestRedraw(); },
    go: (to: string) => { goThrough(to); requestRedraw(); },
    advance: () => { advanceDiscovery(); requestRedraw(); },
    descend: () => { descend(); requestRedraw(); },
  };
}

/** 시점 이동 키. 한글 입력 상태의 자모도 같이 받는다. R 회전·F 반전과는 겹치지 않는다. */
const PAN_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
  "ㅈ": [0, -1], "ㄴ": [0, 1], "ㅁ": [-1, 0], "ㅇ": [1, 0],
};

const panning = () => UI.panKeys.size > 0 || UI.panArrow !== null;

export function createD01Scene(): Scene {
  return {
    id: "d01",
    label: "D01 탐색",
    draw,
    onEnter,
    tick: (dt) => {
      if (UI.bannerT > 0) UI.bannerT = Math.max(0, UI.bannerT - dt);
      if (UI.engageT > 0 && (UI.engageT -= dt) <= 0) { UI.engageT = 0; engage(); }
      if (UI.lootT > 0 && (UI.lootT -= dt) <= 0) { UI.lootT = 0; toLoot(); }
      discoveryFx.tick(dt);
      if (panning()) {
        let dx = UI.panArrow?.[0] ?? 0, dy = UI.panArrow?.[1] ?? 0;
        UI.panKeys.forEach((k) => { dx += PAN_KEYS[k][0]; dy += PAN_KEYS[k][1]; });
        const step = (PAN_SPEED * dt) / 1000 / ZOOMS[UI.zoom];
        UI.cam.x += Math.sign(dx) * step;
        UI.cam.y += Math.sign(dy) * step;
        clampCam();
      }
    },
    // 발견 연출·화면 전환 직전·시점 이동 중엔 매 프레임, 안내 띠만 떠 있으면 느리게, 그 밖엔 멈춤
    isAnimating: () => (discoveryFx.animating() || UI.engageT > 0 || UI.lootT > 0 || panning() ? true : UI.bannerT > 0 ? 100 : false),
    onPointerMove: (p) => {
      UI.mouse = p;
      if (bigMap.active) bigMap.onPointerMove(p);
    },
    onPointerDown,
    onPointerUp: () => {
      UI.panArrow = null;
      bigMap.onPointerUp();
    },
    onWheel: (dy) => {
      if (bigMap.active) return bigMap.onWheel(dy);
      if (discoveryFx.active) return;
      if (UI.skillsOpen && UI.mouse && hitAt(UI.mouse) && UI.mouse.x >= FLY.x && UI.mouse.x < FLY.x + FLY.w) {
        const max = Math.max(0, flyRows().length - FLY.maxRows);
        UI.skillScroll = Math.max(0, Math.min(max, UI.skillScroll + (dy > 0 ? 1 : -1)));
        return;
      }
      // 배치 모드는 B03 같은 다른 배치 화면처럼 회전, 맵 확인 상태는 확대/축소
      if (UI.placing) return rotateTile(dy > 0 ? 1 : 3);
      zoomBy(dy > 0 ? -1 : 1);
    },
    onKeyUp: (key) => { UI.panKeys.delete(key); },
    onKeyDown: (key) => {
      if (discoveryFx.active) { if (key === "Enter" || key === " " || key === "Escape") advanceDiscovery(); return; }
      if (bigMap.active) return bigMap.onKeyDown(key);
      if (key === "Escape") {
        if (UI.skillsOpen) UI.skillsOpen = false;
        else if (UI.placing) cancelPlacing();
        return;
      }
      if (PAN_KEYS[key]) { UI.panKeys.add(key); return; }
      if (!UI.placing) return; // 회전·반전 키는 배치 모드에서만
      if (key === "r" || key === "R" || key === "ㄱ") rotateTile(1);
      if (key === "f" || key === "F" || key === "ㄹ") {
        if (X.uses.mirror > 0) X.flip = !X.flip;
        else banner("반전하려면 거울 걸음(사제)이 필요하다");
      }
    },
  };
}
