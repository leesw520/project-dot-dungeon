// 기본 4직업 스킬북 (docs/classes.md 6장, 2026-11-07). 스킬 하나 = 스킬 코어 하나 (data/skillCores.ts).
// 수치는 업그레이드 1단계(기본) 값. 위력은 "기본 위력 + 계수" (classes.md 4.5): 물리 b/k, 마법 b/k 표.
// 옵션·모드·업그레이드 단계는 코어 제작 보너스로 나중에 붙인다 (지금은 기본 효과만, TODO(spec)).
// 패시브와 고유 처리는 hooks/run 함수로 적는다. 함수는 engine/battle.ts가 넘기는 HookCtx로만 전투 상태를 바꾼다.
import type { ActDef, EffectDef, StatusKey } from "./battle";
import type { CoreReq } from "./aptitude";
import type { ElementId } from "./itemTaxonomy";
import type { StatKey } from "./stats";
import type { Battle, Unit } from "../engine/battle";

// ---------- 위력 변환 (classes.md 4.5) ----------
type Arch = "초반" | "표준" | "후반" | "화살";
const ARCH = {
  AD: { 초반: [20, 0.85], 표준: [10, 0.95], 후반: [5, 1.05], 화살: [10, 0.95] },
  AP: { 초반: [50, 0.7], 표준: [40, 0.8], 후반: [30, 0.9], 화살: [20, 0.9] },
} as const;
const r5 = (x: number) => Math.round(x * 20) * 5;
/** 옛 위력 p(%)를 (기본 위력 + 계수)로. */
function pw(kind: "AD" | "AP", p: number, arch: Arch = "표준") {
  const [b, k] = ARCH[kind][arch];
  return { flat: Math.round((b * p) / 100), pct: r5((k * p) / 100) };
}
const adText = (x: { flat: number; pct: number }) => `(${x.flat} + 공격력 ${x.pct}%)`;
const apText = (x: { flat: number; pct: number }) => `(${x.flat} + 주문력 ${x.pct}%)`;

// ---------- 훅 ----------
export interface ActionResult {
  targets: Unit[];
  /** 적에게 준 피해 합 (방어도 흡수 포함) */
  dealt: number;
  healed: number;
  /** 강화를 받은 아군 (시전자 제외) */
  buffed: Unit[];
  cleansed: number;
  killed: Unit[];
  /** 피해를 주는 행동이었나 (기본 공격·공격 스킬) */
  attack: boolean;
  /** 이번 행동이 [지원]이었나 */
  support: boolean;
}

export interface HookCtx {
  b: Battle;
  u: Unit;
  addSt(t: Unit, e: EffectDef): void;
  removeSt(t: Unit, k: StatusKey): void;
  has(t: Unit, k: StatusKey): boolean;
  heal(t: Unit, amount: number): number;
  shield(t: Unit, amount: number): void;
  tp(t: Unit, n: number): void;
  mp(t: Unit, n: number): void;
  /** 전투 중 실제 능력치 (강화·약화 반영) */
  stat(t: Unit, k: StatKey): number;
  log(t: Unit, text: string): void;
  /** [지원] 발동 (행동당 1번) */
  support(): void;
  rand(): number;
}

export interface Hooks {
  battleStart?(c: HookCtx): void;
  turnStart?(c: HookCtx): void;
  turnEnd?(c: HookCtx): void;
  onWait?(c: HookCtx): void;
  onGuard?(c: HookCtx): void;
  /** 적 행동 하나에 맞은 뒤 (적 행동당 1번) */
  onHitTaken?(c: HookCtx, from: Unit): void;
  /** 타격 하나를 맞힌 뒤 (다단은 타격마다) */
  onHitDealt?(c: HookCtx, t: Unit, a: ActDef, dealt: number): void;
  /** 자기 행동이 끝난 뒤 */
  onAction?(c: HookCtx, a: ActDef, r: ActionResult): void;
  /** 처치 관여한 적이 쓰러졌을 때 */
  onKill?(c: HookCtx, t: Unit, mine: boolean): void;
  onSupport?(c: HookCtx): void;
  /** 주는 피해 증가 % (공격 보정에 합산) */
  dmgPct?(c: HookCtx, a: ActDef, t: Unit): number;
  /** 받는 피해 증가 % (음수 = 감소) */
  takenPct?(c: HookCtx, from: Unit | null, element: ElementId | undefined): number;
  healPct?(c: HookCtx): number;
  /** 방어 행동 방어도 증가 % */
  guardPct?(c: HookCtx): number;
  /** 전투 중 능력치 증가 % (조건부) */
  statPct?(c: HookCtx, k: StatKey): number;
  /** 행동 대기 조정 (음수 = 감소) */
  waitAdj?(c: HookCtx, a: ActDef): number;
  /** MP 비용·재사용 배율 */
  costMul?(c: HookCtx, a: ActDef): number;
  /** 받는 피해 고정 감소 (방어도가 있을 때 = 방어 행동 중, 공용 [버티기]) */
  takenFlat?(c: HookCtx): number;
}

/** 전투 밖에서도 적용되는 능력치 (P01 표시·전투 시작 값). needWeapon이면 그 무기를 들었을 때만. */
export interface PartyMods {
  hpPct?: number;
  hpAdd?: number;
  defAdd?: number;
  mpAdd?: number;
  splPct?: number;
  /** 최대 MP + 주문력 × % (전환: conv와 같은 규칙) */
  mpSplPct?: number;
  /** 능력치 % (같은 능력치끼리 합산: 20% 둘 = +40%, 곱하지 않는다) */
  atkPct?: number;
  defPct?: number;
  agiPct?: number;
  mpPct?: number;
  /** 능력치 전환: to += from × pct%. from은 합산·% 적용이 끝난 값, 전환으로 늘어난 값은 다시 전환·%에 쓰지 않는다 (2026-11-08) */
  conv?: Array<{ from: "hp" | "mp" | "atk" | "spl" | "def" | "agi"; to: "hp" | "mp" | "atk" | "spl" | "def" | "agi"; pct: number }>;
  needWeapon?: string;
  /** 공용 코어 (2026-11-08): 능력치 고정 증가 · TP 최대 · 속성 상성 내성 단계 */
  atkAdd?: number;
  splAdd?: number;
  agiAdd?: number;
  tpMaxAdd?: number;
  resist?: Partial<Record<ElementId, number>>;
}

/** 탐색 패시브 (2026-11-08 공용 코어 확장, docs/common-cores.md 4장). 파티 안 같은 옵션은 합산. */
export interface ExploreMods {
  vision?: number;
  expPct?: number;
  foresee?: number;
  note?: string;
  light?: { radius: number; mp: number };
  /** 체류 횟수 + */
  stay?: number;
  /** 휴식 포인트 체류 보너스 + */
  rest?: number;
  /** 채집 때 1개 더 얻을 확률 % — 채광(바위·결정·모래) · 벌목(나무·시체·거미줄) · 채취(덤불·꽃·버섯·물) */
  gather?: { rock?: number; wood?: number; herb?: number };
  /** 길 타일 적 심볼 비율 −% */
  enemyDown?: number;
  /** 길 타일 아이템 심볼 비율 +% */
  itemUp?: number;
  /** 몬스터 드롭 확률 ×(1 + %) */
  dropPct?: number;
  /** 동물소재 드롭 확률 ×1.5 (도축) */
  butcher?: boolean;
  /** 도감 정보 + % (관찰) — 도감 정보 규칙이 아직 없다 TODO(spec) */
  dexPct?: number;
}

export interface SkillDef extends ActDef {
  /** 적성 이름 (기사 고유, 수호, 한손검 …) */
  apt: string;
  req: CoreReq;
  slots: number;
  passive?: boolean;
  hooks?: Hooks;
  party?: PartyMods;
  /** 탐색 패시브 */
  explore?: ExploreMods;
  /** 위협 생성 보정 % (공용 [프레셔]·[기척 죽이기]) */
  /** 위험도: 전투 시작 때 더 쌓고 시작 (공용 [프레셔]) · 턴 종료 때 더 줄어듦 (공용 [기척 죽이기]) — battle-rules.md 7장 */
  dangerStart?: number;
  dangerDecay?: number;
  /** 효과가 적용되는 스킬 (툴팁 보조 창에 습득 가능한 것 중 해당 스킬을 보여준다) */
  refers?(a: ActDef): boolean;
  /** 사용 조건 (없으면 항상). 거절 이유 문장을 돌려준다 */
  pre?(c: HookCtx): string | null;
  /** 기본 처리 뒤 고유 처리 */
  run?(c: HookCtx, targets: Unit[], r: ActionResult): void;
  /** 기본 공격 대체 (마력 화살) */
  basic?: ActDef;
  /** [지원] 스킬 (회복·강화·상태이상 제거) */
  supportSkill?: boolean;
  /** 방어 행동 n회 등 기본 처리로 표현이 안 되는 효과 설명 */
  lines: string[];
}

// ---------- 공용 ----------
const job = (tag: string): CoreReq => ({ type: "job", tags: [tag] });
const sub = (tag: string): CoreReq => ({ type: "sub", tags: [tag] });
const weapon = (tag: string): CoreReq => ({ type: "weapon", tags: [tag] });
const elem = (tag: ElementId): CoreReq => ({ type: "element", tags: [tag] });
const T99 = 99;
/** 기본 공격이거나 이 무기 적성의 스킬이면서 그 무기를 들었는가 */
const usesWeapon = (u: Unit, a: ActDef, w: string) => (a.weapon === w || a.id === "attack") && u.weapons.includes(w);
const isAttackAct = (a: ActDef) => a.dmgType === "physical" || a.dmgType === "magic" || a.dmgType === "fixed";
const statBuffKeys: StatusKey[] = ["힘", "집중", "견고", "가속", "고양"];
const isCrisis = (u: Unit) => u.alive && u.hp <= u.hpMax / 2;

function passive(id: string, name: string, apt: string, req: CoreReq, slots: number, lines: string[], hooks: Hooks = {}, extra: Partial<SkillDef> = {}): SkillDef {
  return { id, name, apt, req, slots, passive: true, tgt: "self", dmgType: "none", wait: 0, cat: "패시브", desc: lines, lines, hooks, ...extra };
}
function active(d: Omit<SkillDef, "desc" | "src"> & { desc?: string[] }): SkillDef {
  return { ...d, desc: d.desc ?? d.lines };
}

// ================= 기사 =================
const KN = "기사";
const knightSkills: SkillDef[] = [
  active({
    id: "kn_charge", name: "기병 돌격", apt: KN, req: job("기사"), slots: 2, tgt: "self", dmgType: "none", cost: { tp: 1 }, wait: -10, cd: 2,
    effects: [{ key: "기병 돌격", v: 50, n: T99, to: "self" }, { key: "고양", v: 10, n: 2, to: "self" }],
    cat: "강화 · 자신", lines: ["[기병 돌격]: 다음 공격 위력 +50%.", "공격하면 소모, 피해를 받으면 제거.", "고양 2턴."],
  }),
  active({
    id: "kn_breach", name: "연쇄 돌파", apt: KN, req: job("기사"), slots: 2, tgt: "one", dmgType: "physical", power: pw("AD", 120), cost: { tp: 2 }, wait: 0, seal: "weapon",
    cat: "물리 · 적 단일", lines: [`[기병 돌격] 상태에서만. 물리 ${adText(pw("AD", 120))}.`, "처치하면 [기병 돌격]과 고양을 다시 얻는다."],
    pre: (c) => (c.has(c.u, "기병 돌격") ? null : "[기병 돌격] 상태가 아니다."),
    run: (c, _t, r) => {
      if (r.killed.length) { c.addSt(c.u, { key: "기병 돌격", v: 50, n: T99 }); c.addSt(c.u, { key: "고양", v: 10, n: 2 }); }
    },
  }),
  passive("kn_chivalry", "기사도", KN, job("기사"), 2, ["공격을 받은 뒤 (적 행동당 1번) 방어도 (방어력의 25%)."], {
    onHitTaken: (c) => { if (c.u.alive) c.shield(c.u, Math.round(c.stat(c.u, "def") * 0.25)); },
  }),
  passive("kn_lance", "마상 창술", KN, job("기사"), 3, ["창 공격 피해 +15%.", "[기병 돌격] 상태면 추가 +10%."], {
    dmgPct: (c, a) => (usesWeapon(c.u, a, "창") ? 15 + (c.has(c.u, "기병 돌격") ? 10 : 0) : 0),
  }),
  passive("kn_oath", "맹세: 수호", KN, job("기사"), 2, ["전투 시작 시 영구 상태 [맹세: 수호].", "방어 행동의 방어도 +30%."], {
    battleStart: (c) => c.addSt(c.u, { key: "맹세: 수호", v: 1, n: T99 }),
    guardPct: () => 30,
  }),
  passive("kn_bastion", "최후의 보루", KN, job("기사"), 3, ["전투 시작 시 [최후의 보루].", "치명적인 피해를 HP 1로 버틴다 (1회)."], {
    battleStart: (c) => c.addSt(c.u, { key: "최후의 보루", v: 1, n: T99 }),
  }),

  // 수호
  active({
    id: "gd_taunt", name: "도발", apt: "수호", req: sub("수호"), slots: 2, tgt: "one", dmgType: "none", cost: { tp: 1 }, wait: 0, guards: 1, special: "taunt",
    cat: "적 단일", lines: ["적을 지정한다. 위험도 3을 얻고, 대상의 공격 대상을 자신으로 바꾼다.", "방어 행동 1회."],
  }),
  active({
    id: "gd_intercept", name: "가로막기", apt: "수호", req: sub("수호"), slots: 3, tgt: "ally", dmgType: "none", cost: { tp: 2 }, wait: -10, guards: 1,
    cat: "아군 단일", lines: ["[가로막기]: 그 아군이 맞을 공격을 대신 받는다 (1회).", "방어 행동 1회."],
    run: (c, t) => { const a = t[0]; if (a && a !== c.u) c.addSt(c.u, { key: "가로막기", v: a.slot, n: T99 }); },
  }),
  active({
    id: "gd_retribution", name: "응징", apt: "수호", req: sub("수호"), slots: 2, tgt: "one", dmgType: "physical", power: pw("AD", 80), cost: { tp: 2 }, wait: 0, seal: "weapon",
    cat: "물리 · 적 단일", lines: [`물리 ${adText(pw("AD", 80))}.`, "준 피해만큼 방어도."],
    run: (c, _t, r) => c.shield(c.u, r.dealt),
  }),
  active({
    id: "gd_formation", name: "수비 진형", apt: "수호", req: sub("수호"), slots: 2, tgt: "self", dmgType: "none", cost: { mp: 3 }, wait: 5, cd: 4,
    effects: [{ key: "자동 방어", v: 1, n: 3, to: "self" }], cat: "자신", lines: ["자동 방어 3턴."],
  }),
  active({
    id: "gd_focus", name: "집중 방어", apt: "수호", req: sub("수호"), slots: 2, tgt: "self", dmgType: "none", cost: { mp: 3 }, wait: 5, cd: 3, guards: 2,
    cat: "자신", lines: ["방어 행동 2회.", "\"방어 행동 시\" 효과도 횟수만큼."],
  }),
  passive("gd_mastery", "방어 숙련", "수호", sub("수호"), 2, ["방어 행동 시 TP +1.", "피격 시 TP 추가 +1."], {
    onGuard: (c) => c.tp(c.u, 1),
    onHitTaken: (c) => c.tp(c.u, 1),
  }),
  passive("gd_fortress", "철옹성", "수호", sub("수호"), 3, ["차례 시작 시 방어도 (방어력의 30%)."], {
    turnStart: (c) => c.shield(c.u, Math.round(c.stat(c.u, "def") * 0.3)),
  }),

  // 지휘
  passive("cm_lead", "진두지휘", "지휘", sub("지휘"), 2, ["자신에게 능력치 강화(힘·집중·견고·가속·고양)가 걸리면", "아군 전체도 같은 강화 1턴 (행동당 1번)."], {}, { special: "lead" }),
  passive("cm_tactician", "전략가", "지휘", sub("지휘"), 2, ["자신이 다른 아군에게 강화를 걸면 대상의 남은 대기 −5.", "진두지휘로 퍼진 강화 포함, 대상당 행동당 1번."], {
    onAction: (_c, _a, r) => { for (const t of r.buffed) if (t.alive) t.wait = Math.max(0, t.wait - 5); },
  }),
  active({ id: "cm_atk", name: "공격 태세", apt: "지휘", req: sub("지휘"), slots: 2, tgt: "self", dmgType: "none", cost: { mp: 3 }, wait: 0, cd: 2, effects: [{ key: "힘", v: 25, n: 2, to: "self" }], cat: "강화 · 자신", lines: ["자신은 힘 2턴을 얻는다."] }),
  active({ id: "cm_def", name: "수비 태세", apt: "지휘", req: sub("지휘"), slots: 2, tgt: "self", dmgType: "none", cost: { mp: 3 }, wait: 0, cd: 2, effects: [{ key: "견고", v: 25, n: 2, to: "self" }], cat: "강화 · 자신", lines: ["자신은 견고 2턴을 얻는다."] }),
  active({ id: "cm_spd", name: "기동 태세", apt: "지휘", req: sub("지휘"), slots: 2, tgt: "self", dmgType: "none", cost: { mp: 3 }, wait: 0, cd: 2, effects: [{ key: "가속", v: 25, n: 2, to: "self" }], cat: "강화 · 자신", lines: ["자신은 가속 2턴을 얻는다."] }),
];

// ================= 강습 (기사·전사 공유) =================
const assaultSkills: SkillDef[] = [
  active({ id: "as_finisher", name: "필살의 일격", apt: "강습", req: sub("강습"), slots: 2, tgt: "one", dmgType: "physical", power: pw("AD", 220), cost: { tp: 2 }, wait: 25, cd: 1, seal: "weapon", cat: "물리 · 적 단일", lines: [`물리 ${adText(pw("AD", 220))}.`] }),
  active({ id: "as_cleave", name: "일도양단", apt: "강습", req: sub("강습"), slots: 3, tgt: "one", dmgType: "physical", power: pw("AD", 180), cost: { tp: 1 }, wait: 25, cd: 1, ignoreShield: true, seal: "weapon", cat: "물리 · 적 단일", lines: [`물리 ${adText(pw("AD", 180))}.`, "방어도 무시."] }),
  active({ id: "as_execute", name: "최후의 일격", apt: "강습", req: sub("강습"), slots: 3, tgt: "one", dmgType: "physical", power: pw("AD", 130), cost: { tp: 2 }, wait: 20, cd: 1, special: "execute", seal: "weapon", cat: "물리 · 적 단일", lines: [`물리 ${adText(pw("AD", 130))}.`, "대상 HP 30% 이하면 2배."] }),
  active({ id: "as_ruin", name: "파멸의 일격", apt: "강습", req: sub("강습"), slots: 4, tgt: "all", dmgType: "physical", power: pw("AD", 100), cost: { tp: 3 }, wait: 30, cd: 1, seal: "weapon", cat: "물리 · 적 전체", lines: [`적 전체 물리 ${adText(pw("AD", 100))}.`] }),
  // 2026-11-07: 강습은 TP 직업군 스킬 — 재사용 조건·감소를 TP로 바꿈
  passive("as_momentum", "승기", "강습", sub("강습"), 2, ["적 처치 시 TP +1."], {
    onKill: (c, _t, mine) => { if (mine) c.tp(c.u, 1); },
  }),
  passive("as_vigor", "기세", "강습", sub("강습"), 2, ["TP를 소모하는 스킬을 쓰면 고양 1턴."], {
    onAction: (c, a) => { if (a.cost?.tp) c.addSt(c.u, { key: "고양", v: 10, n: 1 }); },
  }),
  // 난전: 마지막으로 수행한 공격과 다른 공격이면 발동하고, 마지막 공격을 갱신한다. 첫 공격은 비교 대상이 없어 발동하지 않는다.
  passive("as_melee", "난전", "강습", sub("강습"), 2, ["이전에 한 공격과 다른 공격을 하면 그 행동의 대기 −10, TP +1."], {
    turnStart: (c) => { delete c.u.flags.melee; },
    onAction: (c, a, r) => {
      if (!r.attack) return;
      if (c.u.lastAtk && c.u.lastAtk !== a.id) { c.u.flags.melee = 1; c.tp(c.u, 1); }
      c.u.lastAtk = a.id;
    },
    // 행동 뒤(턴 종료 계산)는 발동 표시로, 행동 전(메뉴 미리보기)은 비교로
    waitAdj: (c, a) => (c.u.flags.melee ? -10 : isAttackAct(a) && c.u.lastAtk && c.u.lastAtk !== a.id ? -10 : 0),
  }),
];

/** 육중한 일격 대상: 대기 +20 이상인 공격 스킬 (기본 공격 제외) */
const heavyAct = (a: ActDef) => isAttackAct(a) && a.id !== "attack" && a.wait >= 20;

// ================= 전사 =================
const WR = "전사";
const warriorSkills: SkillDef[] = [
  active({ id: "wr_all", name: "전력 일격", apt: WR, req: job("전사"), slots: 4, tgt: "one", dmgType: "physical", power: pw("AD", 90), cost: { tp: "all" }, wait: 30, seal: "weapon", cat: "물리 · 적 단일 · TP 전량", lines: ["TP를 전부 쓴다.", `물리 TP 1당 ${adText(pw("AD", 90))}.`] }),
  passive("wr_body", "강철 육체", WR, job("전사"), 2, ["최대 HP +15%."], {}, { party: { hpPct: 15 } }),
  passive("wr_instinct", "전투 본능", WR, job("전사"), 2, ["전투 시작 시 TP +1."], { battleStart: (c) => c.tp(c.u, 1) }),
  passive("wr_heavy", "육중한 일격", WR, job("전사"), 2, ["대기가 +20 이상인 공격 스킬 위력 +15%."], {
    dmgPct: (_c, a) => (heavyAct(a) ? 15 : 0),
  }, { refers: heavyAct }),
  passive("wr_spirit", "투혼", WR, job("전사"), 2, ["전투 중 처음 [위기]에 들어가면 TP를 최대치까지 회복하고 고양 2턴.", "전투당 1번."], {
    onHitTaken: (c) => {
      if (c.u.flags.spirit || !isCrisis(c.u)) return;
      c.u.flags.spirit = 1;
      c.tp(c.u, c.u.tpMax);
      c.addSt(c.u, { key: "고양", v: 10, n: 2 });
    },
  }),
  passive("wr_twohand", "양손 숙련", WR, job("전사"), 3, ["양손 무기를 들면 공격 스킬 위력 +10%."], {
    dmgPct: (c, a) => (c.u.twoHanded && isAttackAct(a) && a.id !== "attack" ? 10 : 0),
  }),

  // 야만
  // 2026-11-07: 전투의 함성은 TP를 쓰지 않고 1 얻는다
  active({ id: "bb_cry", name: "전투의 함성", apt: "야만", req: sub("야만"), slots: 2, tgt: "self", dmgType: "none", wait: 0, cd: 2, effects: [{ key: "힘", v: 25, n: 2, to: "self" }], cat: "강화 · 자신", lines: ["힘 2턴.", "TP +1."], run: (c) => c.tp(c.u, 1) }),
  // 광란: 투지 → 야만 (단련과 자리 바꿈), TP 소모 없음
  active({
    id: "gr_frenzy", name: "광란", apt: "야만", req: sub("야만"), slots: 2, tgt: "self", dmgType: "none", wait: -10, cd: 4,
    effects: [{ key: "힘", v: 25, n: 3, to: "self" }, { key: "가속", v: 25, n: 3, to: "self" }, { key: "무방비", v: 1, n: 3, to: "self" }],
    cat: "강화 · 자신", lines: ["힘 3턴, 가속 3턴.", "무방비 3턴."],
  }),
  passive("bb_adrenaline", "아드레날린", "야만", sub("야만"), 2, ["강화 상태가 1개 이상이면 받는 피해 −10%.", "공격·피격으로 얻는 TP가 1에서 2로 늘어난다."], {
    takenPct: (c) => (c.u.st.some((s) => statBuffKeys.includes(s.key) || s.key === "기합") ? -10 : 0),
  }, { special: "adrenaline" }),
  passive("bb_heat", "전장의 열기", "야만", sub("야만"), 2, ["적 처치 관여 시 HP 최대의 8% 회복."], {
    onKill: (c) => { if (c.u.alive) c.heal(c.u, Math.round(c.u.hpMax * 0.08)); },
  }),

  // 투지 (2026-11-07 [위기] 컨셉: 불굴·불요·최후의 저항·죽음의 무도·단련. TP를 쓰지도 얻지도 않음. 출혈 3종은 BLEED_HOLD)
  // 단련: 야만 → 투지. HP·방어력 고정 증가 (수치 잠정 TODO(spec))
  passive("gr_unyielding", "불요", "투지", sub("투지"), 3, ["[위기] 중 정신 이상에 걸리지 않는다.", "[위기] 중 〈기본 공격〉과 공격 스킬에 의한 피해만 입는다."], {}, { special: "unyielding" }),
  passive("gr_laststand", "최후의 저항", "투지", sub("투지"), 2, ["공격 스킬에 잃은 HP의 10%만큼 추가 피해."], {}, { special: "lastStand" }),
  passive("gr_dance", "죽음의 무도", "투지", sub("투지"), 3, ["받는 피해의 30%를 줄이고, 줄인 만큼 [유예]를 얻는다."], {}, { special: "deathDance" }),
  passive("bb_train", "단련", "투지", sub("투지"), 2, ["자신이 자신에게 거는 능력치 강화 +1턴.", "최대 HP +20, 방어력 +5."], {}, { special: "train", party: { hpAdd: 20, defAdd: 5 } }),
  passive("gr_indomitable", "불굴", "투지", sub("투지"), 2, ["[위기] 중 공격력 +20%."], {
    statPct: (c, k) => (k === "atk" && isCrisis(c.u) ? 20 : 0),
  }),
];

// ================= 무기 =================
/** 패링으로 흘렸을 때 공격한 적의 대기 증가 */
export const PARRY_DELAY = 15;
const weaponSkills: SkillDef[] = [
  // 한손검/방패 (2026-11-09): 한손검과 방패를 한 묶음으로 — 마스터리 둘 + 패링 + 도전의 일격 (찌르기·횡베기·연속 베기·철벽·방패 밀치기는 뺐다)
  passive("sw_mastery", "검술 마스터리", "한손검/방패", weapon("한손검"), 2, ["한손검 공격 피해 +15%."], { dmgPct: (c, a) => (usesWeapon(c.u, a, "한손검") ? 15 : 0) }),
  passive("sh_mastery", "방패 마스터리", "한손검/방패", weapon("방패"), 2, ["방패를 들면 방어 행동의 방어도 +20%."], { guardPct: (c) => (c.u.weapons.includes("방패") ? 20 : 0) }),
  active({ id: "sh_parry", name: "패링", apt: "한손검/방패", req: weapon("방패"), weapon: "방패", slots: 2, tgt: "self", dmgType: "none", cost: { mp: 2 }, wait: -10, cd: 3, effects: [{ key: "패링", v: 1, n: T99, to: "self" }], cat: "자신", lines: ["[패링 1]: 다음 단일 대상 공격 1회를 흘린다 (피해 0).", `흘리면 공격한 적의 대기 +${PARRY_DELAY}.`] }),
  active({ id: "sw_challenge", name: "도전의 일격", apt: "한손검/방패", req: weapon("한손검"), weapon: "한손검", slots: 2, tgt: "one", dmgType: "physical", power: pw("AD", 80, "후반"), wait: 0, aggroConst: { n: 300, scope: "target" }, seal: "weapon", cat: "물리 · 적 단일", lines: [`물리 ${adText(pw("AD", 80, "후반"))}.`, "위험도 3을 더 얻는다.", "TP +1."], run: (c) => c.tp(c.u, 1) }),
  // 창 (표준)
  passive("sp_mastery", "창술 마스터리", "창", weapon("창"), 2, ["창 공격 피해 +15%."], { dmgPct: (c, a) => (usesWeapon(c.u, a, "창") ? 15 : 0) }),
  active({ id: "sp_pierce", name: "꿰뚫기", apt: "창", req: weapon("창"), weapon: "창", slots: 2, tgt: "line", dmgType: "physical", power: pw("AD", 90), cost: { mp: 2 }, wait: 0, seal: "weapon", cat: "물리 · 행 관통", lines: [`같은 줄 전·후열 물리 ${adText(pw("AD", 90))}.`] }),
  active({ id: "sp_check", name: "견제 찌르기", apt: "창", req: weapon("창"), weapon: "창", slots: 2, tgt: "one", dmgType: "physical", power: pw("AD", 60), wait: -10, special: "delay10", seal: "weapon", cat: "물리 · 적 단일", lines: [`물리 ${adText(pw("AD", 60))}.`, "대상 대기 +10."] }),
  active({ id: "sp_leap", name: "도약 찌르기", apt: "창", req: weapon("창"), weapon: "창", slots: 2, tgt: "one", dmgType: "physical", power: pw("AD", 120), cost: { mp: 3 }, wait: 10, seal: "weapon", cat: "물리 · 적 단일", lines: [`물리 ${adText(pw("AD", 120))}.`] }),
  // 대검 (표준)
  passive("gs_mastery", "대검 마스터리", "대검", weapon("대검"), 2, ["대검 공격 피해 +15%."], { dmgPct: (c, a) => (usesWeapon(c.u, a, "대검") ? 15 : 0) }),
  active({ id: "gs_slash", name: "대검 베기", apt: "대검", req: weapon("대검"), weapon: "대검", slots: 2, tgt: "one", dmgType: "physical", power: pw("AD", 180), cost: { tp: 3 }, wait: 20, cd: 1, seal: "weapon", cat: "물리 · 적 단일", lines: [`물리 ${adText(pw("AD", 180))}.`] }),
  active({ id: "gs_sweep", name: "휩쓸기", apt: "대검", req: weapon("대검"), weapon: "대검", slots: 3, tgt: "row", dmgType: "physical", power: pw("AD", 70), cost: { mp: 3 }, wait: 15, seal: "weapon", cat: "물리 · 적 전열", lines: [`적 전열 물리 ${adText(pw("AD", 70))}.`] }),
  active({ id: "gs_spirit", name: "기합", apt: "대검", req: weapon("대검"), weapon: "대검", slots: 2, tgt: "self", dmgType: "none", cost: { mp: 2 }, wait: -5, cd: 3, effects: [{ key: "기합", v: 20, n: 3, to: "self" }], cat: "강화 · 자신", lines: ["[기합] 3턴: 공격 위력 +20%."] }),
  // 망치 (초반형)
  passive("hm_mastery", "망치 마스터리", "망치", weapon("망치"), 2, ["망치 공격 피해 +15%."], { dmgPct: (c, a) => (usesWeapon(c.u, a, "망치") ? 15 : 0) }),
  active({ id: "hm_crush", name: "분쇄", apt: "망치", req: weapon("망치"), weapon: "망치", slots: 2, tgt: "one", dmgType: "physical", power: pw("AD", 100, "초반"), cost: { mp: 2 }, wait: 10, shieldMul: 2, effects: [{ key: "손상", v: 25, n: 2 }], seal: "weapon", cat: "물리 · 적 단일", lines: [`물리 ${adText(pw("AD", 100, "초반"))}.`, "방어도에 주는 피해 2배.", "손상 2턴."] }),
  active({ id: "hm_quake", name: "지면 강타", apt: "망치", req: weapon("망치"), weapon: "망치", slots: 3, tgt: "row", dmgType: "physical", power: pw("AD", 60, "초반"), cost: { mp: 3 }, wait: 20, effects: [{ key: "둔화", v: 25, n: 2 }], seal: "weapon", cat: "물리 · 적 전열", lines: [`적 전열 물리 ${adText(pw("AD", 60, "초반"))}.`, "둔화 2턴."] }),
  active({ id: "hm_concuss", name: "뇌진탕", apt: "망치", req: weapon("망치"), weapon: "망치", slots: 3, tgt: "one", dmgType: "physical", power: pw("AD", 90, "초반"), cost: { mp: 4 }, wait: 25, cd: 3, effects: [{ key: "기절", v: 1, n: T99 }], seal: "weapon", cat: "물리 · 적 단일", lines: [`물리 ${adText(pw("AD", 90, "초반"))}.`, "기절."] }),
  // 오브 (2026-11-07): MP를 쓰지 않는 후열 무기. 마스터리 + 유틸. 세 번째 스킬은 미정
  passive("ob_mastery", "오브 마스터리", "오브", weapon("오브"), 2, ["오브를 들면 무속성 마법 피해 +15%."], {
    dmgPct: (c, a) => (c.u.weapons.includes("오브") && a.dmgType === "magic" && !a.element ? 15 : 0),
  }),
  // 마력 구체: MP 없이 쓰는 무속성 공격 (TP 직업도). 재사용으로 묶는다
  active({ id: "ob_sphere", name: "마력 구체", apt: "오브", req: weapon("오브"), weapon: "오브", slots: 2, tgt: "one", dmgType: "magic", power: pw("AP", 120), wait: 10, cd: 2, cat: "마법 · 적 단일", lines: [`무속성 마법 ${apText(pw("AP", 120))}.`] }),
  passive("ob_foresee", "예지", "오브", weapon("오브"), 2, ["탐색 중 다음에 놓을 타일을 2개 미리 본다."], {}, { explore: { foresee: 2 } }), // 2026-11-08: 1 → 2. 공용 코어(다음 1개)와 합쳐 3개
  passive("ob_foresight", "선견", "오브", weapon("오브"), 2, ["대기 행동 시 [선견] 1 (최대 3).", "[선견]이 3이면 다음 공격이 급소에 들어간다: 피해 1.5배, 방어도·피해 감소·회피 무시. 공격하면 [선견]을 모두 소모."], {
    onWait: (c) => c.addSt(c.u, { key: "선견", v: 1, n: T99 }),
  }),
  // 지팡이
  passive("st_save", "마력 절약", "지팡이", weapon("지팡이"), 2, ["마법 스킬과 마력 화살의 MP 소모 −1."], {}, { special: "mpSave" }),
  passive("st_mastery", "지팡이 마스터리", "지팡이", weapon("지팡이"), 2, ["지팡이를 들면 주문력 +10%."], {}, { party: { splPct: 10, needWeapon: "지팡이" } }),
  passive("st_flow", "마나 순환", "마법", sub("마법"), 2, ["마법으로 준 피해의 5%만큼 MP를 회복한다."], {
    onAction: (c, a, r) => { if (a.dmgType === "magic" && r.dealt > 0) c.mp(c.u, Math.min(10, Math.floor(r.dealt * 0.05))); },
  }),
];

// ================= 사제 =================
const PR = "사제";
const priestSkills: SkillDef[] = [
  active({ id: "pr_revive", name: "부활", apt: PR, req: job("사제"), slots: 3, tgt: "dead", dmgType: "none", cost: { mp: 42 }, wait: 20, cd: 5, special: "revive", supportSkill: true, seal: "magic", cat: "전투 불능 아군", lines: ["전투 불능인 아군을 지정한다.", "대상은 최대 HP의 1%로 되살아난다."] }),
  passive("pr_prayer", "기도", PR, job("사제"), 2, ["대기 행동 시 아군 전체가 최대 HP의 3%만큼 회복한다."], {
    onWait: (c) => { let any = 0; for (const a of c.b.allies) if (a.alive) any += c.heal(a, Math.max(1, Math.round(a.hpMax * 0.03))); if (any) c.support(); },
  }),
  active({ id: "pr_grace", name: "가호", apt: PR, req: job("사제"), slots: 2, tgt: "ally", dmgType: "none", cost: { mp: 20 }, wait: 0, cd: 3, effects: [{ key: "가호", v: 1, n: T99 }], supportSkill: true, seal: "magic", cat: "강화 · 아군 단일", lines: ["아군을 지정한다. 대상은 [가호]를 얻는다.", "[가호]: 치명적인 피해를 HP 1로 버틴다 (전투 끝까지, 1회)."] }),
  passive("pr_devotion", "헌신", PR, job("사제"), 2, ["[지원] 시 MP를 2 회복한다 (행동당 1번)."], { onSupport: (c) => c.mp(c.u, 2) }),
  passive("pr_salvation", "구원", PR, job("사제"), 3, ["[지원] 스킬의 MP 비용과 재사용 대기가 50% 줄어든다."], {
    costMul: (_c, a) => ((a as SkillDef).supportSkill ? 0.5 : 1),
  }),
  passive("pr_faith", "신앙", PR, job("사제"), 2, ["자신의 턴이 끝날 때 자신에게 걸린 약화 중 무작위 1개를 제거한다."], {}, { special: "faith" }),
  passive("pr_miracle", "기적", PR, job("사제"), 2, ["자신의 차례가 시작될 때 30% 확률로 [기적].", "[기적]: 다음 [지원] 스킬 1번은 MP 비용·재사용 없음."], {
    turnStart: (c) => { if (!c.has(c.u, "기적") && c.rand() < 0.3) c.addSt(c.u, { key: "기적", v: 1, n: T99 }); },
  }),
  // 치유
  active({ id: "hl_heal", name: "치유", apt: "치유", req: sub("치유"), slots: 2, tgt: "ally", dmgType: "heal", power: pw("AP", 120), cost: { mp: 14 }, wait: 0, supportSkill: true, seal: "magic", cat: "회복 · 아군 단일", lines: [`아군을 지정한다. 대상은 ${apText(pw("AP", 120))}만큼 HP를 회복한다.`] }),
  passive("hl_wave", "치유의 물결", "치유", sub("치유"), 2, ["회복 스킬을 쓰면, 그 행동 뒤 다음 차례까지의 대기가 10 줄어든다."], {
    waitAdj: (_c, a) => (a.dmgType === "heal" && a.id !== "attack" ? -10 : 0),
  }),
  active({ id: "hl_cleanse", name: "정화", apt: "치유", req: sub("치유"), slots: 2, tgt: "ally", dmgType: "none", cost: { mp: 12 }, wait: -5, cleanseN: 1, supportSkill: true, seal: "magic", cat: "아군 단일", lines: ["아군을 지정한다. 대상에게 걸린 상태이상을 1개 골라 제거한다."] }),
  passive("hl_mastery", "치유 숙련", "치유", sub("치유"), 2, ["회복량이 15% 증가한다."], { healPct: () => 15 }),
  // 축복
  active({ id: "bl_shield", name: "성스러운 방패", apt: "축복", req: sub("축복"), slots: 2, tgt: "ally", dmgType: "shield", power: pw("AP", 100), cost: { mp: 14 }, wait: 0, supportSkill: true, seal: "magic", cat: "방어도 · 아군 단일", lines: [`아군을 지정한다. 대상은 ${apText(pw("AP", 100))}만큼 방어도를 얻는다.`] }),
  active({ id: "bl_ward", name: "예방의 축문", apt: "축복", req: sub("축복"), slots: 2, tgt: "ally", dmgType: "none", cost: { mp: 17 }, wait: 0, effects: [{ key: "예방의 축문", v: 1, n: 3 }], special: "chant", supportSkill: true, seal: "magic", cat: "강화 · 아군 단일", lines: ["아군을 지정한다. 대상은 [예방의 축문] 3턴을 얻는다.", "[예방의 축문]: 다음에 걸리는 상태이상 1번을 막는다."] }),
  active({ id: "bl_guard", name: "수호의 축문", apt: "축복", req: sub("축복"), slots: 3, tgt: "allyAll", dmgType: "none", cost: { mp: 30 }, wait: 15, cd: 4, special: "guardChant", supportSkill: true, seal: "magic", cat: "강화 · 아군 전체", lines: ["아군 전체가 [수호의 축문] 3턴을 얻는다.", `[수호의 축문]: 차례 시작 시 ${apText(pw("AP", 30))}만큼 방어도.`] }),
  passive("bl_prayer", "축문 강화", "축복", sub("축복"), 2, ["축문 스킬이 거는 상태의 지속 턴이 1 늘어난다."], {}, { special: "chantPlus" }),
  // 빛
  active({ id: "lt_judge", name: "빛의 심판", apt: "빛", req: elem("white"), slots: 2, tgt: "one", dmgType: "magic", element: "white", power: pw("AP", 100), cost: { mp: 12 }, wait: 0, seal: "magic", cat: "마법 · 빛 · 적 단일", lines: [`적을 지정한다. 대상에게 ${apText(pw("AP", 100))}만큼 빛 속성 마법 피해.`] }),
  active({ id: "lt_flash", name: "섬광 폭발", apt: "빛", req: elem("white"), slots: 3, tgt: "all", dmgType: "magic", element: "white", power: pw("AP", 60), cost: { mp: 22 }, wait: 15, cd: 3, effects: [{ key: "암흑", v: 1, n: T99 }], seal: "magic", cat: "마법 · 빛 · 적 전체", lines: [`적 전체에 ${apText(pw("AP", 60))}만큼 빛 속성 마법 피해.`, "암흑."] }),
  passive("lt_radiance", "광휘", "빛", elem("white"), 2, ["빛 속성 마법 피해가 15% 증가한다."], { dmgPct: (_c, a) => (a.dmgType === "magic" && a.element === "white" ? 15 : 0) }),
  // 2026-11-08: 등불(시야 +1 패시브) 대신 라이트. 탐색 중 쓰는 사용형 — 패시브 목록에 들어가 탐색 메뉴에서 누른다 (d01 flyRows).
  passive("lt_light", "라이트", "빛", elem("white"), 1, ["탐색 중 깔린 길 한 칸을 골라 주변 3칸을 밝힌다.", "MP 5. 다음 타일을 놓으면 빛이 꺼진다."], {}, { explore: { light: { radius: 3, mp: 5 } } }),
];

// ================= 마법사 =================
const MG = "마법사";
const ARROW_POWER = pw("AP", 100, "화살");
const magicArrow: ActDef = {
  id: "attack", name: "마력 화살", tgt: "one", dmgType: "magic", power: ARROW_POWER, wait: 10, seal: "magic", cost: { mp: 2 },
  cat: "마법 · 적 단일 (기본 공격)", desc: [`주문력 기반 기본 공격 ${apText(ARROW_POWER)}.`, "TP +1. 대기 +10. MP 2."],
};
const mageSkills: SkillDef[] = [
  passive("mg_arrow", "마력 화살", "지팡이", weapon("지팡이"), 2, ["기본 공격이 공격력 대신 주문력으로 공격하는 마력 화살이 된다:", `${apText(ARROW_POWER)}만큼 무속성 마법 피해. 대기 +10, MP 2.`], {}, { basic: magicArrow }),
  passive("mg_meditate", "명상", "마법", sub("마법"), 2, ["대기 행동 시 잃은 MP의 10%를 회복하고, 집중 2턴."], {
    onWait: (c) => { c.mp(c.u, Math.round((c.u.mpMax - c.u.mp) * 0.1)); c.addSt(c.u, { key: "집중", v: 25, n: 2 }); },
  }),
  // 원소 공격 4종 (2026-11-07): [원소] 적성보다 약하지만 싸고 빨라 기본 공격처럼 쓴다. 쓰면 그 원소 스택이 쌓인다 (마법사 특성, engine elem)
  ...([["red", "화염탄", "불꽃"], ["blue", "냉기탄", "얼음"], ["green", "질풍탄", "바람"], ["yellow", "전격탄", "번개"]] as const).map(([el, name, lab]) =>
    active({ id: `mg_shot_${el}`, name, apt: MG, req: job("마법사"), slots: 2, tgt: "one", dmgType: "magic", element: el, power: pw("AP", 70), cost: { mp: 5 }, wait: 0, seal: "magic", cat: `마법 · ${lab} · 적 단일`, lines: [`${lab} 마법 ${apText(pw("AP", 70))}.`, `${lab} 스택 +1.`] }),
  ),
  // 원소 방출: 스택을 모두 소모하는 큰 한 방. 가장 많이 쌓인 원소 속성이고 스택 보너스를 그대로 받는다
  active({
    id: "mg_release", name: "원소 방출", apt: MG, req: job("마법사"), slots: 3, tgt: "one", dmgType: "magic", power: pw("AP", 200), cost: { mp: 12 }, wait: 25, special: "release", seal: "magic",
    cat: "마법 · 적 단일", lines: [`가장 많이 쌓인 원소 속성으로 마법 ${apText(pw("AP", 200))}.`, "4원소가 하나씩 다 있으면 프리즘: 마법 (160 + 주문력 320%), 4원소 성질, 상성 계산 없음.", "원소 스택을 모두 소모한다."],
    pre: (c) => (c.u.elem?.length ? null : "원소 스택이 없다"),
  }),
  passive("mg_elemental", "엘리멘탈 마스터리", MG, job("마법사"), 2, ["원소 속성(불꽃·얼음·바람·번개) 마법 피해 +15%."], {
    dmgPct: (_c, a) => (a.dmgType === "magic" && (a.elemAll || (a.element && ["red", "blue", "green", "yellow"].includes(a.element))) ? 15 : 0),
  }),
  passive("mg_affinity", "원소 친화", MG, job("마법사"), 2, ["적의 약점 속성으로 공격하면 위력 +20%."], {
    dmgPct: (_c, a, t) => { const s = a.element ? t.affinity?.[a.element] : undefined; return typeof s === "number" && s < 0 ? 20 : 0; },
  }),
  active({ id: "mg_burn", name: "마력 연소", apt: "지팡이", req: weapon("지팡이"), weapon: "지팡이", slots: 4, tgt: "one", dmgType: "magic", power: { pct: 0, flat: 0 }, cost: { mp: "all" }, wait: 35, special: "mpBurn", seal: "magic", cat: "마법 · 적 단일 · MP 전량", lines: ["남은 MP를 전부 쓴다.", "대상에게 소모한 MP의 2배만큼 무속성 마법 피해 (주문력과 무관)."] }),
  passive("mg_tank", "마력 탱크", "마법", sub("마법"), 2, ["최대 MP가 주문력의 30%만큼 증가한다."], {}, { party: { mpSplPct: 30 } }),
  active({ id: "mg_overload", name: "과충전", apt: "마법", req: sub("마법"), slots: 3, tgt: "self", dmgType: "none", wait: 0, special: "overload", cat: "토글 · 자신", lines: ["[과충전]을 켜거나 끈다.", "[과충전]: 공격 스킬의 MP 소모 ×2, 위력 ×1.5."] }),
  // 원소
  active({ id: "el_fire", name: "화염구", apt: "원소", req: elem("red"), slots: 3, tgt: "cross", dmgType: "magic", element: "red", power: pw("AP", 130), cost: { mp: 20 }, wait: 25, seal: "magic", cat: "마법 · 불꽃 · 십자", lines: [`대상과 그 십자 범위에 ${apText(pw("AP", 130))}만큼 불꽃 속성 마법 피해.`] }),
  active({ id: "el_ice", name: "눈보라", apt: "원소", req: elem("blue"), slots: 3, tgt: "col", dmgType: "magic", element: "blue", power: pw("AP", 90), cost: { mp: 24 }, wait: 20, cd: 3, seal: "magic", cat: "마법 · 얼음 · 적 1열", lines: [`적 1열에 ${apText(pw("AP", 90))}만큼 얼음 속성 마법 피해.`] }),
  active({ id: "el_wind", name: "칼바람", apt: "원소", req: elem("green"), slots: 2, tgt: "line", dmgType: "magic", element: "green", power: pw("AP", 100), cost: { mp: 14 }, wait: 0, seal: "magic", cat: "마법 · 바람 · 행 관통", lines: [`같은 줄 전·후열에 ${apText(pw("AP", 100))}만큼 바람 속성 마법 피해.`] }),
  active({ id: "el_bolt", name: "번개", apt: "원소", req: elem("yellow"), slots: 2, tgt: "one", dmgType: "magic", element: "yellow", power: pw("AP", 80), cost: { mp: 10 }, wait: -15, seal: "magic", cat: "마법 · 번개 · 적 단일", lines: [`적을 지정한다. 대상에게 ${apText(pw("AP", 80))}만큼 번개 속성 마법 피해.`] }),
  // 비전 (후반형)
  active({ id: "ar_echo", name: "비전 메아리", apt: "비전", req: sub("비전"), slots: 3, tgt: "self", dmgType: "none", cost: { mp: 17 }, wait: 0, cd: 5, effects: [{ key: "메아리", v: 1, n: T99, to: "self" }], seal: "magic", cat: "강화 · 자신", lines: ["[메아리]: 다음에 마법을 쓰면 같은 마법을 같은 대상에게 비용 소모 없이 한 번 더 쓴다."] }),
  active({ id: "ar_storm", name: "비전 폭풍", apt: "비전", req: sub("비전"), slots: 3, tgt: "all", dmgType: "magic", power: pw("AP", 10, "후반"), hits: 5, cost: { mp: 22 }, wait: 20, cd: 3, seal: "magic", cat: "마법 · 적 전체 · 5회", lines: [`적 전체에 ${apText(pw("AP", 10, "후반"))}만큼 무속성 마법 피해를 5번.`] }),
  passive("ar_rift", "비전 균열", "비전", sub("비전"), 2, ["마법 공격이 적중하면 대상에게 [균열] 1 (타격마다).", "[균열]: 공격을 받을 때마다 스택 × 2 고정 피해. 턴마다 1 감소."], {
    onHitDealt: (c, t, a) => { if (a.dmgType === "magic" && t.alive) c.addSt(t, { key: "균열", v: 1, n: 3 }); },
  }),
  // 학자
  passive("sc_analysis", "심층 분석", "학자", sub("학자"), 2, ["전투로 얻는 도감 정보 +25% (도감 정보 규칙 TODO(spec))."]),
  // 속성학: 4원소 내성 단계 +1 (속성 상성, 단계 1/2/3. engine/party allyAffinity)
  passive("sc_elements", "속성학", "학자", sub("학자"), 2, ["불꽃·얼음·바람·번개 내성 +1단계."], {}, { special: "elemResist" }),
  passive("sc_insight", "통찰", "학자", sub("학자"), 2, ["전투가 시작될 때 적 전체의 약점 속성을 공개한다."], {}, { special: "insight" }),
  passive("sc_study", "이해", "학자", sub("학자"), 1, ["얻는 경험치가 10% 증가한다."], {}, { explore: { expPct: 10 } }),
];

/** 전체 스킬북. 순서 = 코어 도감 순서. */
/** 보관: 출혈 시너지 3종 (2026-11-07 투지에서 뺌). 다른 적성으로 분류해 출혈 쪽 직업에 붙일 예정. SKILL_BOOK에는 넣지 않는다. */
export const BLEED_HOLD: SkillDef[] = [
  passive("gr_bleed", "유혈", "출혈", sub("출혈"), 2, ["공격으로 피해를 준 적에게 출혈 (턴마다 피해, TP 회복 불가, 정화 전까지)."], {
    onHitDealt: (c, t, _a, dealt) => { if (dealt > 0 && t.alive) c.addSt(t, { key: "출혈", v: Math.max(1, Math.round(t.hpMax * 0.05)), n: T99 }); },
  }),
  passive("gr_wound", "상처 베기", "출혈", sub("출혈"), 2, ["출혈 상태인 적을 공격하면 그 행동의 대기 −5."], {}, { special: "wound" }),
  passive("gr_drain", "생기 흡수", "출혈", sub("출혈"), 2, ["출혈 상태인 적을 공격하면 흡혈 10%."], {
    onHitDealt: (c, t, _a, dealt) => { if (dealt > 0 && t.st.some((s) => s.key === "출혈")) c.heal(c.u, Math.floor(dealt * 0.1)); },
  }),
];
export const SKILL_BOOK: SkillDef[] = [...knightSkills, ...assaultSkills, ...warriorSkills, ...weaponSkills, ...priestSkills, ...mageSkills];
export const skillById = (id: string) => SKILL_BOOK.find((s) => s.id === id);

/** 적성 → 표시 색 (코어 조각 색). render/primitives PIECE 키. */
export const APT_COLOR: Record<string, string> = {
  "기사": "amber", 수호: "steel", 지휘: "green", 강습: "red",
  "전사": "crimson", 야만: "amber", 투지: "purple",
  한손검: "blue", 방패: "steel", 창: "green", 대검: "blue", 망치: "purple", 지팡이: "amber", 오브: "blue",
  "사제": "purple", 치유: "green", 축복: "amber", 빛: "steel",
  "마법사": "blue", 마법: "steel", 원소: "red", 비전: "purple", 학자: "green",
};
