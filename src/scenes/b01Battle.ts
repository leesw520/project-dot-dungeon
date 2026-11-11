// B01 전투 v2 (2026-11-01). 진실의 원천: docs/battle-ui.md.
// 로직은 src/engine/battle.ts (docs/battle-rules.md). 이 파일은 그리기와 입력만 맡는다.
// 목업의 R/T/sbar/corners/box 호출 모양을 그대로 옮겨서 좌표를 나란히 비교할 수 있게 했다.
import { ATTACK, DEFAULT_FORM, FLEE, FORMS, GUARD, STAT_BAR_MAX, STATUS, SWAP, WAIT, type ActDef, type FormSlot, type StatusKey } from "../data/battle";
import { ITEM_USE } from "../data/itemUse";
import { PIECES } from "../data/pieces";
import { bagCounts, consumeBagItem } from "./b03Loot";
import { displayRow, slotOf } from "../data/formation";
import { ELEMENT_DEFS } from "../data/itemTaxonomy";
import { createFx, fxOf, type FxKind } from "../render/effects";
import {
  actualWait, advance, createBattle, endTurn, execAlly, execFoe, foeCardOrder, guardValue, intentDamage, label, order, outcome,
  danger, DANGER, previewDanger, previewDamage, previewHeal, targetChances, previewHpLoss, statusOf, statusPanel, targetSets, turnStart, usable,
  battleStart, cleansable, mpCost, ELEM_STACK_MAX, ELEM_STACK_PCT, dominantElem, isPrism,
  type Battle, type BattleEvent, type Unit,
} from "../engine/battle";
import { partyLv, settleBattle } from "../engine/battleResult";
import { goTo } from "../engine/nav";
import { battleBg, inEncounter, reportEncounter, takeEncounter } from "../engine/encounter";
import { loadVitals, saveVitals } from "../engine/partyVitals";
import { cached } from "../render/layerCache";
import { C, R, T, W, pen, textWidth, img, gauge, imgReady } from "../render/primitives";
import { charArt } from "../data/charArt";
import { monsterArt } from "../data/monsterArt";
import { createEndOverlay } from "./b01EndOverlay";
import type { LogicalPoint, Scene } from "./types";

// ===== 그리기 보조 (목업 45~67행) =====
/** 설명 창 폭(136px)에 맞춰 글자 단위로 줄을 나눈다. */
function wrapDesc(lines: string[], maxW = 136): string[] {
  const out: string[] = [];
  for (const l of lines) {
    let cur = "";
    for (const ch of l) {
      if (cur && textWidth(cur + ch, 7) > maxW) { out.push(cur); cur = ch.trim() ? ch : ""; }
      else cur += ch;
    }
    if (cur) out.push(cur);
  }
  return out;
}
const tw = (s: string | number, sz = 7) => Math.ceil(textWidth(String(s), sz));
function box(x: number, y: number, w: number, h: number, col: string, t = 1) {
  R(x, y, w, t, col); R(x, y + h - t, w, t, col); R(x, y, t, h, col); R(x + w - t, y, t, h, col);
}
function corners(x: number, y: number, w: number, h: number, col: string) {
  const L = 5;
  ([[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const).forEach(([cx, cy, dx, dy]) => {
    R(dx > 0 ? cx : cx - L, dy > 0 ? cy : cy - 2, L, 2, col);
    R(dx > 0 ? cx : cx - 2, dy > 0 ? cy : cy - L, 2, L, col);
  });
}
function btn(x: number, y: number, w: number, s: string, hl: boolean, off: boolean) {
  R(x, y, w, 14, C.woodD);
  R(x + 1, y + 1, w - 2, 12, hl ? C.gold : C.woodL);
  T(x + w / 2, y + 10, s, 8, off ? C.cellExt : C.woodD, "middle");
}
/**
 * 기울어진 분할 막대 (battle-ui.md 4.4). fills = [[비율, 색], ...] 오름차순.
 * 줄마다 1px 사각형이라 막대 하나가 수십 번 칠하기다. 픽셀로 반올림한 경계가 같으면 그림도 같으므로
 * 그 값을 key로 오프스크린에 한 번만 그려 두고 붙인다 (layerCache).
 */
/** HP·TP·MP 막대 (2026-11-08: 칸 단위 대신 고해상도 도트 게이지, render/primitives gauge). n은 옛 칸 수 — 쓰지 않는다 */
function sbar(x: number, y: number, L: number, h: number, _n: number, fills: [number, string][], empty?: string) {
  gauge(x, y, L, h, fills, empty || C.cell);
}
const ST_COL = { buff: C.good, debuff: C.hp, ctrl: C.statusCtrl };
/** 상태 아이콘 9×9 (battle-ui.md 4.6). 지금은 첫 글자, 소스가 오면 교체 */
function statusIcon(x: number, y: number, key: StatusKey, line?: string) {
  const col = ST_COL[STATUS[key].t];
  R(x, y, 9, 9, line ?? col); R(x + 1, y + 1, 7, 7, C.dark);
  T(x + 4.5, y + 7, key[0], 6, col, "middle");
}
/** 가운데 기준 능력치 막대: 강화는 오른쪽 good, 약화는 왼쪽 hp */
function statBar(x: number, y: number, L: number, net: number) {
  const half = (L - 1) / 2, mid = x + half, n = net && Math.max(1, Math.round(Math.min(1, Math.abs(net) / STAT_BAR_MAX) * half));
  R(x, y, L, 5, C.cell);
  if (net > 0) R(mid + 1, y, n, 5, C.good);
  if (net < 0) R(mid - n, y, n, 5, C.hp);
  R(mid, y - 1, 1, 7, C.txt);
}

// ===== 무대 좌표 (battle-ui.md 4.5) =====
const TOP = 48, CELL = 56; // 2026-11-09: 전투 배경 바닥에 맞춰 아래로 (옛 34·62 — 맨 아래 줄 발 위치는 거의 그대로)
const feetY = (k: number) => TOP + k * CELL + 52;
const ALLY_X = { f: 172, b: 100 }, FOE_X = { f: 308, b: 384 }, FOE_MID = 346;
/** 전투 배경 투명도 (검은 바탕 위) */
const BG_ALPHA = 0.6;
/** 배경 그림이 다 불러와졌는지 — 캐시 키에 넣어, 불러온 뒤 한 번 다시 굽는다 */
const bgReady = () => imgReady(`${import.meta.env.BASE_URL}backgrounds/battle_${battleBg()}.webp`);
/** 몬스터 스프라이트 그리는 크기 (차지 칸 수 → 정사각 한 변) */
const FOE_ART: Record<number, number> = { 1: 48, 2: 72, 3: 104, 6: 150 };
/** 아군 카드 폭 (2026-11-08: 초상화 28×28을 넣느라 46 → 60) */
const CARD_W = 60;
const SPR: Record<number, [number, number]> = { 1: [36, 38], 2: [50, 84], 3: [64, 140], 6: [150, 150] };
interface Box { cx: number; x: number; y: number; w: number; h: number; fy: number }

function layoutFoes(b: Battle): Record<string, Box> {
  const out: Record<string, Box> = {};
  // 한 열뿐이거나 보스면 적진 가운데 한 줄. 열마다 차지 칸 합으로 세로 가운데 정렬
  const single = b.foes.some((f) => f.type!.size === 6) || new Set(b.foes.map((f) => f.col)).size === 1;
  (["f", "b"] as const).forEach((c) => {
    const list = b.foes.filter((f) => f.col === c);
    let acc = (3 - list.reduce((a, f) => a + Math.min(3, f.type!.size), 0)) / 2;
    list.forEach((f) => {
      const size = f.type!.size, span = Math.min(3, size), top = TOP + acc * CELL, [w, h] = SPR[size];
      acc += span;
      const cx = single ? FOE_MID : FOE_X[c], fy = Math.round(top + span * CELL - 10);
      out[f.id] = { cx, x: Math.round(cx - w / 2), y: fy - h, w, h, fy };
    });
  });
  return out;
}

// ===== 커맨드 (battle-ui.md 4.9) =====
type Entry = { n: string; act?: ActDef; sub?: "skill" | "item"; d?: string[] };
const CMDS: Entry[] = [
  { n: "공격", act: ATTACK },
  { n: "스킬", sub: "skill", d: ["스킬", "배운 스킬을 고른다."] },
  { n: "방어", act: GUARD },
  { n: "아이템", sub: "item", d: ["아이템", "소지품을 사용한다."] },
  { n: "대기", act: WAIT },
  { n: "교대", act: SWAP },
  { n: "도주", act: FLEE },
];
type Mode = "cmd" | "skill" | "item" | "target" | "cleanse" | "busy" | "end";

const TL = { x: 136, w: 208, cardW: 18, cardH: 21, pitch: 21 };
const TL_MAX = Math.floor((TL.w - 12 + 3) / TL.pitch); // 9장

type Hit = [number, number, number, number, string, string | undefined];

export function createB01Scene(): Scene {
  // 주소 # 뒤 테스트 스위치: form=편성 이름, drop=all 확정 드롭 (engine/battleResult.ts), st=demo 상태 창 시험용 상태
  // 페이지를 새로 읽지 않고 # 뒤만 바꿔도 다음 전투부터 적용되도록 그때그때 읽는다.
  const hashArg = (k: string) => new URLSearchParams(location.hash.slice(1)).get(k);
  let b: Battle;
  let boxes: Record<string, Box>;
  const S = { mode: "busy" as Mode, cur: 0, scroll: 0, act: null as ActDef | null, from: "cmd" as "cmd" | "skill" | "item", tIdx: 0, msg: "" };
  /** 정화 선택 창 (classes.md 정화): 대상 아군과 고른 상태이상 */
  const CL = { target: null as Unit | null, picked: [] as StatusKey[] };
  let turnActive = false;
  let over = "";
  let hits: Hit[] = [];
  let noHit = false;
  let queue: { at: number; fn: () => void }[] = [];
  let clock = 0;
  // 연출 상태
  const tlX = new Map<string, number>();
  let tlMoving = false; // 타임라인 카드가 아직 미끄러지는 중
  /** 스킬 이펙트 (render/effects) */
  const fx = createFx();
  let popups: { id: string; text: string; col: string; size: number; t: number; dy: number }[] = [];
  const flash = new Map<string, { from: number; t: number }>();
  const shake = new Map<string, number>();
  let blink: { id: string; t: number } | null = null;
  const stPos = new Map<string, [number, number]>();
  /** 승리 후 B02로 넘어갔으면, 다시 B01에 들어올 때 새 전투를 시작한다. */
  let leftForResult = false;
  const endFx = createEndOverlay((a) => {
    if (a === "result") { leftForResult = true; goTo("b02"); }
    // 탐색 전투에서 지면 D01로 (D01이 원정 소재를 잃게 처리). TODO(spec): 패배 → B04
    else if (fromExplore) { fromExplore = false; leftForResult = true; goTo("d01"); }
    else start();
  }, () => (fromExplore ? "탐색으로" : "다시 도전"));
  /** 지금 전투가 D01 적 심볼에서 온 것인가 */
  let fromExplore = false;

  const later = (ms: number, fn: () => void) => queue.push({ at: clock + ms, fn });
  const hit = (x: number, y: number, w: number, h: number, key: string, click?: string) => { if (!noHit) hits.push([x, y, w, h, key, click]); };
  const unit = (id: string) => b.units.find((u) => u.id === id);
  const actor = () => (b.cur && b.cur.side === "ally" ? b.cur : null);
  const inputMode = () => S.mode === "cmd" || S.mode === "skill" || S.mode === "item" || S.mode === "target" || S.mode === "cleanse";
  /** 이 아군의 커맨드 행. 공격은 기본 공격(마력 화살 등으로 바뀔 수 있다). */
  // 기본 공격 대체(마력 화살)는 MP가 모자라면 일반 〈기본 공격〉으로 (2026-11-07)
  const cmdAct = (c: Entry): ActDef | undefined => {
    if (c.act !== ATTACK) return c.act;
    const u = actor(), alt = u?.basic;
    return alt && alt !== ATTACK && u && mpCost(u, alt) > u.mp ? ATTACK : alt ?? ATTACK;
  };

  function spr(u: Unit): Box {
    if (u.side === "foe") return boxes[u.id];
    // 2:2(가운데 줄 비어 있음)면 위·아래 두 줄을 가운데로 모아 그린다 (data/formation.ts displayRow).
    const cx = u.slot < 3 ? ALLY_X.f : ALLY_X.b, fy = feetY(displayRow(u.slot)), w = 36, h = 46;
    return { cx, x: cx - w / 2, y: fy - h, w, h, fy };
  }

  function start(explore?: FormSlot[]) {
    const formArg = hashArg("form");
    fromExplore = !!explore;
    b = createBattle(explore ?? (formArg && FORMS[formArg] ? formArg : DEFAULT_FORM), partyLv);
    if (explore) loadVitals(b.allies); // 탐색 전투는 원정 중 HP·MP로 시작
    // 전투 아이템 = 원정 가방에 든 사용 아이템 (2026-11-08). 탭으로 바로 연 테스트 전투는 회복약 몇 개.
    const counts = explore ? bagCounts() : { "c:HP 회복약": 3, "c:MP 회복약": 2 };
    b.bag = Object.fromEntries(Object.keys(ITEM_USE).map((id) => [id, counts[id] ?? 0]));
    endFx.reset();
    leftForResult = false;
    boxes = layoutFoes(b);
    if (import.meta.env.DEV && hashArg("st") === "demo") demoStatus();
    Object.assign(S, { mode: "busy", cur: 0, scroll: 0, act: null, from: "cmd", tIdx: 0, msg: "전투 시작!" });
    turnActive = false;
    queue = []; popups = []; flash.clear(); shake.clear(); tlX.clear(); blink = null;
    later(250, () => showEvents(battleStart(b)));
    later(500, nextTurn);
  }

  /** 개발용: 상태 창 세 구역이 다 보이게 기사와 첫 번째 적에 상태를 붙인다. 힘·탈진은 상쇄, 공포는 유닛 수정값으로 라인을 늘린 예 */
  function demoStatus() {
    const put = (u: Unit, list: [StatusKey, number][]) => (u.st = list.map(([key, v]) => ({ key, v, n: 9 })));
    put(b.allies[0], [["힘", 3], ["탈진", 1], ["둔화", 3], ["고양", 2], ["독", 4], ["혼란", 3], ["방어도", 40], ["침묵", 0], ["속박", 0]]);
    put(b.foes[0], [["위축", 2], ["견고", 3], ["화상", 6], ["공포", 2], ["무장해제", 0]]);
    b.foes[0].triggerMods = { 공포: 2 };
  }

  // ===== 진행 (battle-rules.md 3장) =====
  function showEvents(evs: BattleEvent[], kind?: FxKind | null) {
    let fxDelay = 0;
    evs.forEach((e, i) => {
      if (e.kind === "dmg" && kind) {
        const u = unit(e.id);
        if (u) { const s = spr(u); fx.spawn(kind, s.cx, s.fy, fxDelay); fxDelay += 60; }
      }
      if (e.kind === "dmg") {
        popups.push({ id: e.id, text: String(e.amount), col: C.txt, size: 8, t: -i * 120, dy: 0 });
        if (e.hpBefore != null && e.amount > 0) flash.set(e.id, { from: e.hpBefore, t: 0 });
        shake.set(e.id, 0);
      } else if (e.kind === "heal") popups.push({ id: e.id, text: `+${e.amount}`, col: C.good, size: 8, t: -i * 120, dy: 0 });
      else if (e.kind === "miss") popups.push({ id: e.id, text: e.text ?? "빗나감", col: C.sub, size: 7, t: -i * 120, dy: 0 });
      else if (e.text) popups.push({ id: e.id, text: e.text, col: C.aura, size: 7, t: -i * 120, dy: 0 });
    });
  }

  function nextTurn() {
    const res = outcome(b);
    if (res) {
      S.mode = "end";
      turnActive = false;
      S.msg = res === "win" ? "승리!" : "전멸했다…";
      over = "";
      const r = settleBattle(b, res, { forceDrops: import.meta.env.DEV && hashArg("drop") === "all" });
      if (fromExplore && inEncounter()) {
        saveVitals(b.allies);
        reportEncounter(res);
      }
      later(450, () => endFx.start(res, { defeated: r.defeated.length, exp: r.expTotal, drops: r.drops.length }));
      return;
    }
    const u = advance(b);
    const evs: BattleEvent[] = [];
    const canAct = turnStart(b, u, evs);
    showEvents(evs);
    turnActive = true;
    if (!canAct) {
      S.mode = "busy";
      S.msg = u.alive ? `${label(u)}은(는) 움직일 수 없다.` : "";
      later(evs.length ? 700 : 500, () => { turnActive = false; nextTurn(); });
      return;
    }
    if (u.side === "ally") {
      Object.assign(S, { mode: "cmd", cur: 0, scroll: 0, act: null, msg: "" });
      return;
    }
    // 적 차례: TODO(spec) 적 차례 하단 구성 미정. 지금은 설명 창에 행동 이름만.
    S.mode = "busy";
    S.msg = `${label(u)}의 차례`;
    const it = u.intent!;
    const tgt = ["one", "multi", "aim", "debuff"].includes(it.k) ? unit(it.tgt ?? "") ?? null : null; // 대상은 의도를 정할 때 위험도로 골라 둔다
    later(350, () => {
      if (tgt) blink = { id: tgt.id, t: 0 }; // 실행 직전 노린 아군에 hp 괄호 0.3초 깜빡임
      S.msg = `${label(u)}의 ${INTENT_NAME[it.k]}!`;
    });
    later(tgt ? 700 : 450, () => {
      const ev: BattleEvent[] = [];
      execFoe(b, u, ev);
      showEvents(ev, "hit");
    });
    later(tgt ? 1400 : 1150, () => {
      endTurn(b, u, null);
      turnActive = false;
      nextTurn();
    });
  }

  function execute(a: ActDef, targets: Unit[], cleanseKeys?: StatusKey[]) {
    const u = actor()!;
    S.mode = "busy";
    S.msg = `${u.name}의 ${a.name}!`;
    const ev: BattleEvent[] = [];
    // 이펙트 종류는 실행 전에 정한다 (원소 방출은 실행하면서 스택을 소모한다)
    const kind = a.special === "release" ? (isPrism(u) ? "prism" : fxOf({ dmgType: "magic", element: dominantElem(u) })) : fxOf(a);
    execAlly(b, u, a, targets, ev, { cleanseKeys });
    if (a.item && fromExplore) consumeBagItem(a.item); // 쓴 아이템은 원정 가방에서도 빠진다
    showEvents(ev, kind);
    later(750, () => {
      endTurn(b, u, a);
      turnActive = false;
      nextTurn();
    });
  }

  /** 전투 아이템 행동: 사용 효과가 있는 아이템(data/itemUse.ts)마다 하나. 개수는 b.bag (원정 가방). */
  function itemActs(): ActDef[] {
    return Object.entries(ITEM_USE)
      .filter(([id, u]) => PIECES[id] && u.stat) // 식품(체류)은 전투에서 못 쓴다
      .map(([id, u]): ActDef => u.stat === "hp"
        ? { id: `item:${id}`, name: PIECES[id].name, item: id, tgt: "ally", dmgType: "heal", power: { pct: 0, flat: u.amount ?? 0 }, wait: 12, cat: "아군 단일", desc: [`HP를 ${u.amount} 회복한다.`] }
        : { id: `item:${id}`, name: PIECES[id].name, item: id, tgt: "ally", dmgType: "none", special: "itemMp", power: { pct: 0, flat: u.amount ?? 0 }, wait: 12, cat: "아군 단일", desc: [`MP를 ${u.amount} 회복한다.`] });
  }

  // ===== 미리보기 =====
  function listOf(kind: "skill" | "item"): ActDef[] {
    return kind === "skill" ? actor()?.skills ?? [] : itemActs();
  }
  /** 커서가 가리키는 항목. null = 뒤로 행 */
  function curEntry(): Entry | null {
    if (S.mode === "cmd") { const c = CMDS[S.cur]; return c.act ? { ...c, act: cmdAct(c) } : c; }
    if (S.mode === "skill" || S.mode === "item") { const a = listOf(S.mode)[S.cur - 1]; return a ? { n: a.name, act: a } : null; }
    if ((S.mode === "target" || S.mode === "cleanse") && S.act) return { n: S.act.name, act: S.act };
    return null;
  }
  function ghostWait(): number | null {
    const u = actor(), e = curEntry();
    if (!u || !e?.act || !inputMode() || !usable(b, u, e.act).ok) return null;
    return actualWait(u, e.act, false);
  }
  const chosen = (): Unit[] => (S.mode === "target" && S.act && actor() ? targetSets(b, actor()!, S.act)[S.tIdx] ?? [] : []);

  // ===== 타임라인 (4.1) =====
  function timeCard(u: Unit, w: number, x: number, y: number, mode: "" | "cur" | "ghost" | "hl") {
    const ally = u.side === "ally";
    R(x, y, TL.cardW, TL.cardH, mode ? C.gold : ally ? u.color : C.foe);
    if (mode === "cur") box(x - 1, y - 1, TL.cardW + 2, TL.cardH + 2, C.gold);
    R(x + 1, y + 1, TL.cardW - 2, TL.cardH - 2, mode === "ghost" ? C.listRowSel : C.screenBg);
    const mini = ally ? charArt(u.name, "mini") : u.type ? monsterArt(u.type.id, "mini") : null; // 턴 표시 초상화 14×14
    if (!mini || !img(x + 2, y + 1, 14, 14, mini, mode === "ghost" ? 0.6 : 1, true)) {
      R(x + 4, y + 2, 10, 10, u.color, mode === "ghost" ? "opacity='.6'" : ""); // 미니 아이콘 자리
      T(x + 9, y + 10, u.tag || u.name[0], 7, ally ? C.woodD : C.txt, "middle");
    }
    if (mode !== "cur") T(x + 9, y + 19, String(w), 7, mode === "ghost" ? C.gold : C.txt, "middle"); // 진행 중인 차례는 숫자 없음
  }
  function timeline(dt: number) {
    tlMoving = false;
    let ord = order(b);
    if (turnActive && b.cur?.alive) ord = [b.cur, ...ord.filter((u) => u !== b.cur)];
    const list: { u: Unit; w: number; cur?: boolean; ghost?: boolean }[] = ord.map((u, k) => ({ u, w: u.wait, cur: turnActive && k === 0 }));
    const g = ghostWait();
    if (g != null) { // 예상 차례 카드: 들어갈 자리에 끼워 넣고 뒤 카드를 민다 (같은 대기면 기존 카드 뒤)
      const i = list.findIndex((c, k) => k > 0 && c.w > g);
      list.splice(i < 0 ? list.length : i, 0, { u: actor()!, w: g, ghost: true });
    }
    const hl = over.startsWith("tc:") || over.startsWith("card:") || over.startsWith("foe:") || over.startsWith("ally:") ? over.split(":")[1] : "";
    const seen = new Set<string>();
    list.slice(0, TL_MAX).forEach((c, k) => { // 넘치는 카드는 그리지 않는다
      const tx = TL.x + 6 + k * TL.pitch;
      let px = tx;
      if (!c.ghost) {
        // 진행 연출: 왼쪽으로 미끄러진다. 뒤로 크게 가는 카드(방금 행동한 유닛)는 바로 그 자리에.
        const prev = tlX.get(c.u.id);
        px = prev == null || tx - prev > TL.pitch + 1 ? tx : prev + (tx - prev) * (1 - Math.exp(-dt / 60));
        if (Math.abs(px - tx) < 0.5) px = tx;
        else tlMoving = true;
        tlX.set(c.u.id, px);
        seen.add(c.u.id);
      }
      timeCard(c.u, c.w, Math.round(px), 2, c.ghost ? "ghost" : c.cur ? "cur" : c.u.id === hl ? "hl" : "");
      if (!c.ghost) hit(tx, 2, TL.cardW, TL.cardH, "tc:" + c.u.id);
    });
    [...tlX.keys()].forEach((id) => !seen.has(id) && tlX.delete(id));
  }

  // ===== 카드 열 (4.2, 4.3) =====
  function cardFrame(x: number, y: number, hl: boolean, cur: boolean, w = 46) {
    R(x, y, w, 34, hl || cur ? C.gold : C.woodD);
    R(x + 1, y + 1, w - 2, 32, hl || cur ? C.listRowSel : C.panelIn);
    if (hl) box(x + 1, y + 1, w - 2, 32, C.gold);
  }
  /** 타임카드나 카드 열에 마우스가 올라간 개체 (카드 외곽·스프라이트 괄호 강조) */
  const pointed = (id: string) => over === "tc:" + id || over === "card:" + id;
  const shakeX = (id: string) => { const t = shake.get(id); return t == null ? 0 : Math.round(5 * Math.sin(t / 160 * Math.PI * 4)); };
  const flashFill = (u: Unit): [number, string][] => { const f = flash.get(u.id); return f ? [[f.from / u.hpMax, C.gold]] : []; };
  function allyCard(p: Unit, i: number) {
    const y = 2 + i * 36, x = shakeX(p.id), hl = pointed(p.id);
    // 카드 60×34: 왼쪽 초상화 28×28 (data/charArt.ts), 오른쪽 이름·HP·TP·MP
    cardFrame(x, y, hl, turnActive && b.cur === p, CARD_W);
    const face = charArt(p.name, "portrait");
    if (!face || !img(x + 3, y + 3, 28, 28, face, p.alive ? 1 : 0.35, true)) R(x + 3, y + 3, 28, 28, p.alive ? p.color : C.cellExt);
    T(x + 34, y + 10, p.name, 7, p.alive ? C.txt : C.sub);
    const sel = chosen().includes(p);
    const heal = sel && S.act ? previewHeal(actor()!, S.act, p) : 0;
    sbar(x + 34, y + 14, 23, 5, 8, [[p.hp / p.hpMax, C.hp], [(p.hp + heal) / p.hpMax, C.good], ...flashFill(p)]);
    if (p.tpMax) sbar(x + 34, y + 22, 23, 3, p.tpMax, [[p.tp / p.tpMax, C.lim]]);
    if (p.mpMax) sbar(x + 34, y + 27, 23, 3, 8, [[p.mp / p.mpMax, C.mp]]);
    hit(0, y, CARD_W, 34, "card:" + p.id);
  }
  function foeCard(f: Unit, i: number) {
    if (!f.alive) return;
    const y = 2 + i * 36, x = 434 + shakeX(f.id), sel = chosen().includes(f);
    const hl = pointed(f.id) || over === "foe:" + f.id;
    cardFrame(x, y, hl || sel, turnActive && b.cur === f);
    const face = f.type ? monsterArt(f.type.id, "portrait") : null; // 적 카드 초상화 (없으면 색 칸)
    if (!face || !img(x + 30, y + 2, 14, 14, face, 1, true)) {
      R(x + 31, y + 3, 12, 12, f.color);
      if (f.tag) T(x + 37, y + 12, f.tag, 7, C.txt, "middle");
    }
    T(x + 28, y + 11, label(f), 7, C.txt, "end");
    const d = sel && S.act ? previewHpLoss(actor()!, S.act, f) : 0;
    sbar(x + 3, y + 18, 40, 5, 8, [[(f.hp - d) / f.hpMax, C.hp], [f.hp / f.hpMax, C.gold], ...flashFill(f)]);
    hit(434, y, 46, 34, "card:" + f.id);
  }

  // ===== 무대 (4.5 ~ 4.8) =====
  /** 대상 선택 중 예상 수치 (2026-11-09): 고른 대상 스프라이트 가운데에 피해(−N)·회복(+N). 방어도에 막히면 "· HP −M"을 붙인다. */
  function previewLabel(u: Unit, cx: number, cy: number) {
    if (S.mode !== "target" || !S.act || !actor() || !chosen().includes(u) || !u.alive) return;
    let txt = "", col: string = C.gold;
    if (u.side === "foe") {
      const raw = Math.round(previewDamage(actor()!, S.act, u));
      if (raw <= 0) return;
      const loss = Math.round(previewHpLoss(actor()!, S.act, u));
      txt = loss < raw ? `-${raw} · HP -${loss}` : `-${raw}`;
    } else {
      const heal = Math.round(previewHeal(actor()!, S.act, u));
      if (heal <= 0) return;
      txt = `+${heal}`;
      col = C.good;
    }
    const w = tw(txt, 9) + 8;
    R(Math.round(cx - w / 2), cy - 7, w, 13, "#120C04", "opacity='.85'");
    T(cx, cy + 3, txt, 9, col, "middle");
  }

  /** 스프라이트 아래 작은 체력바 (2026-11-09): 왼쪽에 방어도 수치, 아래 줄에 상태 아이콘 (statusRow) */
  const MINI_Y = 3, ROW_Y = 10;
  function miniHp(u: Unit, s: Box) {
    if (!u.alive) return;
    const w = u.side === "foe" ? Math.min(48, Math.max(32, Math.round(s.w * 0.7))) : 32;
    const x = Math.round(s.cx - w / 2), y = s.fy + MINI_Y;
    gauge(x, y, w, 5, [[u.hp / u.hpMax, C.hp], ...flashFill(u)], C.cell);
    const g = statusOf(u, "방어도")?.v ?? 0;
    if (g > 0) {
      // 방어도: 작은 방패 + 수치 (바 왼쪽)
      const t = String(g), tw0 = tw(t);
      const ix = x - 4 - tw0 - 8;
      R(ix, y - 1, 6, 5, C.aura); R(ix + 1, y + 4, 4, 1, C.aura); R(ix + 2, y + 5, 2, 1, C.aura);
      T(x - 3, y + 5, t, 7, C.aura, "end");
    }
  }
  function statusRow(u: Unit, s: Box) {
    let x = s.cx - Math.round(Math.min(s.w, 60) / 2);
    const y = s.fy + ROW_Y;
    // 마법사 원소 스택: 상태 아이콘 줄 맨 앞, 아이콘 한 칸(9×9) 안에 2×2 작은 칸 (쌓인 순서대로 원소 색)
    if (u.elem?.length) {
      const id = `elem:${u.id}`;
      R(x, y, 9, 9, over === id ? C.gold : C.woodD);
      for (let k = 0; k < ELEM_STACK_MAX; k++) {
        const e = u.elem[k];
        R(x + 1 + (k % 2) * 4, y + 1 + Math.floor(k / 2) * 4, 3, 3, e ? ELEMENT_DEFS[e].color : C.night);
      }
      hit(x, y, 9, 9, id);
      stPos.set(id, [x, y - 2]);
      x += 11;
    }
    u.st.forEach((st, i) => {
      if (st.key === "방어도") return; // 방어도는 체력바 왼쪽 수치로
      const id = `st:${u.id}:${i}`;
      statusIcon(x, y, st.key, over === id ? C.gold : undefined);
      hit(x, y, 9, 9, id);
      stPos.set(id, [x, y - 2]);
      x += 11;
    });
  }
  function intentBubble(f: Unit, s: Box): [number, number, number] {
    const it = f.intent!;
    const dmg = intentDamage(f, it);
    const txt = ["one", "all", "row", "aim"].includes(it.k) ? String(dmg) : it.k === "guard" ? String(guardValue(f)) : it.k === "multi" ? `${dmg}×${it.hits}` : "";
    // 노리는 대상: 인텐트 오른쪽 끝에 대상 아군 색 칸. 대상 지정 공격은 의도를 정할 때 위험도로 골라 둔 아군 (7장)
    const tgtU = !f.alive ? null : ["one", "multi", "aim", "debuff"].includes(it.k) ? unit(it.tgt ?? "") ?? null : null;
    const bw = 6 + 8 + (txt ? 3 + tw(txt) : 0) + (tgtU ? 11 : 0) + 3;
    const bx = Math.round(s.cx - bw / 2), by = s.y - 14;
    R(bx, by, bw, 12, C.woodD); R(bx + 1, by + 1, bw - 2, 10, C.night);
    const ix = bx + 5, iy = by + 2; // 8×8 아이콘 자리 — TODO(spec): 인텐트 아이콘 소스
    if (it.k === "one" || it.k === "multi") { R(ix + 1, iy + 5, 2, 2, C.gold); R(ix + 3, iy + 3, 2, 2, C.gold); R(ix + 5, iy + 1, 2, 2, C.gold); }
    if (it.k === "all") { R(ix, iy + 1, 2, 6, C.lim); R(ix + 3, iy + 1, 2, 6, C.lim); R(ix + 6, iy + 1, 2, 6, C.lim); }
    if (it.k === "row") { R(ix + 3, iy, 2, 8, C.lim); R(ix + 1, iy + 3, 1, 2, C.lim); R(ix + 6, iy + 3, 1, 2, C.lim); }
    if (it.k === "aim") { R(ix + 3, iy, 2, 8, C.hp); R(ix, iy + 3, 8, 2, C.hp); }
    if (it.k === "guard") { R(ix + 1, iy, 6, 5, C.aura); R(ix + 2, iy + 5, 4, 2, C.aura); R(ix + 3, iy + 7, 2, 1, C.aura); }
    if (it.k === "buff") { R(ix + 3, iy + 1, 2, 7, C.good); R(ix + 1, iy + 3, 6, 1, C.good); R(ix + 2, iy + 2, 4, 1, C.good); }
    if (it.k === "debuff") { R(ix + 3, iy, 2, 7, C.statusCtrl); R(ix + 1, iy + 4, 6, 1, C.statusCtrl); R(ix + 2, iy + 5, 4, 1, C.statusCtrl); }
    if (txt) T(ix + 11, by + 9, txt, 7, C.txt);
    if (tgtU) { R(bx + bw - 13, by + 1, 10, 10, "#120C04"); R(bx + bw - 12, by + 2, 8, 8, tgtU.alive ? tgtU.color : C.cellExt); }
    return [bx, by, bw];
  }
  // 대상까지 점선 화살표. 가로막는 스프라이트가 없으면 직선(대각선 포함),
  // 적 후열에서 나오거나 아군 후열이 대상이면 위로 솟는 포물선(2차 베지어). 안티앨리어싱 허용.
  function arrowTo(f: Unit, t: Unit) {
    const fb = spr(f), tb = spr(t);
    const sx = fb.x - 3, sy = fb.y + Math.round(fb.h / 2);
    const ex = tb.x + tb.w + 4, ey = tb.y + Math.round(tb.h / 2);
    // TODO(spec): 아군 전열이 비었을 때 경로 (battle-ui.md 8장)
    const blocked = (f.col === "b" && fb.cx === FOE_X.b) || t.slot >= 3;
    let qx = sx, qy = sy;
    if (blocked) {
      const rise = Math.max(28, Math.abs(ex - sx) * 0.35);
      qx = (sx + ex) / 2; qy = Math.max(TOP - 30, Math.min(sy, ey) - rise);
    }
    const g = pen();
    const path = () => { g.beginPath(); g.moveTo(sx, sy); if (blocked) g.quadraticCurveTo(qx, qy, ex, ey); else g.lineTo(ex, ey); };
    const ang = Math.atan2(ey - qy, ex - qx), L = 6, Wd = 3.5, hr = Math.hypot(L, Wd), ha = Math.atan2(Wd, L);
    const head = () => {
      g.beginPath();
      g.moveTo(ex + Math.cos(ang) * 2, ey + Math.sin(ang) * 2);
      g.lineTo(ex + Math.cos(ang + Math.PI - ha) * hr, ey + Math.sin(ang + Math.PI - ha) * hr);
      g.lineTo(ex + Math.cos(ang + Math.PI + ha) * hr, ey + Math.sin(ang + Math.PI + ha) * hr);
      g.closePath();
    };
    g.save();
    g.lineCap = "round"; g.lineJoin = "round";
    g.globalAlpha = 0.85; g.strokeStyle = "#120C04"; g.lineWidth = 4; path(); g.stroke();
    g.globalAlpha = 1; g.fillStyle = "#120C04"; g.lineWidth = 2; head(); g.fill(); g.stroke();
    g.lineCap = "butt"; g.setLineDash([4, 3]); g.strokeStyle = C.hp; g.lineWidth = 1.5; path(); g.stroke();
    g.setLineDash([]); g.fillStyle = C.hp; head(); g.fill();
    g.restore();
  }

  /** tgt: 화살표 대상 (살펴보는 적이 노리는 아군), gain: 지금 고른 행동으로 행동하는 아군이 얻을 위험도 (미리보기) */
  interface Ctx { inspect: Unit | null; tgt: Unit | null; gain: number }
  let focus: Ctx | null = null;
  const big = (s: Box) => [s.x - 4, s.y - 4, s.w + 8, s.h + 8] as const;

  function drawAlly(p: Unit, ctx: Ctx) {
    const s = spr(p), it = ctx.inspect?.intent;
    R(s.cx - 12, s.fy - 1, 24, 3, C.dark);
    // 전투 스프라이트 48×48 (발 = 아래 가운데, data/charArt.ts). 불러오기 전·없으면 색 상자
    const art = charArt(p.name, "battle");
    const drawn = !!art && img(s.cx - 24, s.fy - 48, 48, 48, art, p.alive ? 1 : 0.3, true);
    if (!p.alive) { if (!drawn) R(s.x, s.y, s.w, s.h, p.color, "opacity='.3'"); return; }
    if (turnActive && b.cur === p) box(s.x - 1, s.y - 1, s.w + 2, s.h + 2, C.gold);
    if (!drawn) {
      R(s.x, s.y, s.w, s.h, p.color);
      R(s.x + 5, s.y + 4, s.w - 10, 10, "#ffffff", "opacity='.25'");
    }
    miniHp(p, s);
    statusRow(p, s);
    if (pointed(p.id)) corners(...big(s), C.gold);
    if (it && ["one", "multi", "aim", "debuff"].includes(it.k) && it.tgt === p.id) corners(...big(s), C.hp);
    if (chosen().includes(p)) corners(...big(s), C.gold);
    previewLabel(p, s.cx, s.fy - 24);
    if (blink?.id === p.id && Math.floor(blink.t / 75) % 2 === 0) corners(...big(s), C.hp);
    hit(s.x, s.y, s.w, s.h, "ally:" + p.id, "ally:" + p.id);
  }
  /** 위험도 스택 (2026-11-08, battle-ui.md 4.8): 아군 머리 위 칸 DANGER.max개 중 위험도만큼 칠한다. 늘 보인다.
   *  대상 선택 중이면 행동하는 아군의 칸에 얻을 위험도를 금색으로 미리 보여 준다. 살펴보는 적이 노리는 아군은 hp 색. */
  function dangerLabel(p: Unit, ctx: Ctx) {
    if (!p.alive) return;
    const d = danger(p), add = actor() === p ? ctx.gain : 0, top = ctx.tgt === p;
    // 2026-11-09: 스프라이트 왼쪽 세로 줄 (아래에서 위로 쌓인다) — 머리 위는 위 줄 캐릭터의 상태 아이콘과 겹쳐서
    const s = spr(p), PH = 3, GAP = 1, N = DANGER.max, h = N * (PH + GAP) - GAP + 4;
    const x0 = Math.round(s.cx - 30), yb = s.fy - 4;
    R(x0 - 2, yb - h + 2, 8, h, "#120C04", "opacity='.8'");
    for (let k = 0; k < N; k++) {
      const col = k < d ? (top ? C.hp : d >= 6 ? C.hp : d >= 3 ? C.gold : C.txt) : k < d + add ? C.gold : "#2A2420";
      const y = yb - (k + 1) * (PH + GAP) + GAP;
      R(x0, y, 4, PH, col);
      if (k >= d && k < d + add) R(x0, y, 4, PH, "#120C04", "opacity='.35'");
    }
    hit(x0 - 2, yb - h + 2, 8, h, "danger:" + p.id);
  }
  function drawFoe(f: Unit, ctx: Ctx) {
    if (!f.alive) return;
    const s = spr(f);
    R(s.x + 3, s.fy - 1, s.w - 6, 3, C.dark);
    if (turnActive && b.cur === f) box(s.x - 1, s.y - 1, s.w + 2, s.h + 2, C.gold);
    // 몬스터 스프라이트 (data/monsterArt.ts, 크기별 정사각 — 발 = 아래 가운데). 없으면 색 상자
    const art = f.type ? monsterArt(f.type.id, "battle") : null;
    const side = FOE_ART[f.type?.size ?? 1] ?? 48;
    if (!art || !img(Math.round(s.cx - side / 2), s.fy - side, side, side, art, 1, true)) {
      R(s.x, s.y, s.w, s.h, f.color);
      R(s.cx - s.w / 4 - 3, s.y + Math.min(s.h / 4, 14), 4, 4, C.gold); R(s.cx + s.w / 4 - 1, s.y + Math.min(s.h / 4, 14), 4, 4, C.gold);
    }
    if (f.tag) {
      // 같은 몬스터 구분 글자 (A·B …): 발밑 작은 꼬리표
      R(s.cx - 5, s.fy - 9, 10, 9, "#120C04", "opacity='.75'");
      T(s.cx, s.fy - 2, f.tag, 7, C.txt, "middle");
    }
    const [bx, by, bw] = intentBubble(f, s);
    miniHp(f, s);
    statusRow(f, s);
    if (pointed(f.id)) corners(...big(s), C.gold);
    if (f.intent?.tgt === "self" && ctx.inspect === f) corners(...big(s), C.gold);
    if (chosen().includes(f)) corners(...big(s), C.gold);
    previewLabel(f, s.cx, Math.round(s.fy - side / 2));
    hit(Math.min(s.x, bx), by, Math.max(s.w, bw), s.fy - by, "foe:" + f.id, "foe:" + f.id);
  }
  function stage() {
    stPos.clear();

    // 적 살펴보기: 마우스를 올린 적, 또는 단일 대상으로 고르는 중인 적
    const sel = chosen();
    const inspect = over.startsWith("foe:") ? unit(over.slice(4)) ?? null
      : S.mode === "target" && S.act?.tgt === "one" && sel[0]?.side === "foe" ? sel[0] : null;
    const it = inspect?.alive ? inspect.intent : undefined;
    const floorAt = (cx: number, fy: number) => R(cx - 22, fy - 3, 44, 6, C.hp, "opacity='.55'");
    if (it?.k === "all") b.allies.forEach((p) => { const s = spr(p); floorAt(s.cx, s.fy); });
    if (it?.k === "row") [0, 1, 2].forEach((k) => floorAt(ALLY_X[it.row ?? "f"], feetY(k)));

    const ctx: Ctx = { inspect: it ? inspect : null, tgt: null, gain: 0 };
    // 대상 선택 중: 행동하는 아군이 얻을 위험도 미리보기
    if (S.mode === "target" && S.act && actor()) ctx.gain = previewDanger(b, actor()!, S.act, sel);
    // 살펴보는 적이 노리는 아군 (의도를 정할 때 위험도로 골라 둔 대상)
    if (it && ["one", "multi", "aim", "debuff"].includes(it.k)) ctx.tgt = unit(it.tgt ?? "") ?? null;

    b.allies.forEach((p) => drawAlly(p, ctx));
    b.foes.forEach((f) => drawFoe(f, ctx));
    focus = ctx.tgt?.alive ? ctx : null;
    // 위험도 스택은 늘 (집중 표시 중이면 집중 층에서 다시 그린다)
    if (!focus) b.allies.forEach((p) => dangerLabel(p, ctx));
  }
  // 집중 표시: 무대만 덮고, 공격하는 적·대상 아군·점수·화살표만 다시 그린다
  function focusLayer() {
    if (!focus) return;
    noHit = true;
    R(48, 34, 384, 188, "#0B0804", "opacity='.62'");
    drawFoe(focus.inspect!, focus);
    drawAlly(focus.tgt!, focus);
    b.allies.forEach((p) => dangerLabel(p, focus!));
    arrowTo(focus.inspect!, focus.tgt!);
    noHit = false;
  }

  // ===== 하단 (4.9 ~ 4.11) =====
  function actorPanel() {
    const p = b.cur;
    if (!p) return;
    R(6, 227, 16, 16, p.color);
    T(26, 233, label(p), 8, C.txt); T(94, 233, `Lv${p.lv}`, 7, C.sub, "end");
    T(26, 242, `HP ${p.hp}/${p.hpMax}`, 7, C.sub);
    sbar(6, 246, 88, 6, 12, [[p.hp / p.hpMax, C.hp]]);
    if (p.side === "foe") return; // TODO(spec): 적 차례 하단 구성 (battle-ui.md 8장)
    sbar(6, 254, 88, 4, 12, [[p.mp / Math.max(1, p.mpMax), C.mp]]);
    sbar(6, 260, 40, 3, Math.max(1, p.tpMax), [[p.tp / Math.max(1, p.tpMax), C.lim]]);
    T(6, 268, `MP ${p.mp}/${p.mpMax}`, 7, C.mp);
    T(94, 268, `TP ${p.tp}/${p.tpMax}`, 7, C.lim, "end");
  }
  function costText(a: ActDef) {
    if (a.item) return `×${b.bag[a.item] ?? 0}`;
    const u = actor();
    const cd = u?.cds[a.id] ? ` (${u.cds[a.id]}턴)` : "";
    if (a.cost?.tp === "all") return "TP 전량" + cd;
    if (a.cost?.tp) return `TP ${a.cost.tp}` + cd;
    if (a.cost?.mp === "all") return "MP 전량" + cd;
    if (u && (a.cost?.mp || a.cost?.mpPct)) return `MP ${mpCost(u, a)}` + cd;
    return cd.trim();
  }
  let descFlash = "";
  function toggleCleanse(k: StatusKey) {
    const n = S.act?.cleanseN ?? 1;
    if (CL.picked.includes(k)) CL.picked = CL.picked.filter((x) => x !== k);
    else if (CL.picked.length < n) CL.picked.push(k);
  }
  /** 정화 선택 창 (battle-ui.md 정화 대상 선택): 대상 아군의 상태이상을 칩으로 늘어놓고 고른다. */
  function cleanseWindow() {
    const t0 = CL.target;
    if (!t0) return;
    const list = cleansable(t0);
    T(108, 233, `${t0.name}의 상태이상`, 7, C.sub);
    let x = 108, y = 238;
    list.forEach((k) => {
      const w = tw(k) + 16, on = CL.picked.includes(k);
      if (x + w > 316) { x = 108; y += 13; }
      R(x, y, w, 11, on ? C.gold : C.woodD);
      R(x + 1, y + 1, w - 2, 9, on ? C.listRowSel : C.panelIn);
      statusIcon(x + 1, y + 1, k);
      T(x + 12, y + 9, k, 7, on ? C.gold : C.txt);
      hit(x, y, w, 11, "cl:" + k, "cl:" + k);
      x += w + 3;
    });
    const ok = CL.picked.length > 0;
    btn(264, 254, 52, `결정 ${CL.picked.length}/${S.act?.cleanseN ?? 1}`, ok, !ok);
    hit(264, 254, 52, 14, "clok", "clok");
  }
  function commandWindow() {
    const u = actor();
    if (!u || S.mode === "end" || (S.mode === "busy" && !S.act)) return;
    if (S.mode === "cmd" || (S.mode === "busy" && S.from === "cmd")) {
      CMDS.forEach((c, i) => {
        const x = 108 + (i % 4) * 55, y = 228 + Math.floor(i / 4) * 20;
        const ca = cmdAct(c);
        btn(x, y, 51, c.act === ATTACK && ca ? ca.name : c.n, S.mode === "cmd" && i === S.cur, !!ca && !usable(b, u, ca).ok);
        if (S.mode === "cmd") hit(x, y, 51, 14, "m:" + i, "m:" + i);
      });
      return;
    }
    if (S.mode === "cleanse") return cleanseWindow();
    const kind = S.mode === "skill" || S.mode === "item" ? S.mode : S.from;
    if (kind === "cmd") return;
    const list = listOf(kind);
    const rows: (ActDef | null)[] = [null, ...list];
    for (let r = 0; r < 4; r++) {
      const i = S.scroll + r;
      if (i >= rows.length) break;
      const it = rows[i], y = 226 + r * 10, sel = i === S.cur;
      R(106, y, 212, 9, sel ? C.listRowSel : C.listRow);
      if (sel) R(106, y, 2, 9, C.gold);
      if (!it) {
        R(112, y + 4, 1, 1, C.sub); R(113, y + 3, 1, 3, C.sub); R(114, y + 2, 1, 5, C.sub);
        T(118, y + 7, "뒤로", 7, sel ? C.gold : C.sub);
      } else {
        const off = !usable(b, u, it).ok;
        T(112, y + 7, it.name, 7, off ? C.cellExt : sel ? C.gold : C.txt);
        T(316, y + 7, costText(it), 7, off ? C.cellExt : it.item ? C.sub : it.cost?.mp ? C.mp : C.lim, "end");
      }
      if (S.mode === "skill" || S.mode === "item") hit(106, y, 212, 9, "m:" + i, "m:" + i);
    }
    R(321, 226, 3, 39, C.listRow);
    R(321, 226 + Math.round(39 * S.scroll / rows.length), 3, Math.min(39, Math.round(39 * 4 / rows.length)), C.woodL);
  }
  function descWindow() {
    if (descFlash && inputMode()) { T(338, 233, descFlash, 8, C.hp); return; }
    if (S.mode === "end") { T(338, 233, S.msg, 8, C.gold); return; }
    if (S.msg) { T(338, 233, S.msg, 8, C.gold); return; }
    const u = actor();
    if (!u) return;
    const e = curEntry();
    if (!e) { T(338, 233, "뒤로", 8, C.txt); T(338, 244, "이전 단계로 돌아간다.", 7, C.sub); return; }
    if (S.mode === "cleanse" && S.act) {
      T(338, 233, S.act.name, 8, C.txt); T(474, 233, "상태이상 선택", 7, C.gold, "end");
      T(338, 244, `${CL.target?.name ?? ""}: 최대 ${S.act.cleanseN}개 고른다`, 7, C.sub);
      T(338, 264, "클릭 고르기 · Enter 결정 · Esc 뒤로", 7, C.sub);
      return;
    }
    if (S.mode === "target" && S.act) {
      T(338, 233, S.act.name, 8, C.txt); T(474, 233, "대상 선택", 7, C.gold, "end");
      T(338, 244, S.act.cat, 7, C.sub);
      T(338, 264, "결정 Enter · 뒤로 Esc", 7, C.sub);
      return;
    }
    const lines = e.act ? [e.act.cat, ...wrapDesc(e.act.desc)] : e.d!.slice(1);
    const chk = e.act ? usable(b, u, e.act) : { ok: true };
    T(338, 233, e.n, 8, chk.ok ? C.txt : C.cellExt);
    lines.slice(0, chk.ok ? 3 : 2).forEach((s, i) => T(338, 244 + i * 10, s, 7, i === 0 ? C.sub : C.txt));
    if (!chk.ok && chk.reason) T(338, 244 + Math.min(lines.length, 2) * 10, chk.reason, 7, C.hp);
  }

  // ===== 툴팁 (4.6) =====
  function tooltip() {
    if (over.startsWith("danger:")) return dangerTip(over.slice(7));
    if (!over.startsWith("st:") && !over.startsWith("elem:")) return;
    const [, id, i] = over.split(":"), u = unit(id), st = u?.st[+i], pos = stPos.get(over);
    if (!u || !pos || (!st && !over.startsWith("elem:"))) return;
    const elemLines = () => {
      const s = u.elem ?? [];
      const counts = [...new Set(s)].map((e) => `${ELEMENT_DEFS[e].label} ${s.filter((x) => x === e).length} (+${s.filter((x) => x === e).length * ELEM_STACK_PCT}%)`);
      return [`원소 스택 ${s.length}/${ELEM_STACK_MAX}`, counts.join(" · "), "같은 원소 마법 위력 증가. 원소 방출이 모두 소모."];
    };
    const lines = st ? STATUS[st.key].d(st.v, st.n) : elemLines(), w = Math.max(...lines.map((l) => tw(l))) + 10, h = lines.length * 10 + 5;
    let [x, y] = pos;
    y += 13;
    if (y + h > 268) y = pos[1] - 1 - h;
    x = Math.max(2, Math.min(478 - w, x));
    R(x, y, w, h, C.tipLine); R(x + 1, y + 1, w - 2, h - 2, C.tipBg);
    lines.forEach((l, k) => T(x + 5, y + 10 + k * 10, l, 7, k ? C.txt : C.gold));
  }

  /** 위험도 칸 툴팁: 수치와 노려질 확률 */
  function dangerTip(id: string) {
    const u = unit(id);
    if (!u) return;
    const i = b.allies.indexOf(u), pct = targetChances(b)[i];
    const lines = u.dangerMarked
      ? [`위험도 ${danger(u)}/${DANGER.max} — 표적`, "다음 대상 지정 공격을 반드시 받는다.", `받고 나면 위험도가 ${DANGER.reset}으로 떨어진다.`]
      : [`위험도 ${danger(u)}/${DANGER.max}`, `적이 노릴 확률 ${pct ?? 0}%`, "행동·공격·큰 피해·처치·효과로 쌓이고,", "턴이 끝날 때마다 줄어든다."];
    const w = Math.max(...lines.map((l) => tw(l))) + 10, h = lines.length * 10 + 5;
    const s = spr(u);
    const x = Math.max(2, Math.min(478 - w, s.cx - 34 - w)), y = Math.max(2, s.fy - 40 - h / 2);
    R(x, y, w, h, C.tipLine); R(x + 1, y + 1, w - 2, h - 2, C.tipBg);
    lines.forEach((l, k) => T(x + 5, y + 10 + k * 10, l, 7, k ? C.txt : C.gold));
  }

  // 카드 수치 툴팁 (4.2, 4.3): 아군은 카드 오른쪽, 적은 카드 왼쪽. 카드 위쪽에 맞추고 화면 밖이면 위로
  function cardTip() {
    if (!over.startsWith("card:")) return;
    const u = unit(over.slice(5));
    if (!u) return;
    const g = statusOf(u, "방어도");
    const lines: [string, string][] = [[label(u), C.gold], [`HP ${u.hp}/${u.hpMax}`, C.txt]];
    if (u.tpMax) lines.push([`TP ${u.tp}/${u.tpMax}`, C.lim]);
    else if (u.mpMax) lines.push([`MP ${u.mp}/${u.mpMax}`, C.mp]);
    if (g) lines.push([`방어도 ${g.v}`, C.aura]);
    const w = Math.max(...lines.map(([l]) => tw(l))) + 10, h = lines.length * 10 + 5;
    const i = u.side === "ally" ? b.allies.indexOf(u) : foeCardOrder(b).indexOf(u);
    const x = u.side === "ally" ? 48 : 432 - w;
    const y = Math.min(268 - h, 2 + i * 36);
    R(x, y, w, h, C.tipLine); R(x + 1, y + 1, w - 2, h - 2, C.tipBg);
    lines.forEach(([l, col], k) => T(x + 5, y + 10 + k * 10, l, 7, col));
  }

  // 상태 창 (4.6): 스프라이트에 마우스. 위부터 능력치 막대 + 남은 스택 나열 / 스택 게이지 / 스택 없는 상태
  function statusWindow() {
    const m = /^(?:ally|foe):(.+)$/.exec(over);
    const u = m ? unit(m[1]) : undefined;
    if (!u?.alive) return;
    const p = statusPanel(b, u), W = 116, ROW = 10, BAR_X = 31, BAR_L = 47;
    if (!p.mods.length && !p.stacks.length && !p.flags.length) return;
    // 스택 나열·스택 없는 상태는 흘려 놓고 넘치면 다음 줄
    const flow = <V,>(list: V[], wOf: (v: V) => number) => {
      let dx = 0, row = 0;
      const at = list.map((v) => {
        const w = wOf(v);
        if (dx && dx + w > W - 10) { dx = 0; row++; }
        const here = { v, dx, row };
        dx += w;
        return here;
      });
      return { at, rows: list.length ? row + 1 : 0 };
    };
    const modText = (m: { key: StatusKey; v: number }) => `${m.key} ${m.v}`;
    const mods = flow(p.mods, (m) => tw(modText(m)) + 6);
    const flags = flow(p.flags, (key) => 11 + tw(key) + 4);
    const stH = p.stacks.length ? 3 + p.stacks.length * ROW : 0, flH = flags.rows ? 3 + flags.rows * ROW : 0;
    const h = 4 + ROW + (p.stats.length + mods.rows) * ROW + stH + flH + 3;
    // 적의 왼쪽은 화살표·어그로 %가 지나가므로 쓰지 않는다. 오른쪽에 자리가 없으면 발 아래, 그다음 말풍선 위
    const s = spr(u);
    const x = u.side === "ally" ? s.x + s.w + 4 : Math.min(s.x + s.w + 4, 478 - W);
    let y = s.y;
    if (u.side === "foe" && x < s.x + s.w) {
      if (s.fy + 13 + h <= 268) y = s.fy + 13;
      else y = s.y - 16 - h >= 2 ? s.y - 16 - h : 268 - h;
    }
    y = Math.max(2, Math.min(268 - h, y));
    R(x, y, W, h, C.tipLine); R(x + 1, y + 1, W - 2, h - 2, C.tipBg);
    const line = (yy: number) => R(x + 5, yy, W - 10, 1, C.tipLine);
    T(x + 5, y + 10, label(u), 7, C.gold);
    let ry = y + 4 + ROW;
    p.stats.forEach((r) => {
      T(x + 5, ry + 8, r.label, 7, r.net ? C.txt : C.sub);
      statBar(x + BAR_X, ry + 3, BAR_L, r.net);
      T(x + W - 5, ry + 8, r.net > 0 ? `+${r.net}` : r.net < 0 ? `−${-r.net}` : "0", 7, r.net > 0 ? C.good : r.net < 0 ? C.hp : C.sub, "end");
      ry += ROW;
    });
    mods.at.forEach((m) => T(x + 5 + m.dx, ry + m.row * ROW + 8, modText(m.v), 7, ST_COL[STATUS[m.v.key].t]));
    ry += mods.rows * ROW;
    if (stH) {
      line(ry + 1); ry += 3;
      p.stacks.forEach((r) => {
        const col = r.key === "방어도" ? C.aura : ST_COL[STATUS[r.key].t];
        T(x + 5, ry + 8, r.key, 7, col);
        sbar(x + BAR_X, ry + 3, BAR_L, 5, r.trigger ? Math.min(12, r.len) : 8, [[r.v / r.len, col]]);
        T(x + W - 5, ry + 8, r.trigger ? `${r.v}/${r.len}` : String(r.v), 7, C.txt, "end");
        ry += ROW;
      });
    }
    if (flH) {
      line(ry + 1); ry += 3;
      flags.at.forEach((f) => {
        const fy = ry + f.row * ROW, ix = x + 5 + f.dx;
        statusIcon(ix, fy + 1, f.v);
        T(ix + 11, fy + 8, f.v, 7, C.txt);
      });
    }
  }

  // ===== 피해 숫자 연출 (6장) =====
  function drawPopups() {
    popups.forEach((p) => {
      if (p.t < 0) return;
      const u = unit(p.id);
      if (!u) return;
      const s = spr(u), y = Math.round(s.y + Math.min(20, s.h / 2) - Math.min(12, p.t / 40));
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) T(s.cx + dx, y + dy, p.text, p.size, "#120C04", "middle");
      T(s.cx, y, p.text, p.size, p.col, "middle");
    });
  }

  // ===== 입력 (7장) =====
  function moveCur(d: number) {
    if (S.mode === "cmd") { S.cur = Math.max(0, Math.min(CMDS.length - 1, S.cur + d)); return; }
    if (S.mode === "skill" || S.mode === "item") {
      S.cur = Math.max(0, Math.min(listOf(S.mode).length, S.cur + Math.sign(d)));
      if (S.cur < S.scroll) S.scroll = S.cur;
      if (S.cur > S.scroll + 3) S.scroll = S.cur - 3;
      return;
    }
    if (S.mode === "target" && S.act) { const n = targetSets(b, actor()!, S.act).length; if (n) S.tIdx = (S.tIdx + Math.sign(d) + n) % n; }
  }
  function choose(e: Entry, from: "cmd" | "skill" | "item") {
    const u = actor()!;
    if (e.sub) { S.mode = e.sub; S.cur = 1; S.scroll = 0; return; }
    const a = e.act!;
    if (!usable(b, u, a).ok) return;
    S.from = from;
    if (a.tgt === "self") { S.act = a; execute(a, [u]); return; }
    if (a.tgt === "allyAll") { S.act = a; execute(a, targetSets(b, u, a)[0] ?? [u]); return; }
    const sets = targetSets(b, u, a);
    if (!sets.length) return;
    S.act = a; S.tIdx = 0; S.mode = "target";
  }
  function confirm() {
    if (S.mode === "cmd") { const c = CMDS[S.cur]; return choose(c.act ? { ...c, act: cmdAct(c) } : c, "cmd"); }
    if (S.mode === "skill" || S.mode === "item") {
      const a = listOf(S.mode)[S.cur - 1];
      return a ? choose({ n: a.name, act: a }, S.mode) : back();
    }
    if (S.mode === "target" && S.act) {
      const t = chosen();
      if (!t.length) return;
      if (S.act.cleanseN) {
        // 정화: 대상의 상태이상 목록에서 고른다. 없으면 진행하지 않는다
        const list = cleansable(t[0]);
        if (!list.length) { S.msg = ""; descFlash = "제거할 상태이상이 없다."; return; }
        CL.target = t[0];
        CL.picked = list.length <= S.act.cleanseN ? [...list] : [];
        S.mode = "cleanse";
        S.cur = 0;
        return;
      }
      execute(S.act, t);
      return;
    }
    if (S.mode === "cleanse" && S.act && CL.target) {
      if (!CL.picked.length) return;
      execute(S.act, [CL.target], CL.picked);
    }
  }
  function back() {
    if (S.mode === "cleanse") { S.mode = "target"; CL.target = null; CL.picked = []; return; }
    if (S.mode === "target") {
      S.mode = S.from;
      if (S.from === "cmd") S.cur = Math.max(0, CMDS.findIndex((c) => cmdAct(c) === S.act));
      S.act = null;
      return;
    }
    if (S.mode === "skill" || S.mode === "item") { S.cur = S.mode === "skill" ? 1 : 3; S.mode = "cmd"; }
  }
  function onHover(k: string) {
    if (descFlash && k !== over) descFlash = "";
    if (k.startsWith("m:") && (S.mode === "cmd" || S.mode === "skill" || S.mode === "item")) S.cur = +k.slice(2);
    if (S.mode === "target" && S.act && (k.startsWith("foe:") || k.startsWith("ally:"))) {
      const id = k.split(":")[1], i = targetSets(b, actor()!, S.act).findIndex((t) => t.some((u) => u.id === id));
      if (i >= 0) S.tIdx = i;
    }
  }
  function hitAt(p: LogicalPoint): Hit | undefined {
    for (let i = hits.length - 1; i >= 0; i--) {
      const [x, y, w, h] = hits[i];
      if (p.x >= x && p.x < x + w && p.y >= y && p.y < y + h) return hits[i];
    }
    return undefined;
  }

  // ===== 매 프레임 =====
  function tick(dt: number) {
    clock += dt;
    const due = queue.filter((q) => q.at <= clock);
    queue = queue.filter((q) => q.at > clock);
    due.forEach((q) => q.fn());
    fx.tick(dt);
    popups.forEach((p) => (p.t += dt));
    popups = popups.filter((p) => p.t < 800);
    flash.forEach((f, id) => ((f.t += dt) > 550 ? flash.delete(id) : 0));
    shake.forEach((t, id) => (t + dt > 160 ? shake.delete(id) : shake.set(id, t + dt)));
    if (blink && (blink.t += dt) > 300) blink = null;
  }

  // 고정 레이어: 배경 그림(2026-11-09, 구획마다 — 동굴·초원), 타임라인 띠, 하단 창 세 개의 틀. 편성과 무관하게 늘 같다.
  // 배경은 스프라이트·표시가 잘 보이게 약간 투명하게 (검은 바탕 위 BG_ALPHA). 옛 무대 바닥·가운데 선은 없앴다.
  function base() {
    R(0, 0, 480, 270, "#000000");
    img(0, 0, 480, 270, `${import.meta.env.BASE_URL}backgrounds/battle_${battleBg()}.webp`, BG_ALPHA, true);
    R(TL.x, 0, TL.w, 26, C.woodD); R(TL.x + 1, 0, TL.w - 2, 25, C.dark);
    W(0, 222, 100, 48);
    W(102, 222, 228, 48);
    W(332, 222, 148, 48, "", true);
  }

  let lastDt = 16;
  function draw() {
    hits = [];
    cached(`b01.base:${battleBg()}:${bgReady()}`, 0, 0, 480, 270, base);
    timeline(lastDt);
    b.allies.forEach(allyCard); // 4인 + 빈칸 2 (소환·설치 자리)는 비워 둔다
    foeCardOrder(b).forEach(foeCard);
    stage();
    actorPanel(); commandWindow(); descWindow();
    focusLayer();
    fx.draw();
    drawPopups();
    tooltip();
    cardTip();
    statusWindow();
    endFx.draw();
  }

  /** 개발용: 남은 적 또는 아군을 전부 쓰러뜨려 종료 연출을 바로 본다 (Shift+W 승리, Shift+L 패배). */
  function debugEnd(side: "foe" | "ally") {
    (side === "foe" ? b.foes : b.allies).forEach((u) => { u.hp = 0; u.alive = false; u.st = []; });
    queue = []; popups = []; turnActive = false;
    nextTurn();
  }

  start();

  return {
    id: "b01",
    label: "B01 전투",
    tick: (dt) => { lastDt = dt; tick(dt); endFx.tick(dt); },
    draw,
    // 예약된 진행(적 차례 등), 피해 숫자·번쩍임·흔들림·깜빡임, 타임라인 미끄러짐이 남아 있는 동안 + 종료 오버레이
    isAnimating: () => fx.busy() || queue.length > 0 || popups.length > 0 || flash.size > 0 || shake.size > 0 || blink != null || tlMoving || endFx.animating(),
    // D06에서 대열을 바꾸고 들어오면 새 대열로 전투를 다시 시작한다.
    onEnter: () => {
      const enc = takeEncounter();
      if (enc) start(enc);
      else if (leftForResult || b.allies.some((a) => a.slot !== slotOf(a.name))) start();
    },
    onPointerMove: (p) => {
      if (S.mode === "end") { endFx.pointerMove(p); return; }
      const k = hitAt(p)?.[4] ?? "";
      if (k !== over) { over = k; onHover(k); }
    },
    onPointerDown: (p, button) => {
      if (button === 2) { if (inputMode()) back(); return; }
      if (button !== 0) return;
      if (S.mode === "end") { endFx.pointerDown(p); return; }
      if (!inputMode()) return;
      const c = hitAt(p)?.[5];
      if (!c) return;
      if (c.startsWith("cl:") && S.mode === "cleanse") { toggleCleanse(c.slice(3) as StatusKey); return; }
      if (c === "clok" && S.mode === "cleanse") { confirm(); return; }
      if (c.startsWith("m:")) { S.cur = +c.slice(2); confirm(); return; }
      if (S.mode === "target" && S.act && targetSets(b, actor()!, S.act).some((t) => t.some((u) => u.id === c.split(":")[1]))) {
        onHover(c);
        confirm();
      }
    },
    onKeyDown: (k) => {
      if (S.mode === "end") { endFx.key(k); return; }
      if (import.meta.env.DEV && (k === "W" || k === "L")) { debugEnd(k === "W" ? "foe" : "ally"); return; }
      if (!inputMode()) return;
      if (k === "ArrowLeft") moveCur(-1);
      else if (k === "ArrowRight") moveCur(1);
      else if (k === "ArrowUp") moveCur(S.mode === "cmd" ? -4 : -1);
      else if (k === "ArrowDown") moveCur(S.mode === "cmd" ? 4 : 1);
      else if (k === "Enter" || k === " " || k === "z" || k === "Z") confirm();
      else if (k === "Escape" || k === "Backspace" || k === "x" || k === "X") back();
      else if (S.mode === "cmd" && k >= "1" && k <= "7") { S.cur = +k - 1; confirm(); }
    },
  };
}

const INTENT_NAME: Record<string, string> = { one: "공격", multi: "연속 공격", all: "전체 공격", row: "열 공격", aim: "조준 공격", guard: "방어", buff: "강화", debuff: "약화" };

