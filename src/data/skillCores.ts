// 스킬 코어 (2026-11-07): 스킬북(skillbook.ts)의 스킬 하나마다 코어 아이템 하나 + 제작 도안 하나를 만든다.
// - 코어 모양은 칸 수(slots)로 정한다. 2칸 막대, 3칸 막대/ㄱ, 4칸 T/네모/ㄴ/S 중 하나 (스킬 id로 고정).
// - 도안 = 사각형 판에서 "도트를 놓을 수 없는 장애물" 칸을 뺀 모양. 좌우 대칭 또는 180° 회전 대칭.
//   복잡한(칸이 큰) 코어일수록 판이 크다. 일부 큰 코어는 제작 화면보다 커서 화면 이동이 필요하다.
// - 보너스(옵션 노드)는 아이템·적 정보가 정해질 때까지 전부 뺐다 (TODO(spec)).
// - 시작 상태: 코어마다 1개 보유 (창고). 직업마다 기본 코어 몇 개를 판에 꽂아 둔다.
import { APT_COLOR, SKILL_BOOK, type SkillDef } from "./skillbook";
import "./commonCores";
import { PLAY } from "../engine/mode"; // 공용 코어를 스킬북에 먼저 더한다 (아래 registerCores가 코어로 만든다)
import { PIECES, type Cell, type PieceDef } from "./pieces";
import { RECIPES, type OptionalNode, type Recipe, type RequiredSlot } from "./recipes";
import { coreLevel, modesOf } from "./coreOrder";
import { START_CORES, modeLockText } from "./coreUnlock";
import { addItem, ownedOfKind } from "./inventory";
import { CORE_BOARDS, coreUserOf } from "./coreBoards";
import { CLASS_KEYS, type ClassKey } from "./skills";
import { getCharacter, parseKey, cellKey } from "./characters";
import { applyRotFlip } from "../engine/transform";
import type { PIECE } from "../render/primitives";
import type { ElementId } from "./itemTaxonomy";

export const coreIdOf = (skillId: string) => `core_${skillId}`;
export const skillOfCore = (itemId: string): SkillDef | undefined => SKILL_BOOK.find((s) => coreIdOf(s.id) === itemId);

/** 문자열 → 32비트 씨앗 */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHAPES: Record<number, Cell[][]> = {
  1: [[[0, 0]]],
  2: [[[0, 0], [1, 0]]],
  3: [[[0, 0], [1, 0], [2, 0]], [[0, 0], [1, 0], [0, 1]]],
  4: [[[0, 0], [1, 0], [2, 0], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [0, 1], [0, 2], [1, 2]], [[0, 0], [1, 0], [1, 1], [2, 1]]],
};
function coreShape(s: SkillDef): Cell[] {
  const list = SHAPES[Math.min(4, Math.max(1, s.slots))];
  return list[hash(s.id) % list.length];
}

const APT_ELEMENT: Record<string, ElementId> = {
  "기사": "yellow", 수호: "yellow", 지휘: "yellow", 강습: "red", "전사": "red", 야만: "red", 투지: "red",
  한손검: "yellow", 방패: "yellow", "한손검/방패": "yellow", 창: "yellow", 대검: "yellow", 망치: "yellow", 지팡이: "blue", 오브: "blue",
  공용: "white", "사제": "white", 치유: "green", 축복: "white", 빛: "white", "마법사": "blue", 마법: "blue", 원소: "red", 비전: "black", 학자: "green",
};

/** 크게 그려 화면 이동이 필요한 도안 (제작 화면 도면 칸 10×10을 넘는다). */
const BIG_BOARDS = new Set(["wr_all", "as_ruin", "mg_burn"]);

/** 도안: w×h 판에서 장애물을 뺀 칸. 대칭(좌우 / 180° 회전)은 스킬 id로 고정. */
function blueprint(s: SkillDef): Cell[] {
  const big = BIG_BOARDS.has(s.id);
  // 2026-11-08: 적정 레벨이 낮을수록 작게 — 직업 코어는 해금 레벨, 적성 코어는 Lv1. Lv5 이하 칸 수+2, Lv19 이하 +3, 그 위 +4.
  const lv = coreLevel(s.id);
  const n = big ? 12 : (lv <= 5 ? 2 : lv <= 19 ? 3 : 4) + Math.min(4, s.slots); // 2칸 Lv1 → 4×4
  const w = n, h = big ? 9 : n;
  const r = rng(hash(s.id + ":bp"));
  const mirror = hash(s.id) % 2 === 0; // true 좌우 대칭, false 180° 회전 대칭
  const blocked = new Set<string>();
  const target = Math.round(w * h * (0.14 + r() * 0.08));
  let guard = 0;
  while (blocked.size < target && guard++ < 500) {
    const c = Math.floor(r() * w), rr = Math.floor(r() * h);
    const [mc, mr] = mirror ? [w - 1 - c, rr] : [w - 1 - c, h - 1 - rr];
    blocked.add(`${c},${rr}`);
    blocked.add(`${mc},${mr}`);
  }
  const cells: Cell[] = [];
  for (let rr = 0; rr < h; rr++) for (let c = 0; c < w; c++) if (!blocked.has(`${c},${rr}`)) cells.push([c, rr]);
  return cells;
}

/** 같은 코어를 판에 여러 개 꽂을 수 있는가 (2026-11-08): 공용 능력치 코어(능력치·TP·속성 내성만)만 된다.
 *  스킬이 생기거나 패시브 효과가 붙는 코어(직업·적성·공용 기술·탐색·기본 행동·위협)는 한 캐릭터 판에 하나만. */
export function coreStackable(itemId: string): boolean {
  const s = skillOfCore(itemId);
  return !!s && s.req.type === "common" && !!s.passive && !!s.party && !s.hooks && !s.explore && !s.dangerStart && !s.dangerDecay;
}

/** 코어 조각 (2026-11-08 2차, docs/skill-cores.md 5장): 속성 6종. 적이 속성마다 다른 조각을 떨어뜨리고, 스킬 코어를 분해해도 나온다.
 *  스킬 코어 제작에 칸 수만큼 든다 — 속성은 아무거나. 코어 속성과 같은 조각을 쓰면 도면의 속성 칸 보너스를 받기 쉽다. */
const FRAG_NAME: Record<ElementId, string> = { red: "불꽃", yellow: "번개", green: "바람", blue: "얼음", white: "빛", black: "어둠" };
export const CORE_FRAGS = (Object.keys(FRAG_NAME) as ElementId[]).map((e) => `mat_core_${e}`);
export const isCoreFrag = (id: string) => id.startsWith("mat_core_");
export const coreFragOf = (e: ElementId) => `mat_core_${e}`;
(Object.keys(FRAG_NAME) as ElementId[]).forEach((e, i) => {
  const id = coreFragOf(e);
  PIECES[id] = {
    id, name: `${FRAG_NAME[e]} 코어 조각`, kind: "material", cells: [[0, 0]], color: e, cellEls: [e], grade: "common", categories: ["원석"], elements: [e],
    desc: `${FRAG_NAME[e]}의 힘이 깃든 결정 조각. 스킬 코어를 만드는 재료다.`, dex: 90 + i,
  };
});
/** 코어 조각 제작 (2026-11-09, docs/skill-cores.md 3장): 중간재. 습득 완화용 — 그 속성 소재 1개(코어 조각 제외) + 남는 재료로 도면을 채운다.
 *  도면은 속성마다 다른 6~7칸 모양, 보너스 없음. 결과 1개. */
const FRAG_BOARD: Record<ElementId, Cell[]> = {
  red: [[1, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]], // 불꽃: 불길 (7)
  yellow: [[2, 0], [1, 1], [2, 1], [0, 2], [1, 2], [0, 3]], // 번개: 번갯불 (6)
  green: [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1], [3, 2]], // 바람: 물결 (6)
  blue: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [1, 3]], // 얼음: 고드름 결정 (6)
  white: [[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]], // 빛: 기둥 (7)
  black: [[0, 0], [1, 0], [0, 1], [0, 2], [0, 3], [1, 3]], // 어둠: 초승달 (6)
};
function registerFragRecipes() {
  (Object.keys(FRAG_NAME) as ElementId[]).forEach((e) => {
    const id = coreFragOf(e);
    RECIPES.push({
      id: `recipe_${id}`, name: PIECES[id].name, kind: "compound", resultItemId: id, group: "중간재", bench: 1,
      boardCells: FRAG_BOARD[e],
      required: [{ desc: `${FRAG_NAME[e]} 속성 소재 1개`, count: 1, cat: FRAG_NAME[e], match: (x) => !isCoreFrag(x) && !!PIECES[x]?.elements.includes(e) }],
      optional: [],
      previewStat: `${FRAG_NAME[e]} 속성 소재 + 아무 재료`,
    });
  });
}

/** 코어 속성 (도면 보너스·분해 조각) */
export const coreElementOf = (itemId: string): ElementId => PIECES[itemId]?.elements[0] ?? "white";

/** 필수 재료 — 코어 (칸 수만큼) + 적성 종류마다 다른 소재. 보너스 없음. */
function requiredOf(s: SkillDef): RequiredSlot[] {
  const n = Math.max(1, Math.min(4, s.slots));
  const core: RequiredSlot = { desc: `코어 조각 ${n}개`, count: n, cat: "코어 조각", match: isCoreFrag };
  return [core, ...materialOf(s)];
}
function materialOf(s: SkillDef): RequiredSlot[] {
  const cat = (c: string, desc: string, count = 1): RequiredSlot => ({ desc, count, cat: c, match: (id) => !!PIECES[id]?.categories.includes(c as never) });
  const el = (e: ElementId, label: string): RequiredSlot => ({ desc: `${label} 속성 소재 1개`, count: 1, cat: label, match: (id) => !!PIECES[id]?.elements.includes(e) });
  const big = s.slots >= 4 ? 2 : 1;
  switch (s.req.type) {
    case "job": return [cat("원석", `원석 소재 ${big}개`, big)];
    case "weapon": return [cat("금속", `금속 소재 ${big}개`, big)];
    case "element": return [el(s.req.tags[0], { red: "불꽃", yellow: "번개", green: "바람", blue: "얼음", white: "빛", black: "어둠" }[s.req.tags[0]])];
    default: return [cat("원소", `원소 소재 ${big}개`, big)];
  }
}

// ---- 도면 보너스 (2026-11-08, docs/skill-cores.md 4장) ----
// 최대 4개: 능력치(속성 칸 수 단계) · 재료 등급 단계 · 조각 수 단계 + 변형(있으면, 레벨 해금 전에는 잠김).
// 조건은 필수 재료와 이어진다 — 코어 속성 칸, 필수 소재(원석·금속·속성 소재·원소)의 등급.
const EL_NAME: Record<string, string> = { red: "불꽃", yellow: "번개", green: "바람", blue: "얼음", white: "빛", black: "어둠" };
const MAGIC_APT = new Set(["마법사", "마법", "원소", "비전", "학자", "지팡이", "오브", "사제", "치유", "축복", "빛"]);
const GUARD_APT = new Set(["수호", "방패", "기사"]); // 한손검/방패는 공격력 (검이 주)
function bonusesOf(s: SkillDef, cells: Cell[]): OptionalNode[] {
  const el = APT_ELEMENT[s.apt] ?? "yellow";
  const n = cells.length, k = Math.max(1, Math.min(4, s.slots));
  const stat = GUARD_APT.has(s.apt) ? "방어력" : MAGIC_APT.has(s.apt) ? "주문력" : "공격력";
  const out: OptionalNode[] = [];
  // 1) 능력치: 코어 속성 칸이 많을수록 (판의 1/4 · 1/2 · 3/4)
  const a = [Math.ceil(n / 4), Math.ceil(n / 2), Math.ceil((n * 3) / 4)];
  out.push({
    kind: "spec", spec: { type: "elCount", el }, desc: `${EL_NAME[el]} 칸 ${a[0]}/${a[1]}/${a[2]}개 이상`, bonus: `${stat} +${k}`,
    tiers: [{ at: a[0], bonus: `${stat} +${k}` }, { at: a[1], bonus: `${stat} +${2 * k}` }, { at: a[2], bonus: `${stat} +${5 * k}` }],
  });
  // 2) 필수 소재 등급: 하급 · 중급 · 상급 (가장 높은 것)
  const mat = s.req.type === "job" ? { cat: "원석" } : s.req.type === "weapon" ? { cat: "금속" } : s.req.type === "element" ? { el: s.req.tags[0] as string } : { cat: "원소" };
  const matName = "cat" in mat ? `${mat.cat} 소재` : `${EL_NAME[mat.el!]} 속성 소재`;
  const vit = MAGIC_APT.has(s.apt) ? "MP" : "HP", vk = vit === "MP" ? 3 * k : 10 * k;
  out.push({
    kind: "spec", spec: { type: "matGrade", ...mat }, desc: `${matName} 등급 (하급·중급·상급)`, bonus: `${vit} +${vk}`,
    tiers: [{ at: 1, bonus: `${vit} +${vk}` }, { at: 2, bonus: `${vit} +${Math.round(vk * 2.5)}` }, { at: 3, bonus: `${vit} +${vk * 5}` }],
  });
  // 3) 조각 수: 적게 쓸수록 (판을 다 채우고)
  const p = Math.max(k + 2, Math.ceil(n / 3));
  out.push({
    kind: "spec", spec: { type: "fewPieces" }, desc: `조각 ${p + 1}/${p}/${p - 1}개 이하`, bonus: "민첩성 +1",
    tiers: [{ at: p + 1, bonus: "민첩성 +1" }, { at: p, bonus: "민첩성 +2" }, { at: Math.max(1, p - 1), bonus: "민첩성 +4" }],
  });
  // 4) 변형: 판 가운데 줄 세 칸을 코어 속성으로. 여러 변형이 있으면 첫 번째만 (보너스 최대 4개)
  const m = modesOf(s.id)[0];
  if (m) {
    const w = Math.max(...cells.map(([c]) => c)) + 1, h = Math.max(...cells.map(([, r]) => r)) + 1;
    const mid = Math.floor(h / 2), set = new Set(cells.map(([c, r]) => `${c},${r}`));
    const row = cells.filter(([, r]) => r === mid).map(([c]) => c).sort((x, y) => Math.abs(x - (w - 1) / 2) - Math.abs(y - (w - 1) / 2)).slice(0, 3);
    const region = row.filter((c) => set.has(`${c},${mid}`)).map((c): [number, number, string] => [c, mid, el]);
    out.push({
      kind: "spec", spec: { type: "cells", cells: region }, desc: `표시 칸 ${region.length}개를 ${EL_NAME[el]}${el === "yellow" ? "로" : "으로"}`, bonus: `변형: ${m.base}: ${m.mode}`,
      level: "변형", lockedFn: () => modeLockText(s.id, m.mode),
    });
  }
  return out;
}

function registerCores() {
  SKILL_BOOK.forEach((s, i) => {
    const id = coreIdOf(s.id);
    const def: PieceDef = {
      id, name: `${s.name} 코어`, kind: "core", cells: coreShape(s),
      color: (APT_COLOR[s.apt] ?? "steel") as keyof typeof PIECE,
      grade: s.slots >= 4 ? "rare" : "common", categories: ["원석"], elements: [APT_ELEMENT[s.apt] ?? "yellow"],
      coreReq: s.req, desc: `${s.apt} · ${s.passive ? "패시브" : s.cat}. ${s.lines.join(" ")}`,
      coreEffect: { stats: [], skills: [{ label: `${s.passive ? "패시브" : "스킬"}: ${s.name}`, passive: !!s.passive }] },
      dex: 100 + i,
    };
    PIECES[id] = def;
    const bp = blueprint(s);
    const rec: Recipe = {
      id: `recipe_${id}`, name: def.name, kind: "core", resultItemId: id,
      boardCells: bp, required: requiredOf(s), optional: bonusesOf(s, bp),
      previewStat: `${s.passive ? "패시브" : "스킬"}: ${s.name}`,
    };
    RECIPES.push(rec);
  });
}

/** 직업마다 처음 꽂혀 있는 코어 (검증용). 판에 자리가 없으면 그 코어는 건너뛴다. */
const STARTER: Record<ClassKey, string[]> = {
  knight: ["gd_taunt", "kn_charge", "as_finisher", "kn_chivalry", "kn_oath", "gd_mastery", "gd_intercept", "sh_mastery", "sw_mastery", "sh_parry", "sw_challenge", "cm_lead"],
  warrior: ["bb_cry", "wr_all", "gs_slash", "gs_sweep", "gs_spirit", "gs_mastery", "wr_instinct", "wr_heavy", "wr_twohand", "as_momentum", "gr_frenzy", "bb_adrenaline"],
  mage: ["mg_shot_red", "mg_release", "mg_arrow", "mg_meditate", "el_fire", "el_bolt", "el_wind", "el_ice", "mg_elemental", "mg_affinity", "st_mastery", "ar_rift", "mg_overload", "sc_study"],
  priest: ["hl_heal", "hl_cleanse", "bl_shield", "pr_prayer", "pr_devotion", "pr_grace", "pr_revive", "lt_judge", "bl_ward", "hl_mastery", "lt_light", "pr_miracle"],
};

let placeUid = 5000;
function autoPlace(cls: ClassKey, itemId: string, ownedUid: string): boolean {
  const ch = getCharacter(cls);
  const occ = new Set<string>();
  for (const p of CORE_BOARDS[cls]) applyRotFlip(PIECES[p.itemId].cells, p.rot, p.flip).forEach(([c, r]) => occ.add(cellKey(p.origin[0] + c, p.origin[1] + r)));
  const open = [...ch.coreUnlocked].map(parseKey).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const rot of [0, 1, 2, 3] as const) {
    const shape = applyRotFlip(PIECES[itemId].cells, rot, false);
    for (const [oc, or] of open) {
      if (shape.every(([c, r]) => ch.coreUnlocked.has(cellKey(oc + c, or + r)) && !occ.has(cellKey(oc + c, or + r)))) {
        CORE_BOARDS[cls].push({ uid: placeUid++, ownedUid, itemId, origin: [oc, or], rot, flip: false });
        return true;
      }
    }
  }
  return false;
}

function seedCores() {
  // 2026-11-09: 처음부터 갖는 코어 = START_CORES (직업마다 2개, 장착 상태). data/coreUnlock.ts
  // 같은 코어로 시작하는 직업이 여럿이면 (필살의 일격: 기사·전사) 그 수만큼 준다.
  const lv1 = startCount();
  // 테스트 플레이(play)는 Lv1 직업 코어만 (장착 상태). 개발 모드는 적성 코어 1개씩·코어 재료 8개를 더 준다. 공용 코어는 드롭으로만.
  SKILL_BOOK.forEach((s) => s.req.type !== "common" && (lv1.has(s.id) || (!PLAY && s.req.type !== "job")) && addItem(coreIdOf(s.id), Math.max(1, lv1.get(s.id) ?? 0)));
  if (!PLAY) CORE_FRAGS.forEach((id) => addItem(id, 3));
  for (const cls of CLASS_KEYS) {
    for (const sid of [...START_CORES[cls], ...(PLAY ? [] : STARTER[cls])]) {
      const itemId = coreIdOf(sid);
      const o = ownedOfKind("core").find((x) => x.itemId === itemId && !coreUserOf(x.uid));
      if (o) autoPlace(cls, itemId, o.uid);
    }
  }
}

/** 스킬 id → 그 코어로 시작하는 직업 수 */
function startCount(): Map<string, number> {
  const m = new Map<string, number>();
  CLASS_KEYS.forEach((k) => START_CORES[k].forEach((sid) => m.set(sid, (m.get(sid) ?? 0) + 1)));
  return m;
}

/** 옛 세이브 보정 (2026-11-09, H01 들어올 때): 시작 코어가 직업 수보다 적게 있으면 모자란 만큼 채워 그 코어가 없는 직업 판에 꽂는다.
 *  (전에는 필살의 일격을 1개만 줘서 기사만 받고 전사는 못 받았다.) 일부러 뺀 코어는 개수가 맞으므로 다시 꽂지 않는다. */
export function ensureStartCores() {
  for (const [sid, need] of startCount()) {
    const itemId = coreIdOf(sid);
    const have = ownedOfKind("core").filter((x) => x.itemId === itemId).length;
    if (have >= need) continue;
    addItem(itemId, need - have);
    for (const cls of CLASS_KEYS) {
      if (!START_CORES[cls].includes(sid) || CORE_BOARDS[cls].some((p) => p.itemId === itemId)) continue;
      const o = ownedOfKind("core").find((x) => x.itemId === itemId && !coreUserOf(x.uid));
      if (o) autoPlace(cls, itemId, o.uid);
    }
  }
}

registerCores();
registerFragRecipes();
seedCores();
