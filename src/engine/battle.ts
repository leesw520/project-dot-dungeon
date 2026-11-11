// 전투 규칙 v3 (2026-11-07) — docs/battle-rules.md (3장 CTB 루프, 5장 피해·회복, 6장 상태, 7장 어그로, 8장 적 행동)
// + docs/classes.md 2장(상태)·4.5(공용 규칙)·6장(기본 4직업 스킬). 화면과 분리된 순수 상태 + 함수.
// 스킬은 data/skillbook.ts. 패시브는 hooks로, 고유 처리는 run/special로 여기서 부른다.
import {
  BAG_START, FORMS, STACK_GAUGE_DEFAULT, STACK_GAUGE_LEN, STAT_MOD_PCT, STAT_PAIRS, STAT_SET, STATUS, TRIGGER_LINES,
  isTriggerKey, statusViewOf,
  type ActDef, type EffectDef, type FoeAct, type FormSlot, type StatusKey, type TriggerKey,
} from "../data/battle";
import { foeType, type FoeType } from "../data/monsters";
import { slotOf } from "../data/formation";
import { aptitudeOf } from "../data/aptitude";
import { ELEMENT_DEFS, type ElementId } from "../data/itemTaxonomy";
import { affinityRate, baseWaitOf, turnSpeedOf, DEFAULT_PARAMS, type Affinity, type CombatParams, type MainStats, type StatKey } from "../data/stats";
import type { ActionResult, HookCtx, Hooks, SkillDef } from "../data/skillbook";
import { PARRY_DELAY } from "../data/skillbook";
import { activeSkills, allyAffinity, basicAttackOf, finalStats, partyDef, partyNames, passiveSkills, weaponsOf } from "./party";

export interface Status {
  key: StatusKey;
  v: number;
  /** 남은 턴. 방어도는 0 (다음 자기 턴 시작 시 소멸). 1회형·유지형·영구형은 99. */
  n: number;
}

export interface Intent extends FoeAct {
  /** 조준 대상 (예고 시 고정, 7.4) 또는 self */
  tgt?: string;
}

/** 전투 유닛. 주 스탯(atk/spl/def/agi)은 강화·약화 전 값. 실제 값은 stat(u, k). */
export interface Unit extends MainStats, CombatParams {
  id: string;
  name: string;
  tag: string;
  side: "ally" | "foe";
  /** 아군 0~5 (0~2 전열), 적 10~ */
  slot: number;
  color: string;
  lv: number;
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  tp: number;
  tpMax: number;
  wait: number;
  st: Status[];
  alive: boolean;
  affinity?: Affinity;
  /** 위험도 스택 (아군, 7장) · 이번 턴에 쌓았는가 */
  danger?: number;
  dangerGained?: boolean;
  /** 위험도 최대치로 [표적]이 됨 (그 공격을 받으면 위험도 DANGER.reset으로) */
  dangerMarked?: boolean;
  /** 도발로 고정된 공격 대상 (적, 다음 대상 지정 공격에 쓰고 지운다) */
  forcedTgt?: string;
  /** 코어 패시브 능력치 % (finalStats.pct) — 전투 중 강화·약화 %와 같은 층에서 합산 */
  basePct?: Partial<Record<StatKey, number>>;
  /** 능력치 전환 패시브로 더해지는 값 (finalStats.conv) — % 뒤에 더한다, 다시 %·전환되지 않는다 */
  convAdd?: Partial<Record<StatKey, number>>;
  triggerMods?: TriggerMods;
  /** 고를 수 있는 액티브 스킬 (코어) */
  skills: ActDef[];
  /** 패시브 스킬 (코어) */
  passives: SkillDef[];
  /** 기본 공격 (마력 화살이면 대체) */
  basic: ActDef;
  /** 남은 재사용 (스킬 id → 자기 턴 수) */
  cds: Record<string, number>;
  /** 전투 중 1번만 같은 표시 (투혼 등) */
  flags: Record<string, number>;
  /** 마법사 원소 스택 (최대 4, 오래된 것부터 밀려남). 원소 마법을 쓰면 그 원소가 쌓이고, 같은 원소 마법 위력 +10%/개 */
  elem?: ElementId[];
  /** 마지막으로 수행한 공격 행동 id (강습 [난전]: 다른 공격이면 발동하고 갱신) */
  lastAtk?: string;
  weapons: string[];
  twoHanded: boolean;
  // 적 전용
  type?: FoeType;
  col?: "f" | "b";
  intent?: Intent;
}

export interface BattleEvent {
  kind: "dmg" | "heal" | "miss" | "status";
  id: string;
  amount: number;
  hpBefore?: number;
  text?: string;
}

export interface Battle {
  form: string;
  units: Unit[];
  allies: Unit[];
  foes: Unit[];
  /** 처치 관여: dealt[아군 id][적 id] = 이번 전투에서 준 피해 */
  dealt: Record<string, Record<string, number>>;
  bag: Record<string, number>;
  cur: Unit | null;
  triggerMods: Record<Unit["side"], TriggerMods>;
}

export type TriggerMods = Partial<Record<TriggerKey, number>>;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const T99 = 99;

export const statusOf = (u: Unit, k: StatusKey) => u.st.find((s) => s.key === k);
export const statusV = (u: Unit, k: StatusKey) => statusOf(u, k)?.v ?? 0;
export const isFront = (u: Unit) => (u.side === "ally" ? u.slot < 3 : u.col === "f" || u.type?.size === 6);
export const isBack = (u: Unit) => (u.side === "ally" ? u.slot >= 3 : u.col === "b" || u.type?.size === 6);
export const label = (u: Unit) => u.name + u.tag;

// 화면은 Battle을 하나만 들고 있으므로, 능력치 계산 훅이 전투를 찾을 수 있게 마지막 전투를 기억한다.
let current: Battle | null = null;
let evSink: BattleEvent[] = [];

// ===== 능력치 =====
function hooksOf(u: Unit): Hooks[] {
  return u.passives.map((p) => p.hooks).filter((h): h is Hooks => !!h);
}
const hasPassive = (u: Unit, special: string) => u.passives.some((p) => p.special === special);
/** 지팡이 [마력 절약]: 마법 스킬·마력 화살의 MP 비용 −1 (단계 1/2/3, 2026-11-07). 배율 적용 뒤 빼고 0 아래로는 안 간다 */
export const MP_SAVE = 1;
const mpSave = (u: Unit, a: ActDef) => (u.passives?.some((p) => p.special === "mpSave") && ((a as SkillDef).seal === "magic" || (a.id === "attack" && a.dmgType === "magic")) ? MP_SAVE : 0);
/** 투지 [불요]: [위기] 중 정신 이상 면역, 공격(기본 공격·공격 스킬, 균열 추가 피해 포함) 이외의 피해 0 */
const nonAttackImmune = (u: Unit) => hasPassive(u, "unyielding") && !!statusOf(u, "위기");
const MENTAL: StatusKey[] = ["혼란", "공포"];
/** 투지 [최후의 저항]: 공격 스킬(기본 공격 제외)에 잃은 HP의 10% 추가 피해 (행동 전체 합, 다단이면 나눔). 수치 잠정 */
const lastStandFlat = (u: Unit, a: ActDef) =>
  hasPassive(u, "lastStand") && isAttackAct(a) && a.id !== "attack" ? Math.round((u.hpMax - u.hp) * 0.1) / (a.hits ?? 1) : 0;
/** 기본 공격·피격으로 얻는 TP (야만 아드레날린이면 2) */
const tpGain = (u: Unit) => (hasPassive(u, "adrenaline") ? 2 : 1);

/** 강화·약화 % + 조건부 패시브 % 합계 (상쇄 없음, 합산 — classes.md 2장) + 코어 패시브 % (finalStats, 같은 층에서 합산). */
function statPctOf(u: Unit, k: StatKey): number {
  let pct = u.basePct?.[k] ?? 0;
  for (const s of u.st) {
    const m = STAT_MOD_PCT[s.key];
    if (m) pct += (m[k] ?? 0) + (m.all ?? 0);
  }
  if (k === "atk" && statusOf(u, "맹세: 정복")) pct += 15;
  if (current) for (const h of hooksOf(u)) pct += h.statPct?.(ctx(current, u), k) ?? 0;
  return pct;
}
/** 실제 능력치: 합산 고정값 × (1 + % 합계). */
export function stat(u: Unit, k: StatKey): number {
  return Math.max(0, Math.round(u[k] * (1 + statPctOf(u, k) / 100)) + (u.convAdd?.[k] ?? 0));
}
/** 턴 속도 = (기본 턴 수치 + 민첩성) × (1 + 민첩성 % 합계) — 가속·둔화는 턴 속도 전체에 걸린다 */
export const turnSpeed = (u: Unit) => Math.max(1, Math.round(turnSpeedOf(u.agi) * (1 + statPctOf(u, "agi") / 100)));
export const baseWait = (u: Unit) => baseWaitOf(turnSpeed(u));

// ===== 훅 문맥 =====
let supportFired = false;
function ctx(b: Battle, u: Unit): HookCtx {
  return {
    b, u,
    addSt: (t, e) => addStatus(t, e, u),
    removeSt: (t, k) => (t.st = t.st.filter((s) => s.key !== k)),
    has: (t, k) => !!statusOf(t, k),
    heal: (t, n) => {
      if (!t.alive || n <= 0) return 0;
      const h = Math.min(n, t.hpMax - t.hp);
      t.hp += h;
      if (h > 0) evSink.push({ kind: "heal", id: t.id, amount: h });
      return h;
    },
    shield: (t, n) => gainShield(t, n),
    tp: (t, n) => { if (t.tpMax && !statusOf(t, "출혈")) t.tp = clamp(t.tp + n, 0, t.tpMax); },
    mp: (t, n) => { if (t.mpMax) t.mp = clamp(t.mp + n, 0, t.mpMax); },
    stat: (t, k) => stat(t, k),
    log: (t, text) => evSink.push({ kind: "status", id: t.id, amount: 0, text }),
    support: () => fireSupport(b, u),
    rand: Math.random,
  };
}
function fireSupport(b: Battle, u: Unit) {
  if (supportFired) return;
  supportFired = true;
  for (const h of hooksOf(u)) h.onSupport?.(ctx(b, u));
}

// ===== 생성 (2장) =====
/** lvOf: 아군 레벨 (전투 결과의 경험치 진행에서). form: FORMS 이름 또는 편성 그대로 (탐색 적 심볼). */
export function createBattle(form: string | FormSlot[], lvOf: (name: string) => number = () => 5): Battle {
  const pattern = typeof form === "string" ? FORMS[form] ?? FORMS["소형 1"] : form;
  const allies: Unit[] = partyNames().map((name) => {
    const p = partyDef(name), f = finalStats(name), w = weaponsOf(name);
    return {
      id: name, name, tag: "", side: "ally", slot: slotOf(name), color: p.color, lv: lvOf(name),
      hp: f.hp, hpMax: f.hp, mp: f.mp, mpMax: f.mp, tp: 0, tpMax: f.tpMax,
      atk: f.flat.atk, spl: f.flat.spl, def: f.flat.def, agi: f.flat.agi, basePct: f.pct, convAdd: f.conv,
      ...DEFAULT_PARAMS, affinity: allyAffinity(name),
      wait: 0, st: [], alive: true,
      skills: activeSkills(name), passives: passiveSkills(name), basic: basicAttackOf(name),
      cds: {}, flags: {}, weapons: w.types, twoHanded: w.twoHanded,
    };
  });
  const cnt: Record<string, number> = {};
  const seen: Record<string, number> = {};
  pattern.forEach(({ mon }) => (cnt[mon] = (cnt[mon] || 0) + 1));
  const foes: Unit[] = pattern.map(({ mon, col }, i) => {
    const t = foeType(mon);
    seen[mon] = (seen[mon] || 0) + 1;
    const tag = cnt[mon] > 1 ? "ABCDEF"[seen[mon] - 1] : "";
    return {
      id: t.name + tag, name: t.name, tag, side: "foe", slot: 10 + i, color: t.color, lv: t.lv,
      hp: t.hp, hpMax: t.hp, mp: 0, mpMax: 0, tp: 0, tpMax: 0,
      atk: t.atk, spl: t.spl, def: t.def, agi: t.agi,
      ...DEFAULT_PARAMS, affinity: t.affinity,
      wait: 0, st: [], alive: true,
      skills: [], passives: [], basic: { id: "attack", name: "공격", tgt: "one", dmgType: "physical", power: { pct: 100, flat: 0 }, wait: 0, cat: "", desc: [] },
      cds: {}, flags: {}, weapons: [], twoHanded: false, type: t, col,
    };
  });
  if (foes.reduce((a, f) => a + Math.min(3, f.type!.size), 0) <= 3) foes.forEach((f) => (f.col = "f"));
  const units = [...allies, ...foes];
  const dealt: Battle["dealt"] = {};
  allies.forEach((a) => (dealt[a.id] = {}));
  const b: Battle = {
    form: typeof form === "string" ? form : "탐색 조우", units, allies, foes, dealt,
    bag: { ...BAG_START }, cur: null,
    triggerMods: { ally: {}, foe: {} },
  };
  current = b;
  // 시작 대기 (2026-11-08): 아군 40% · 적 60% — 마주친 쪽(파티)이 먼저 움직일 여유. 같은 속도면 아군이 먼저.
  units.forEach((u) => (u.wait = Math.round(baseWait(u) * (u.side === "ally" ? START_WAIT.ally : START_WAIT.foe))));
  initDanger(b);
  foes.forEach((f) => decideIntent(b, f));
  return b;
}

/** 전투 시작 처리 (패시브 battleStart, 통찰). 화면이 시작 연출 뒤에 한 번 부른다. 이벤트를 돌려준다. */
export function battleStart(b: Battle): BattleEvent[] {
  current = b;
  evSink = [];
  for (const u of b.allies) {
    for (const h of hooksOf(u)) h.battleStart?.(ctx(b, u));
    if (hasPassive(u, "insight"))
      for (const f of b.foes) {
        const weak = Object.entries(f.affinity ?? {}).filter(([, s]) => typeof s === "number" && s < 0).map(([e]) => ELEMENT_DEFS[e as ElementId].label);
        evSink.push({ kind: "status", id: f.id, amount: 0, text: weak.length ? `약점 ${weak.join("·")}` : "약점 없음" });
      }
  }
  return evSink;
}

// ===== 상태 창 표시값 (battle-ui.md 4.6) =====
export function triggerLine(b: Battle, u: Unit, k: TriggerKey): number {
  return Math.max(1, TRIGGER_LINES[u.side][k] + (b.triggerMods[u.side][k] ?? 0) + (u.triggerMods?.[k] ?? 0));
}

export interface StatusPanel {
  stats: { label: string; net: number }[];
  mods: { key: StatusKey; v: number }[];
  stacks: { key: StatusKey; v: number; len: number; trigger: boolean }[];
  flags: StatusKey[];
}

const pctOf = (u: Unit, k: StatusKey) => (statusOf(u, k) ? Math.abs(Object.values(STAT_MOD_PCT[k] ?? {})[0] ?? 0) : 0);
export function statusPanel(b: Battle, u: Unit): StatusPanel {
  const setNet = pctOf(u, STAT_SET.up) - STAT_SET.down.reduce((t, d) => t + pctOf(u, d), 0);
  const stats = STAT_PAIRS.map((p) => ({ label: p.label, net: pctOf(u, p.up) - pctOf(u, p.down) + setNet }));
  const mods = u.st.filter((s) => statusViewOf(s.key) === "stat").map((s) => ({ key: s.key, v: s.n }));
  const stacks = u.st.filter((s) => statusViewOf(s.key) === "stack").map((s) => {
    const trigger = isTriggerKey(s.key);
    return { key: s.key, v: s.v, trigger, len: isTriggerKey(s.key) ? triggerLine(b, u, s.key) : STACK_GAUGE_LEN[s.key] ?? STACK_GAUGE_DEFAULT };
  });
  return { stats, mods, stacks, flags: u.st.filter((s) => statusViewOf(s.key) === "flag").map((s) => s.key) };
}

// ===== 비용·대기 =====
/** MP·재사용 배율 (구원 등). [기적]이 있으면 [지원] 스킬은 무료. */
function costMul(b: Battle, u: Unit, a: ActDef): number {
  let m = 1;
  for (const h of hooksOf(u)) m *= h.costMul?.(ctx(b, u), a) ?? 1;
  return m;
}
const isSupportSkill = (a: ActDef) => !!(a as SkillDef).supportSkill;
const isAttackAct = (a: ActDef) => a.dmgType === "physical" || a.dmgType === "magic" || a.dmgType === "fixed";
/** 과충전 대상: 기본 공격이 아닌 공격 스킬 */
const overloaded = (u: Unit, a: ActDef) => !!statusOf(u, "과충전") && isAttackAct(a) && a.id !== "attack";

/** 이번에 낼 MP (미리보기·사용 공용). */
export function mpCost(u: Unit, a: ActDef): number {
  const c = a.cost;
  if (!c) return 0;
  if (c.mp === "all") return u.mp;
  let mp = c.mp ?? 0;
  if (c.mpPct) mp += Math.round((u.mpMax * c.mpPct) / 100);
  if (!mp) return 0;
  const b = current;
  if (b && isSupportSkill(a) && statusOf(u, "기적")) return 0;
  if (b) mp = Math.ceil(mp * costMul(b, u, a)); // TODO(spec): 구원 50% 반올림 — 지금은 올림
  if (overloaded(u, a)) mp *= 2;
  return Math.max(0, mp - mpSave(u, a));
}

/** 실제 대기. consume=false면 미리보기. */
export function actualWait(u: Unit, act: ActDef | null, consume: boolean): number {
  const freeze = statusV(u, "빙결") * 5;
  if (act?.cmd === "wait") return Math.round(baseWait(u) * 0.5) + freeze; // 하한·감소율 미적용
  let adj = 0;
  const b = current;
  if (b && act) for (const h of hooksOf(u)) adj += h.waitAdj?.(ctx(b, u), act) ?? 0;
  if (act && u.flags.woundHit && hasPassive(u, "wound")) adj -= 5;
  if (consume) delete u.flags.woundHit;
  const v = Math.round(baseWait(u) + (act?.wait ?? 0) + adj + freeze);
  return clamp(v, 36, 360);
}

/** 타임라인 순서: 남은 대기 → 민첩성 높은 쪽 → 아군 → 슬롯 */
export function order(b: Battle): Unit[] {
  return b.units.filter((u) => u.alive).sort((a, c) => a.wait - c.wait || turnSpeed(c) - turnSpeed(a) || +(c.side === "ally") - +(a.side === "ally") || a.slot - c.slot);
}

export function advance(b: Battle): Unit {
  current = b;
  const u = order(b)[0];
  const dt = u.wait;
  b.units.forEach((x) => x.alive && (x.wait -= dt));
  b.cur = u;
  return u;
}

// ===== 턴 시작 (3.1) =====
export function turnStart(b: Battle, u: Unit, events: BattleEvent[]): boolean {
  current = b;
  evSink = events;
  u.st = u.st.filter((s) => s.key !== "방어도");
  for (const k of Object.keys(u.cds)) if (u.cds[k] > 0) u.cds[k] -= 1;
  for (const k of ["재생", "독", "화상", "출혈", "유예"] as StatusKey[]) {
    const s = statusOf(u, k);
    if (!s || !u.alive) continue;
    if (k === "재생") {
      const h = Math.min(s.v, u.hpMax - u.hp);
      u.hp += h;
      events.push({ kind: "heal", id: u.id, amount: h });
      continue;
    }
    const before = u.hp;
    let amount = s.v;
    if (k === "유예") {
      amount = Math.ceil(s.v / 3);
      s.v -= amount;
      if (s.v <= 0) u.st = u.st.filter((x) => x !== s);
    }
    // 불요: [위기] 중 공격 이외의 피해는 처리하되 받는 값 0
    const dealt = nonAttackImmune(u) ? 0 : Math.min(u.hp, amount);
    u.hp -= dealt;
    events.push({ kind: "dmg", id: u.id, amount: dealt, hpBefore: before });
    if (u.hp <= 0) kill(b, u, null);
  }
  if (!u.alive) return false;
  const guardChant = statusOf(u, "수호의 축문");
  if (guardChant) gainShield(u, guardChant.v);
  for (const h of hooksOf(u)) h.turnStart?.(ctx(b, u));
  // 지속형만 턴이 준다. 1회형·유지형·영구형·토글은 조건으로 끝난다.
  u.st.forEach((s) => { if (STATUS[s.key].decay === "turn" && s.key !== "방어도") s.n -= 1; });
  const rift = statusOf(u, "균열");
  if (rift) rift.v -= 1;
  u.st = u.st.filter((s) => (STATUS[s.key].decay !== "turn" || s.n > 0 || s.key === "방어도") && !(s.key === "균열" && s.v <= 0));
  updateCrisis(u);
  if (statusOf(u, "기절")) {
    u.st = u.st.filter((s) => s.key !== "기절");
    u.wait = baseWait(u);
    events.push({ kind: "status", id: u.id, amount: 0, text: "기절" });
    return false;
  }
  return true;
}

function updateCrisis(u: Unit) {
  const on = u.side === "ally" && u.alive && u.hp <= u.hpMax / 2;
  const has = !!statusOf(u, "위기");
  if (on && !has) u.st.push({ key: "위기", v: 1, n: T99 });
  if (!on && has) u.st = u.st.filter((s) => s.key !== "위기");
}

// ===== 커맨드 사용 가능 여부 =====
export function usable(b: Battle, u: Unit, a: ActDef): { ok: boolean; sealed?: boolean; reason?: string } {
  if (a.cmd === "swap") return { ok: false, reason: "교대 화면 준비 중." };
  if (a.cmd === "flee") return { ok: false, reason: "도주 규칙 준비 중." };
  if (statusOf(u, "침묵") && !a.cmd && !a.item && a.id !== "attack") return { ok: false, sealed: true, reason: "침묵 상태다." };
  if (statusOf(u, "무장해제") && isAttackAct(a)) return { ok: false, sealed: true, reason: "무장해제 상태다." };
  if (a.item && !(b.bag[a.item] > 0)) return { ok: false, reason: "남은 개수가 없다." };
  if (u.cds[a.id] > 0) return { ok: false, reason: `재사용 대기 ${u.cds[a.id]}턴.` };
  const tp = a.cost?.tp;
  if (tp === "all" ? u.tp < 1 : tp != null && u.tp < tp) return { ok: false, reason: "TP가 부족하다." };
  if (a.cost?.mp === "all" ? u.mp < 1 : u.mp < mpCost(u, a)) return { ok: false, reason: "MP가 부족하다." };
  const pre = (a as SkillDef).pre?.(ctx(b, u));
  if (pre) return { ok: false, reason: pre };
  if (a.tgt === "dead" && !b.allies.some((x) => !x.alive)) return { ok: false, reason: "쓰러진 아군이 없다." };
  return { ok: true };
}

// ===== 대상 =====
/** 적 한 열의 순서 (위→아래) */
const colList = (b: Battle, col: "f" | "b") => b.foes.filter((f) => f.alive && f.col === col);
function rowIndex(b: Battle, f: Unit) {
  return colList(b, f.col ?? "f").indexOf(f);
}
function crossOf(b: Battle, t: Unit): Unit[] {
  const col = colList(b, t.col ?? "f"), i = col.indexOf(t);
  const other = colList(b, t.col === "f" ? "b" : "f")[i];
  return [t, col[i - 1], col[i + 1], other].filter((x): x is Unit => !!x);
}
function lineOf(b: Battle, t: Unit): Unit[] {
  const other = colList(b, t.col === "f" ? "b" : "f")[rowIndex(b, t)];
  return other ? [t, other] : [t];
}
/** 같은 열 위·아래 (횡베기 부가 대상) */
function sidesOf(b: Battle, t: Unit): Unit[] {
  const col = colList(b, t.col ?? "f"), i = col.indexOf(t);
  return [col[i - 1], col[i + 1]].filter((x): x is Unit => !!x);
}

/** 고를 수 있는 대상 묶음. 단일은 묶음 하나에 한 명, 범위는 묶음 하나. */
export function targetSets(b: Battle, u: Unit, a: ActDef): Unit[][] {
  const foes = b.foes.filter((f) => f.alive);
  const single = foeCardOrder(b).filter((f) => f.alive);
  switch (a.tgt) {
    case "one": return single.map((f) => [f]);
    case "cross": return single.map((f) => crossOf(b, f));
    case "line": return single.map((f) => lineOf(b, f));
    case "col": return (["f", "b"] as const).map((c) => colList(b, c)).filter((l) => l.length);
    case "all":
    case "rand": return foes.length ? [foes] : [];
    case "row": { const front = foes.filter(isFront); return [front.length ? front : foes.filter(isBack)]; }
    case "ally": return b.allies.filter((p) => p.alive).map((p) => [p]);
    case "allyAll": return [b.allies.filter((p) => p.alive)];
    case "dead": return b.allies.filter((p) => !p.alive).map((p) => [p]);
    default: return [[u]];
  }
}

export function foeCardOrder(b: Battle): Unit[] {
  return [...b.foes.filter((f) => f.col === "f"), ...b.foes.filter((f) => f.col === "b")];
}

// ===== 피해·회복 (5장) =====
/** 공격 보정 % (주는 피해 증가). 소모형 상태는 미리보기에서도 더하고, 실제 소모는 execAlly가 한다. */
function attackPct(u: Unit, a: ActDef, t: Unit): number {
  let pct = -statusV(u, "약화");
  const ch = statusOf(u, "기병 돌격");
  if (ch && isAttackAct(a)) pct += ch.v;
  const sp = statusOf(u, "기합");
  if (sp && isAttackAct(a)) pct += sp.v;
  if (statusOf(u, "충전") && a.dmgType === "magic") pct += 30;
  if (current) for (const h of hooksOf(u)) pct += h.dmgPct?.(ctx(current, u), a, t) ?? 0;
  return pct;
}
function takenPct(t: Unit, from: Unit | null, element: ElementId | undefined): number {
  let pct = statusV(t, "취약");
  if (statusOf(t, "경감")) pct -= 20;
  if (current) for (const h of hooksOf(t)) pct += h.takenPct?.(ctx(current, t), from, element) ?? 0;
  return pct;
}

/** 급소 (오브 [선견] 3, 2026-11-07): 피해 ×1.5, 방어도 무시, 대상의 피해 감소(경감·받는 피해 감소 패시브)와 회피(패링 등) 무시. */
export const VITAL_MUL = 1.5;

/** 5.1 피해 계산 (한 타격). 방어력 경감·관통은 없다. vital = 급소 */
export function damage(atk: Unit, def: Unit, a: ActDef, power: { pct: number; flat: number }, vital = false): number {
  const dmgType = a.dmgType === "magic" ? "magic" : a.dmgType === "fixed" ? "fixed" : "physical";
  const st = dmgType === "magic" ? stat(atk, "spl") : stat(atk, "atk");
  let d = (st * power.pct) / 100 + power.flat;
  if (a.special === "shieldBash") d = stat(atk, "atk") * 0.5 + stat(atk, "def") * 0.5;
  if (a.special === "execute" && def.hp <= def.hpMax * 0.3) d *= 2;
  const rate = dmgType === "fixed" ? 1 : Math.max(0, affinityRate(def.affinity, a.element));
  d *= rate;
  d *= Math.max(0.25, 1 + attackPct(atk, a, def) / 100);
  if (a.dmgType === "magic" && atk.elem?.length && (a.element || a.elemAll)) d *= 1 + (atk.elem.filter((e) => a.elemAll || e === a.element).length * ELEM_STACK_PCT) / 100;
  if (overloaded(atk, a)) d *= 1.5;
  const taken = takenPct(def, atk, a.element);
  d *= clamp(1 + (vital ? Math.max(0, taken) : taken) / 100, 0.25, 3); // 급소는 감소분만 무시 (증가는 그대로)
  if (vital) d *= VITAL_MUL;
  // 공용 [버티기]: 방어도가 있을 때(방어 행동 중) 받는 피해 고정 감소. 급소는 무시
  if (!vital && current && statusOf(def, "방어도")) for (const h of hooksOf(def)) d -= h.takenFlat?.(ctx(current, def)) ?? 0;
  return rate === 0 ? 0 : Math.max(1, Math.floor(d));
}

export function healAmount(src: Unit, dst: Unit, power: { pct: number; flat: number }): number {
  const burn = statusOf(dst, "화상") ? 0.5 : 0;
  let up = 0;
  if (current) for (const h of hooksOf(src)) up += h.healPct?.(ctx(current, src)) ?? 0;
  return Math.max(0, Math.floor((stat(src, "spl") * power.pct / 100 + power.flat) * (1 + up / 100) * (1 - burn)));
}

/** 마력 연소: 소모한 MP × 2 (단계 2/2.5/3, 2026-11-07) */
const BURN_MUL = 2;
/** 원소 스택 (마법사, 2026-11-07): 4원소 마법을 쓰면 쌓이고, 쌓인 같은 원소 1개당 그 원소 마법 위력 +10%. 원소 방출이 전부 소모 */
export const ELEM_STACK_MAX = 4;
export const ELEM_STACK_PCT = 10;
const STACK_ELEMS: ElementId[] = ["red", "blue", "green", "yellow"];
/** 가장 많이 쌓인 원소 (같으면 나중에 쌓인 쪽) */
export function dominantElem(u: Unit): ElementId | undefined {
  const s = u.elem ?? [];
  let best: ElementId | undefined, n = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s.filter((e) => e === s[i]).length;
    if (c > n) { n = c; best = s[i]; }
  }
  return best;
}
/** 원소 방출은 가장 많이 쌓인 원소 속성으로 친다 */
/** 원소 방출: 4원소가 하나씩 다 있으면 프리즘 (필살기급 위력, 4원소 성질, 상성 계산 없음) */
export const PRISM_POWER = { flat: 160, pct: 320 };
export const isPrism = (u: Unit) => STACK_ELEMS.every((e) => u.elem?.includes(e));
const resolveAct = (u: Unit, a: ActDef): ActDef => {
  if (a.special !== "release") return a;
  if (isPrism(u)) return { ...a, element: undefined, elemAll: true, power: PRISM_POWER, name: "원소 방출: 프리즘" };
  return { ...a, element: dominantElem(u) };
};
const powerOf = (u: Unit, a: ActDef) => {
  const p = a.power ?? { pct: 0, flat: 0 };
  if (a.special === "mpBurn") return { pct: 0, flat: u.mp * BURN_MUL };
  const ls = lastStandFlat(u, a);
  return a.cost?.tp === "all" ? { pct: p.pct * u.tp, flat: p.flat * u.tp + ls } : { pct: p.pct, flat: p.flat + ls };
};

export function previewDamage(u: Unit, a: ActDef, t: Unit): number {
  a = resolveAct(u, a);
  if (!isAttackAct(a)) return 0;
  return damage(u, t, a, powerOf(u, a)) * (a.hits ?? 1);
}
export function previewHpLoss(u: Unit, a: ActDef, t: Unit): number {
  const raw = previewDamage(u, a, t);
  const g = a.ignoreShield ? 0 : statusV(t, "방어도") / (a.shieldMul ?? 1);
  return clamp(raw - g, 0, t.hp);
}
export function previewHeal(u: Unit, a: ActDef, t: Unit): number {
  return a.dmgType === "heal" ? Math.min(healAmount(u, t, powerOf(u, a)), t.hpMax - t.hp) : 0;
}

/** 방어 행동의 방어도 = 방어력 × (1 + 맹세·방패 마스터리 등 %). */
export function guardValue(u: Unit): number {
  let pct = 0;
  if (current) for (const h of hooksOf(u)) pct += h.guardPct?.(ctx(current, u)) ?? 0;
  if (statusOf(u, "맹세: 정복")) pct -= 20;
  return Math.round(stat(u, "def") * (1 + pct / 100));
}

/** 방어도 얻기. 무방비면 얻지 못한다. */
function gainShield(t: Unit, n: number) {
  if (n <= 0 || !t.alive) return;
  if (statusOf(t, "무방비")) { evSink.push({ kind: "status", id: t.id, amount: 0, text: "무방비" }); return; }
  addStatus(t, { key: "방어도", v: Math.round(n), n: 0 });
  evSink.push({ kind: "status", id: t.id, amount: n, text: `방어도 ${Math.round(n)}` });
}

interface HitOpts { ignoreShield?: boolean; shieldMul?: number; vital?: boolean }
/** 피해 적용. 방어도 흡수 → HP. 치명타 버팀(가호·최후의 보루), 경감 소모, 기병 돌격 제거, 균열 추가 피해. 준 피해를 돌려준다. */
function applyDamage(_b: Battle, t: Unit, dmg: number, o: HitOpts = {}): number {
  const rift = statusV(t, "균열") * 2;
  dmg += rift;
  // 죽음의 무도: 피격 피해(균열 포함)의 30%를 줄이고 그만큼 [유예] (급소는 무시). 수치 잠정
  if (!o.vital && dmg > 0 && hasPassive(t, "deathDance")) {
    const cut = Math.floor(dmg * 0.3);
    if (cut > 0) { dmg -= cut; addStatus(t, { key: "유예", v: cut, n: 99 }); }
  }
  const g = statusOf(t, "방어도");
  let rest = dmg, dealt = 0;
  if (g && !o.ignoreShield && !o.vital) {
    const mul = o.shieldMul ?? 1;
    const ab = Math.min(g.v, rest * mul);
    g.v -= ab;
    dealt += ab;
    rest -= ab / mul;
    if (g.v <= 0) t.st = t.st.filter((s) => s !== g);
  }
  rest = Math.round(rest);
  if (rest >= t.hp) {
    const save = statusOf(t, "가호") ?? statusOf(t, "최후의 보루");
    if (save) {
      t.st = t.st.filter((s) => s !== save);
      rest = t.hp - 1;
      evSink.push({ kind: "status", id: t.id, amount: 0, text: save.key });
    }
  }
  dealt += Math.min(rest, t.hp);
  t.hp = Math.max(0, t.hp - rest);
  if (dmg > 0) {
    const ease = o.vital ? undefined : statusOf(t, "경감"); // 급소는 경감을 무시하므로 소모하지도 않는다
    if (ease && (ease.v -= 1) <= 0) t.st = t.st.filter((s) => s !== ease);
    if (t.side === "ally") t.st = t.st.filter((s) => s.key !== "기병 돌격");
  }
  updateCrisis(t);
  return dealt;
}

const isControl = (k: StatusKey) => STATUS[k].t === "ctrl";
const isAggroKey = (k: StatusKey) => k === "은신";
const isBuffKey = (k: StatusKey) => STATUS[k].t === "buff" && k !== "방어도" && !isAggroKey(k);
const isDebuffKey = (k: StatusKey) => STATUS[k].t === "debuff" || isControl(k);
const STAT_BUFFS: StatusKey[] = ["힘", "집중", "견고", "가속", "고양"];

/**
 * 상태 걸기. 다시 걸면: 지속형은 턴 합산, 스택형은 수치 합산, 도발·은신은 수치 높은 쪽, 출혈(유지형)은 누적 없음.
 * 예방의 축문은 약화 1번을 막는다. by = 건 유닛 (단련·축문 강화 판정).
 */
export function addStatus(t: Unit, e: EffectDef, by?: Unit) {
  if (!t.alive && e.key !== "방어도") return;
  if (t.side === "ally" && isDebuffKey(e.key)) {
    const ward = statusOf(t, "예방의 축문");
    if (ward) { t.st = t.st.filter((s) => s !== ward); evSink.push({ kind: "status", id: t.id, amount: 0, text: "막음" }); return; }
  }
  if (MENTAL.includes(e.key) && nonAttackImmune(t)) { evSink.push({ kind: "status", id: t.id, amount: 0, text: "면역" }); return; }
  let n = e.n;
  if (by && by === t && STAT_BUFFS.includes(e.key) && hasPassive(by, "train")) n += 1;
  if (by && (e.key === "예방의 축문" || e.key === "수호의 축문") && hasPassive(by, "chantPlus")) n += 1;
  const s = statusOf(t, e.key);
  if (!s) {
    t.st.push({ key: e.key, v: e.v, n });
    return;
  }
  const decay = STATUS[e.key].decay;
  if (e.key === "출혈") s.v = Math.max(s.v, e.v);
  else if (isAggroKey(e.key)) s.v = Math.max(s.v, e.v);
  else if (decay === "turn" && !STAT_MOD_PCT[e.key] && e.key !== "기합" && e.key !== "수호의 축문") s.v += e.v;
  else if (e.key === "선견") s.v = Math.min(3, s.v + e.v);
  else if (e.key === "유예") s.v += e.v;
  else if (decay === "once" && ["경감", "패링", "기병 돌격"].includes(e.key)) s.v = e.key === "기병 돌격" ? Math.max(s.v, e.v) : s.v + e.v;
  else s.v = Math.max(s.v, e.v);
  if (decay === "turn") s.n = STAT_MOD_PCT[e.key] ? s.n + n : Math.max(s.n, n);
}

function kill(b: Battle, u: Unit, killer: Unit | null) {
  u.alive = false;
  u.hp = 0;
  u.tp = 0;
  u.st = [];
  if (u.side === "foe") {
    // 처치 관여 = 이번 전투에서 이 적에게 피해를 준 아군 전원 (classes.md 판정 용어)
    for (const a of b.allies) {
      if (!a.alive || !(b.dealt[a.id]?.[u.id] > 0)) continue;
      for (const h of hooksOf(a)) h.onKill?.(ctx(b, a), u, a === killer);
    }
  } else { u.danger = 0; u.dangerMarked = false; }
}

// ===== 위험도 (7장, 2026-11-08 전면 개편 — 옛 어그로 점수표·엄호·위협 보정은 없앴다) =====
/** 전투 시작 대기 = 기본 대기 × 이 비율 */
export const START_WAIT = { ally: 0.4, foe: 0.6 };
/**
 * 위험도 = 아군마다 쌓이는 스택. 적은 대상 지정 공격을 정할 때(자기 턴 종료 시) 위험도가 높은 아군일수록 높은 확률로 고른다.
 * 쌓임: 행동 +1 · 공격(피해를 줌) +1 · 한 번에 적 최대 HP의 bigPct% 이상 피해 +1 · 처치 1마리당 +2 · 강화·약화·회복·정화 효과 +1 · 스킬 고유(도발 등).
 * 줄어듦: 자기 턴 종료 시 1, 그 턴에 위험도를 쌓지 않았으면 1 더. 전열은 전투 시작 때 1을 쌓고 시작한다.
 * 수치는 첫 안 TODO(spec).
 */
export const DANGER = { start: 1, act: 1, attack: 1, bigHit: 1, bigPct: 25, kill: 2, effect: 1, max: 9, decay: 1, idleDecay: 1, reset: 3 };
/*
 * 최대치 (2026-11-09): 위험도가 DANGER.max에 닿으면 [표적]이 된다 — 다음에 움직일 적 중 대상 지정 공격을 준비한 적이
 * 그 아군으로 대상을 바꾸고(준비한 적이 없으면 다음에 대상 지정 공격을 정하는 적이 그 아군을 고른다), 그 공격을 받으면
 * 위험도가 DANGER.reset으로 떨어진다 (0까지는 아니다). 위험도가 끝없이 쌓이지 않게 하는 장치.
 */
/** 적이 대상을 고를 때 가중치 = (위험도 + 1)² */
const dangerWeight = (u: Unit) => (danger(u) + 1) ** 2;
export const danger = (u: Unit) => u.danger ?? 0;
/** 위험도를 얻는다 (최대 DANGER.max). 이번 턴에 쌓았다고 표시 */
export function gainDanger(u: Unit, n: number) {
  if (n <= 0 || u.side !== "ally") return;
  u.danger = Math.min(DANGER.max, danger(u) + n);
  u.dangerGained = true;
  if (u.danger >= DANGER.max && !u.dangerMarked) markMax(u);
}
/** 위험도 최대치: 다음에 움직일 적(대상 지정 공격 준비 중)의 대상을 이 아군으로 */
function markMax(u: Unit) {
  u.dangerMarked = true;
  const b = current;
  if (!b) return;
  const f = b.foes
    .filter((x) => x.alive && x.intent && ["one", "multi", "aim", "debuff"].includes(x.intent.k))
    .sort((x, y) => x.wait - y.wait)[0];
  if (f) {
    f.intent!.tgt = u.id;
    f.forcedTgt = u.id;
  }
}
const isDangerAction = (a: ActDef) => !a.cmd || a.id === "attack";
/** 이번 행동으로 얻을 위험도 (실행 결과 또는 미리보기 공용) */
function dangerOf(a: ActDef, outs: Outcome[], killed: number, effects: boolean): number {
  if (!isDangerAction(a)) return a.special === "taunt" ? TAUNT_DANGER : 0;
  let n = DANGER.act;
  const foeOuts = outs.filter((o) => o.t.side === "foe");
  if (foeOuts.some((o) => o.dealt > 0)) n += DANGER.attack;
  if (foeOuts.some((o) => o.dealt >= (o.t.hpMax * DANGER.bigPct) / 100)) n += DANGER.bigHit;
  n += killed * DANGER.kill;
  if (effects) n += DANGER.effect;
  if (a.aggroConst) n += Math.round(a.aggroConst.n / 100); // 스킬 고유 위험도 (옛 어그로 상수 100 = 위험도 1)
  if (a.special === "taunt") n += TAUNT_DANGER;
  return n;
}
/** 도발: 얻는 위험도 */
export const TAUNT_DANGER = 3;

/** 대상 지정 공격의 대상: 은신 아닌 아군 중 위험도 가중 무작위. 도발로 고정된 대상이 살아 있으면 그쪽 */
export function pickTarget(b: Battle, foe: Unit): Unit | null {
  const cands = b.allies.filter((c) => c.alive);
  if (!cands.length) return null;
  const forced = foe.forcedTgt ? cands.find((c) => c.id === foe.forcedTgt) : undefined;
  if (forced) return forced;
  // 위험도 최대치([표적])인 아군이 있으면 그쪽 (가장 먼저 표적이 된 아군)
  const marked = cands.find((c) => c.dangerMarked);
  if (marked) return marked;
  const visible = cands.filter((c) => !statusOf(c, "은신"));
  const pool = visible.length ? visible : cands;
  const sum = pool.reduce((t, c) => t + dangerWeight(c), 0);
  let r = Math.random() * sum;
  for (const c of pool) if ((r -= dangerWeight(c)) < 0) return c;
  return pool[pool.length - 1];
}
/** 아군마다 지금 적에게 노려질 확률 % (화면 표시용) */
export function targetChances(b: Battle): (number | null)[] {
  const pool = b.allies.filter((c) => c.alive && !statusOf(c, "은신"));
  const sum = pool.reduce((t, c) => t + dangerWeight(c), 0);
  return b.allies.map((c) => (pool.includes(c) && sum > 0 ? Math.round((dangerWeight(c) / sum) * 100) : null));
}
/** 전투 시작: 전열(칸 0~2)은 위험도 1 */
function initDanger(b: Battle) {
  for (const c of b.allies) {
    c.danger = c.slot < 3 ? DANGER.start : 0;
    for (const s of c.passives) c.danger += s.dangerStart ?? 0;
    c.dangerGained = false;
  }
}
/** 자기 턴 종료 시: 1 줄고, 이번 턴에 쌓지 않았으면 1 더 (공용 [기척 죽이기]는 더 줄어든다) */
function decayDanger(u: Unit) {
  if (u.side !== "ally") return;
  let d = DANGER.decay + (u.dangerGained ? 0 : DANGER.idleDecay);
  for (const s of u.passives) d += s.dangerDecay ?? 0;
  u.danger = Math.max(0, danger(u) - d);
  u.dangerGained = false;
}

interface Outcome { t: Unit; dealt: number; healed: number; buffs: number; debuffs: number }


const countFx = (a: ActDef, t: Unit, self: boolean) =>
  new Set((a.effects ?? []).filter((e) => !!e.to === self && (t.side === "foe" ? isDebuffKey(e.key) : isBuffKey(e.key))).map((e) => e.key)).size;

/** 이 행동을 하면 얻을 위험도 (대상 선택 중 미리보기) */
export function previewDanger(_b: Battle, actor: Unit, a: ActDef, targets: Unit[]): number {
  const outs: Outcome[] = targets.map((t) => ({
    t,
    dealt: t.side === "foe" ? Math.min(previewDamage(actor, a, t), statusV(t, "방어도") + t.hp) : 0,
    healed: t.side === "ally" ? previewHeal(actor, a, t) : 0,
    buffs: t.side === "ally" ? countFx(a, t, false) : 0,
    debuffs: t.side === "foe" ? countFx(a, t, false) : 0,
  }));
  const killed = outs.filter((o) => o.t.side === "foe" && o.dealt >= o.t.hp + statusV(o.t, "방어도") && o.dealt > 0).length;
  const effects = outs.some((o) => o.healed > 0 || o.buffs > 0 || o.debuffs > 0) || countFx(a, actor, true) > 0 || !!a.cleanseN;
  return dangerOf(a, outs, killed, effects);
}

/** 정화로 고를 수 있는 상태이상 (약화 극성, 영구형·위기 제외) */
export function cleansable(u: Unit): StatusKey[] {
  return u.st.filter((s) => (STATUS[s.key].t === "debuff" || STATUS[s.key].t === "ctrl") && STATUS[s.key].decay !== "perm").map((s) => s.key);
}

// ===== 아군 행동 실행 (4장) =====
export interface ExecOpts {
  /** 정화 스킬로 고른 상태이상 */
  cleanseKeys?: StatusKey[];
  /** 메아리 반복 (비용 없음) */
  echo?: boolean;
}

/** 진두지휘: 자신에게 걸린 능력치 강화를 아군 전체에 1턴 */
function spreadLead(b: Battle, u: Unit, keys: StatusKey[], r: ActionResult) {
  if (!keys.length || !hasPassive(u, "lead")) return;
  for (const a of b.allies) {
    if (a === u || !a.alive) continue;
    for (const k of keys) addStatus(a, { key: k, v: STAT_MOD_PCT[k] ? 1 : 10, n: 1 }, u);
    if (!r.buffed.includes(a)) r.buffed.push(a);
  }
}

function doGuard(b: Battle, u: Unit, n: number) {
  for (let i = 0; i < n; i++) {
    gainShield(u, guardValue(u));
    for (const h of hooksOf(u)) h.onGuard?.(ctx(b, u));
  }
}

export function execAlly(b: Battle, u: Unit, a: ActDef, targets: Unit[], events: BattleEvent[], opts: ExecOpts = {}) {
  current = b;
  evSink = events;
  if (!opts.echo) supportFired = false;
  const sk = a as SkillDef;
  a = resolveAct(u, a);
  // 원소 방출인데 스택이 없다 (메아리 두 번째: 첫 방출이 스택을 다 썼다) → 불발
  if (a.special === "release" && !u.elem?.length) {
    events.push({ kind: "miss", id: u.id, amount: 0, text: "불발" });
    return { targets, dealt: 0, healed: 0, buffed: [], cleansed: 0, killed: [], attack: false, support: false } as ActionResult;
  }
  const r: ActionResult = { targets, dealt: 0, healed: 0, buffed: [], cleansed: 0, killed: [], attack: isAttackAct(a), support: false };

  // 비용 (메아리 반복은 없음)
  const tpBefore = u.tp, mpBefore = u.mp;
  if (!opts.echo) {
    const free = isSupportSkill(a) && !!statusOf(u, "기적");
    const mp = mpCost(u, a);
    if (a.cost?.tp && a.cost.tp !== "all") u.tp -= a.cost.tp;
    u.mp -= a.cost?.mp === "all" ? u.mp : mp;
    if (a.item) b.bag[a.item] -= 1;
    if (a.cd && !free) u.cds[a.id] = Math.max(1, Math.floor(a.cd * costMul(b, u, a))) + 1;
    if (free) { u.st = u.st.filter((s) => s.key !== "기적"); events.push({ kind: "status", id: u.id, amount: 0, text: "기적" }); }
  }

  if (a.cmd === "wait") {
    for (const h of hooksOf(u)) h.onWait?.(ctx(b, u));
    return;
  }
  if (a.cmd === "guard") {
    doGuard(b, u, 1);
    return;
  }
  // 원정 가방의 MP 회복약 (2026-11-08): 대상 MP를 power.flat만큼
  if (a.special === "itemMp") {
    for (const t of targets) {
      const g = Math.max(0, Math.min(t.mpMax - t.mp, a.power?.flat ?? 0));
      t.mp += g;
      events.push({ kind: "status", id: t.id, amount: 0, text: `MP +${g}` });
    }
    return;
  }
  if (a.special === "overload") {
    if (statusOf(u, "과충전")) { u.st = u.st.filter((s) => s.key !== "과충전"); events.push({ kind: "status", id: u.id, amount: 0, text: "과충전 해제" }); }
    else { addStatus(u, { key: "과충전", v: 1, n: T99 }); events.push({ kind: "status", id: u.id, amount: 0, text: "과충전" }); }
    return;
  }

  // 암흑: 다음 대상 지정 공격이 빗나간다
  const miss = isAttackAct(a) && a.tgt === "one" && !!statusOf(u, "암흑");
  if (miss) u.st = u.st.filter((s) => s.key !== "암흑");
  // 선견 3: 이번 공격은 급소 (방어도 무시), 선견 모두 소모
  const vital = isAttackAct(a) && !opts.echo && (statusOf(u, "선견")?.v ?? 0) >= 3;
  if (vital) { u.st = u.st.filter((s) => s.key !== "선견"); events.push({ kind: "status", id: u.id, amount: 0, text: "급소" }); }

  const outs: Outcome[] = [];
  let pw = powerOf(u, a);
  if (a.special === "mpBurn") pw = { pct: 0, flat: mpBefore * BURN_MUL };
  if (a.cost?.tp === "all") pw = { pct: (a.power?.pct ?? 0) * tpBefore, flat: (a.power?.flat ?? 0) * tpBefore + lastStandFlat(u, a) };
  const pool = b.foes.filter((f) => f.alive);
  const hitList: Unit[][] = a.tgt === "rand"
    ? Array.from({ length: a.hits ?? 1 }, () => [pool[Math.floor(Math.random() * pool.length)]].filter(Boolean))
    : [targets];
  const hits = a.tgt === "rand" ? 1 : a.hits ?? 1;

  const hitOne = (t: Unit, power: { pct: number; flat: number }, o: Outcome) => {
    if (miss) { events.push({ kind: "miss", id: t.id, amount: 0, text: "빗나감" }); return; }
    const before = t.hp;
    // TODO(code): 적이 회피 상태(패링·회피)를 갖게 되면 여기서 급소는 그것을 무시한다. 지금 적에게는 회피 상태가 없다.
    const dmg = damage(u, t, a, power, vital);
    const dealt = applyDamage(b, t, dmg, { ignoreShield: a.ignoreShield, shieldMul: a.shieldMul, vital });
    o.dealt += dealt;
    r.dealt += dealt;
    if (t.side === "foe") b.dealt[u.id][t.id] = (b.dealt[u.id][t.id] ?? 0) + dealt;
    events.push({ kind: "dmg", id: t.id, amount: before - t.hp, hpBefore: before });
    if (t.side === "foe" && statusOf(t, "출혈")) u.flags.woundHit = 1;
    for (const h of hooksOf(u)) h.onHitDealt?.(ctx(b, u), t, a, dealt);
    if (t.hp <= 0 && t.alive) { kill(b, t, u); r.killed.push(t); }
  };

  for (const group of hitList) {
    for (const t of group) {
      if (!t) continue;
      if (!t.alive && a.tgt !== "dead") continue;
      let o = outs.find((x) => x.t === t);
      if (!o) { o = { t, dealt: 0, healed: 0, buffs: 0, debuffs: 0 }; outs.push(o); }
      if (isAttackAct(a)) for (let h = 0; h < hits && t.alive; h++) hitOne(t, pw, o);
      if (a.dmgType === "heal" && t.alive) {
        o.healed = Math.min(healAmount(u, t, pw), t.hpMax - t.hp);
        t.hp += o.healed;
        r.healed += o.healed;
        events.push({ kind: "heal", id: t.id, amount: o.healed });
        updateCrisis(t);
      }
      if (a.dmgType === "shield" && t.alive) gainShield(t, healAmount(u, t, pw));
      if (a.cleanse) t.st = t.st.filter((s) => s.key !== a.cleanse);
      if (a.cleanseN) {
        const keys = (opts.cleanseKeys ?? cleansable(t)).slice(0, a.cleanseN);
        t.st = t.st.filter((s) => !keys.includes(s.key));
        r.cleansed += keys.length;
        if (keys.length) events.push({ kind: "status", id: t.id, amount: 0, text: `${keys.join("·")} 제거` });
      }
      if (t.alive) {
        for (const e of a.effects ?? []) if (!e.to) addStatus(t, e, u);
        o.buffs = t.side === "ally" ? countFx(a, t, false) : 0;
        o.debuffs = t.side === "foe" ? countFx(a, t, false) : 0;
        if (t.side === "ally" && t !== u && o.buffs) r.buffed.push(t);
      }
    }
  }
  // 횡베기: 같은 열 위·아래 부가 피해
  if (a.special === "sweep" && targets[0]?.side === "foe") {
    const side = { pct: Math.round(pw.pct / 2), flat: Math.round(pw.flat / 2) };
    for (const t of sidesOf(b, targets[0])) {
      if (!t.alive) continue;
      const o: Outcome = { t, dealt: 0, healed: 0, buffs: 0, debuffs: 0 };
      outs.push(o);
      hitOne(t, side, o);
    }
  }
  if (a.special === "delay10" || a.special === "shieldBash") for (const t of targets) if (t.alive) t.wait += a.special === "delay10" ? 10 : 15;
  if (a.special === "manaBarrier") gainShield(u, (mpBefore - u.mp) * 2);
  if (a.special === "revive") {
    const t = targets[0];
    if (t && !t.alive) {
      t.alive = true;
      t.hp = Math.max(1, Math.round(t.hpMax * 0.01));
      t.wait = baseWait(t);
      t.danger = 0;
      r.healed += t.hp;
      events.push({ kind: "heal", id: t.id, amount: t.hp, text: "부활" });
    }
  }
  if (a.special === "guardChant") {
    const v = healAmount(u, u, { pct: 25, flat: 12 });
    for (const t of targets) { addStatus(t, { key: "수호의 축문", v, n: 3 }, u); if (t !== u) r.buffed.push(t); }
  }
  if (a.special === "chant") for (const t of targets) if (t !== u && !r.buffed.includes(t)) r.buffed.push(t);
  const selfStatBuffs: StatusKey[] = [];
  for (const e of a.effects ?? []) if (e.to === "self") { addStatus(u, e, u); if (STAT_BUFFS.includes(e.key)) selfStatBuffs.push(e.key); }
  spreadLead(b, u, selfStatBuffs, r);
  if (a.guards) doGuard(b, u, a.guards);
  sk.run?.(ctx(b, u), targets, r);
  outs.push({ t: u, dealt: 0, healed: 0, buffs: countFx(a, u, true), debuffs: 0 });

  if (isAttackAct(a)) {
    u.st = u.st.filter((s) => s.key !== "은신" && s.key !== "기병 돌격" && !(s.key === "충전" && a.dmgType === "magic"));
  }
  if (a.cost?.tp === "all") u.tp = 0;
  // TP는 기본 공격으로 +1. 스킬은 스킬 효과로 주는 것 말고는 없다. 출혈 중에는 TP 회복 불가
  if (a.id === "attack" && u.tpMax && !statusOf(u, "출혈")) u.tp = Math.min(u.tpMax, u.tp + tpGain(u));

  // [지원] = 아군 회복·강화·상태이상 제거 (행동당 1번)
  if (r.healed > 0 || r.buffed.length || r.cleansed > 0 || (a.tgt !== "self" && a.tgt !== "one" && countFx(a, u, false) > 0 && targets.some((t) => t.side === "ally"))) {
    r.support = true;
    fireSupport(b, u);
  }
  // 원소 스택: 방출은 전부 소모, 4원소 마법은 그 원소를 쌓는다 (메아리 반복도 다시 쓴 것이라 한 번 더 쌓인다)
  if (a.special === "release") u.elem = [];
  else if (a.dmgType === "magic" && a.element && STACK_ELEMS.includes(a.element) && u.side === "ally" && aptitudeOf(u.name).jobs.includes("마법사")) {
    u.elem = [...(u.elem ?? []), a.element].slice(-ELEM_STACK_MAX);
  }
  if (!opts.echo) for (const h of hooksOf(u)) h.onAction?.(ctx(b, u), a, r);
  // 위험도: 행동·공격·큰 피해·처치·효과 (7장)
  const fx = r.healed > 0 || r.buffed.length > 0 || r.cleansed > 0 || outs.some((o) => o.buffs > 0 || o.debuffs > 0);
  gainDanger(u, dangerOf(a, outs, r.killed.length, fx));
  // 도발: 대상 적의 공격 대상을 자신으로 (지금 대상 지정 공격을 하려는 중이면 바로, 아니면 다음 대상 지정 공격)
  if (a.special === "taunt") for (const t of targets) if (t.side === "foe" && t.alive) {
    t.forcedTgt = u.id;
    if (t.intent && ["one", "multi", "aim", "debuff"].includes(t.intent.k)) t.intent.tgt = u.id;
    events.push({ kind: "status", id: t.id, amount: 0, text: "도발" });
  }

  // 메아리: 다음 마법을 같은 대상에게 비용 없이 한 번 더
  if (!opts.echo && a.dmgType === "magic" && a.id !== "attack" && statusOf(u, "메아리")) {
    u.st = u.st.filter((s) => s.key !== "메아리");
    events.push({ kind: "status", id: u.id, amount: 0, text: "메아리" });
    execAlly(b, u, a, targets.filter((t) => t.alive), events, { ...opts, echo: true });
  }
}

// ===== 적 행동 (8장) =====
export function intentDamage(f: Unit, it: FoeAct): number {
  if (it.pct == null) return 0;
  const st = it.dmgType === "magic" ? stat(f, "spl") : stat(f, "atk");
  return Math.floor(st * it.pct / 100 * Math.max(0.25, 1 - statusV(f, "약화") / 100));
}

export function decideIntent(b: Battle, f: Unit) {
  const pat = f.type!.pattern;
  const act = pat[Math.floor(Math.random() * pat.length)];
  f.intent = { ...act };
  // 대상 지정 공격(단일·연속·조준·약화)은 지금 정한다 — 위험도 가중 무작위, 도발 고정이 있으면 그쪽 (7장)
  if (["one", "multi", "aim", "debuff"].includes(act.k)) {
    f.intent.tgt = pickTarget(b, f)?.id;
    f.forcedTgt = undefined;
  }
  if (act.k === "guard" || act.k === "buff") f.intent.tgt = "self";
}

/** 가로막기: 이 아군을 대신 맞아 줄 아군 */
function interceptor(b: Battle, t: Unit): Unit | null {
  return b.allies.find((a) => a.alive && a !== t && statusOf(a, "가로막기")?.v === t.slot) ?? null;
}

export function execFoe(b: Battle, f: Unit, events: BattleEvent[]): Unit[] {
  current = b;
  evSink = events;
  const it = f.intent!;
  const hitAllies = new Set<Unit>();
  const singleTarget = it.k === "one" || it.k === "multi" || it.k === "aim";
  const blind = singleTarget && !!statusOf(f, "암흑");
  if (blind) f.st = f.st.filter((s) => s.key !== "암흑");
  const foeAct: ActDef = { id: "foe", name: "", tgt: "one", dmgType: it.dmgType === "magic" ? "magic" : "physical", element: it.element, wait: 0, cat: "", desc: [] };
  const hitOne = (t0: Unit) => {
    let t = t0;
    if (singleTarget) {
      const guard = interceptor(b, t);
      if (guard) { guard.st = guard.st.filter((s) => s.key !== "가로막기"); events.push({ kind: "status", id: guard.id, amount: 0, text: "가로막기" }); t = guard; }
    }
    if (blind) { events.push({ kind: "miss", id: t.id, amount: 0, text: "빗나감" }); return t; }
    const parry = singleTarget ? statusOf(t, "패링") : undefined;
    if (parry) {
      if ((parry.v -= 1) <= 0) t.st = t.st.filter((s) => s !== parry);
      events.push({ kind: "status", id: t.id, amount: 0, text: "패링" });
      f.flags.waitPenalty = (f.flags.waitPenalty ?? 0) + PARRY_DELAY; // 흘린 적은 대기가 늘어난다
      return t;
    }
    const before = t.hp;
    applyDamage(b, t, damage(f, t, foeAct, { pct: it.pct ?? 0, flat: 0 }));
    events.push({ kind: "dmg", id: t.id, amount: before - t.hp, hpBefore: before });
    hitAllies.add(t);
    if (t.hp <= 0) kill(b, t, null);
    const counter = statusOf(t, "받아치기");
    if (counter && t.alive && f.alive && foeAct.dmgType === "physical") {
      t.st = t.st.filter((s) => s !== counter);
      const fb = f.hp;
      applyDamage(b, f, damage(t, f, t.basic, { pct: counter.v, flat: 0 }));
      events.push({ kind: "dmg", id: f.id, amount: fb - f.hp, hpBefore: fb });
      if (f.hp <= 0) kill(b, f, t);
    }
    return t;
  };
  const dt = it.dmgType ?? "physical";
  void dt;
  let targets: Unit[] = [];
  if (it.k === "one" || it.k === "multi") {
    let t = b.allies.find((a) => a.id === it.tgt && a.alive) ?? pickTarget(b, f);
    for (let h = 0; h < (it.hits ?? 1) && t && f.alive; h++) {
      targets.push(hitOne(t));
      if (!t.alive) t = pickTarget(b, f);
    }
  } else if (it.k === "aim") {
    const t = b.allies.find((a) => a.id === it.tgt && a.alive) ?? pickTarget(b, f);
    if (t) targets = [hitOne(t)];
  } else if (it.k === "all") {
    targets = b.allies.filter((a) => a.alive);
    targets.forEach((t) => hitOne(t));
  } else if (it.k === "row") {
    targets = b.allies.filter((a) => a.alive && (it.row === "b" ? a.slot >= 3 : a.slot < 3));
    targets.forEach((t) => hitOne(t));
  } else if (it.k === "guard") {
    const g = guardValue(f);
    addStatus(f, { key: "방어도", v: g, n: 0 });
    events.push({ kind: "status", id: f.id, amount: g, text: `방어도 ${g}` });
  } else if (it.k === "buff" && it.effect) {
    addStatus(f, it.effect, f);
    events.push({ kind: "status", id: f.id, amount: 0, text: "강화" });
  } else if (it.k === "debuff" && it.effect) {
    const t = b.allies.find((a) => a.id === it.tgt && a.alive) ?? pickTarget(b, f);
    if (t) {
      targets = [t];
      addStatus(t, it.effect, f);
      events.push({ kind: "status", id: t.id, amount: 0, text: "약화" });
    }
  }
  // [표적] 아군이 대상 지정 공격을 받았으면 (피해·패링·빗나감 상관없이) 위험도를 DANGER.reset으로
  if (singleTarget || it.k === "debuff")
    for (const t of targets)
      if (t.side === "ally" && t.dangerMarked) {
        t.danger = Math.min(danger(t), DANGER.reset);
        t.dangerMarked = false;
        events.push({ kind: "status", id: t.id, amount: 0, text: "위험도 해소" });
      }
  // 피격된 아군: TP +1 (적 행동당 1번, 출혈 중 불가), 피격 패시브
  hitAllies.forEach((t) => {
    if (!t.alive) return;
    if (t.tpMax && !statusOf(t, "출혈")) t.tp = Math.min(t.tpMax, t.tp + tpGain(t));
    for (const h of hooksOf(t)) h.onHitTaken?.(ctx(b, t), f);
  });
  return targets;
}

// ===== 턴 종료 (3.2) =====
export function endTurn(b: Battle, u: Unit, act: ActDef | null) {
  current = b;
  evSink = [];
  if (u.alive) {
    if (statusOf(u, "자동 방어")) doGuard(b, u, 1);
    if (hasPassive(u, "faith")) {
      const bad = u.st.filter((s) => STATUS[s.key].t !== "buff" && STATUS[s.key].decay !== "perm");
      if (bad.length) {
        const pick = bad[Math.floor(Math.random() * bad.length)];
        u.st = u.st.filter((s) => s !== pick);
        fireSupport(b, u);
      }
    }
    for (const h of hooksOf(u)) h.turnEnd?.(ctx(b, u));
    u.st = u.st.filter((s) => s.key !== "암흑");
    const para = statusOf(u, "마비");
    if (para) {
      para.v += 1;
      if (para.v >= triggerLine(b, u, "마비")) { u.st = u.st.filter((s) => s !== para); addStatus(u, { key: "기절", v: 1, n: T99 }); }
    }
    u.wait = actualWait(u, act, true) + (u.flags.waitPenalty ?? 0);
    delete u.flags.waitPenalty;
    decayDanger(u);
  }
  if (u.side === "foe" && u.alive) decideIntent(b, u);
}

export function outcome(b: Battle): "win" | "lose" | null {
  if (b.foes.every((f) => !f.alive)) return "win";
  if (b.allies.every((a) => !a.alive)) return "lose";
  return null;
}
