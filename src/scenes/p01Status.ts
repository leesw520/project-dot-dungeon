// P01 스테이터스 — 2026-11-02 스탯 개편판 (docs/character-system.md 2장, 7장 P01).
// 캐릭터 탭 5개는 B01과 같은 PARTY(data/battle.ts), 스탯 이름·툴팁은 data/stats.ts를 쓴다.
// 오른쪽 패널은 능력치/장비/스킬 하위 탭으로 통째로 바뀐다. 장비 탭은 P02, 스킬 탭은 P03으로 이동한다.
import { ELEMENT_APT, aptitudeOf, type CoreReq } from "../data/aptitude";
import { PARTY, type AllyDef } from "../data/battle";
import { SLOT_INFO, equipBonus, getLoadout, isBlocked, isLocked, modsText, equipByUid, type SlotId } from "../data/equipment";
import { allyAffinity, equippedSkills, finalStats } from "../engine/party";
import { vitalsOf } from "../engine/partyVitals";
import { ELEMENT_DEFS, ELEMENT_ORDER, type ElementId } from "../data/itemTaxonomy";
import { STAT_INFO, STAT_ORDER, baseWaitOf, turnSpeedOf, type StatKey } from "../data/stats";
import { expToNext, partyExp } from "../engine/battleResult";
import { goTo, takeNavBack, takeNavChar } from "../engine/nav";
import { C, PIECE, R, T, W, btn, fitText, pen, textWidth, img } from "../render/primitives";
import { charArt } from "../data/charArt";
import type { LogicalPoint, Scene } from "./types";

type Sub = "stat" | "equip" | "skill";
const SUB_TABS: Array<[Sub, string]> = [["stat", "능력치"], ["equip", "장비"], ["skill", "스킬"]];



function affinityStep(a: AllyDef, el: ElementId): number {
  const s = allyAffinity(a.name)[el];
  return typeof s === "number" ? s : 0; // 무효·흡수는 적 전용 (2.5)
}

/** 장비 + 코어 보정 합계 (engine/party.ts finalStats). */
function bonusOf(a: AllyDef): Record<StatKey, number> {
  return finalStats(a.name).bonus;
}

/** 공백 단위로 maxW 안에 줄바꿈. */
function wrap(s: string, maxW: number, sz: number) {
  const out: string[] = [];
  let line = "";
  for (const w of s.split(" ")) {
    const next = line ? `${line} ${w}` : w;
    if (line && textWidth(next, sz) > maxW) {
      out.push(line);
      line = w;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

const STAT_Y0 = 112;
const STAT_DY = 16;
// 능력치 탭 2단: 오른쪽 창 안쪽(158~468)을 보이지 않는 중앙선 COL_MID로 나눈다.
// 왼쪽 단 = 주 스탯 + 적성 (168 ~ COL_MID − 10), 오른쪽 단 = 속성 상성 (단 안에서 가운데 정렬).
const COL_MID = 313;
const LEFT_END = COL_MID - 10;
const AFF_W = 24 + 6 * 12 + 10; // 속성 이름 24 + 막대 7칸
const AFF_LABEL_X = COL_MID + Math.floor((468 - COL_MID - AFF_W) / 2);
const AFF_X = AFF_LABEL_X + 24;
const AFF_Y0 = 120;
const AFF_DY = 14;
// 장비 탭: 슬롯 2열 × 3줄 (P02와 같은 순서).
// 3열 × 3줄: 첫 줄 신체·가방(셋째 칸 비움, 2026-11-08 머리 칸 삭제), 그 아래 왼쪽 열에 무기 1·2 (위아래), 오른쪽 2열에 악세 1~4 (2×2).
const EQ_SLOTS: Array<SlotId | null> = ["body", "bag", null, "w0", "a0", "a1", "w1", "a2", "a3"];
const EQ_X = [168, 267, 366];
const EQ_Y = [58, 94, 130];
const EQ_W = 96;
const EQ_H = 30;
// 스킬 탭: 출처 분류별 묶음 (코어 분류와 같은 순서). 목록 영역은 잘라 그리고 휠로 스크롤.
const SKILL_GROUPS: CoreReq["type"][] = ["job", "weapon", "element", "sub", "common"];
const SK = { x: 166, y: 52, w: 298, h: 184 };
const SK_HEAD_H = 16;
const SK_ROW_H = 26;

interface SkillRow {
  name: string;
  passive: boolean;
  /** 오른쪽 위 보조 줄 (태그 · 분류, 또는 코어 이름) */
  meta: string;
  desc: string;
}
type SkillItem = { kind: "head"; label: string; n: number } | { kind: "row"; row: SkillRow };

/** 이 캐릭터 판에 꽂힌 코어가 주는 스킬만 (2026-11-07). 적성(기사·방패·수호 …)별로 묶고, 묶음 순서는 분류(직업·무기·속성·보조) 순. */
function skillItems(name: string): SkillItem[] {
  const groups = new Map<string, { type: CoreReq["type"]; rows: SkillRow[] }>();
  for (const s of equippedSkills(name)) {
    const cost = s.cost?.tp === "all" ? "TP 전량" : s.cost?.tp ? `TP ${s.cost.tp}` : s.cost?.mp === "all" ? "MP 전량" : s.cost?.mpPct ? `최대 MP ${s.cost.mpPct}%` : s.cost?.mp ? `MP ${s.cost.mp}` : "";
    const meta = s.passive ? s.apt : [s.apt, cost, s.cd ? `재사용 ${s.cd}턴` : ""].filter(Boolean).join(" · ");
    if (!groups.has(s.apt)) groups.set(s.apt, { type: s.req.type, rows: [] });
    groups.get(s.apt)!.rows.push({ name: s.name, passive: !!s.passive, meta, desc: s.lines.join(" ") });
  }
  const out: SkillItem[] = [];
  const order = [...groups.entries()].sort((a, b) => SKILL_GROUPS.indexOf(a[1].type) - SKILL_GROUPS.indexOf(b[1].type));
  for (const [apt, g] of order) {
    const rows = g.rows.sort((x, y) => +x.passive - +y.passive); // 액티브 → 패시브
    out.push({ kind: "head", label: `적성: ${apt}`, n: rows.length });
    rows.forEach((row) => out.push({ kind: "row", row }));
  }
  return out;
}
const itemH = (it: SkillItem) => (it.kind === "head" ? SK_HEAD_H : SK_ROW_H);

/** 장비 탭 "장비 변경" · 스킬 탭 "스킬 코어" 버튼 자리 (오른쪽 창 안 아래). */
const NAV_BTN = { x: 390, y: 242, w: 72, h: 14 };
/** 탐색에서 열었을 때 오른쪽 위 돌아가기 버튼 */
const BACK_BTN = { x: 404, y: 8, w: 66, h: 14 };

export function createP01Scene(): Scene {
  let current = 0;
  let sub: Sub = "stat";
  let mouse: LogicalPoint = { x: -1, y: -1 };
  let skillScroll = 0;
  /** 탐색 메뉴에서 열었으면 돌아갈 화면. 이때는 장비·코어를 바꿀 수 없다 (읽기 전용). */
  let backTo: string | null = null;
  /** 레벨·경험치 칸을 누르면 스킬 목록(P04) */
  const LV_AREA = { x: 14, y: 213, w: 132, h: 44 };
  /** 스킬 탭 "스킬 목록" 버튼 (스킬 코어 버튼 왼쪽) */
  const TREE_BTN = { x: 314, y: 242, w: 72, h: 14 };

  function hitRect(p: LogicalPoint, x: number, y: number, w: number, h: number) {
    return p.x >= x && p.x < x + w && p.y >= y && p.y < y + h;
  }
  function charTabRect(i: number) {
    return { x: 10 + i * 60, y: 6, w: 56, h: 18 };
  }
  function subTabRect(i: number) {
    return { x: 166 + i * 64, y: 32, w: 58, h: 14 };
  }
  function statLabelRect(i: number) {
    return { x: 166, y: STAT_Y0 + i * STAT_DY - 10, w: 36, h: 13 };
  }

  function onPointerDown(p: LogicalPoint, button: number) {
    if (button !== 0) return;
    if (hitRect(p, LV_AREA.x, LV_AREA.y, LV_AREA.w, LV_AREA.h) || (sub === "skill" && hitRect(p, TREE_BTN.x, TREE_BTN.y, TREE_BTN.w, TREE_BTN.h))) {
      goTo("p04", PARTY[current].name);
      return;
    }
    for (let i = 0; i < PARTY.length; i++) {
      const r = charTabRect(i);
      if (hitRect(p, r.x, r.y, r.w, r.h)) {
        current = i;
        skillScroll = 0;
        return;
      }
    }
    for (let i = 0; i < SUB_TABS.length; i++) {
      const r = subTabRect(i);
      if (hitRect(p, r.x, r.y, r.w, r.h)) {
        sub = SUB_TABS[i][0];
        skillScroll = 0;
        return;
      }
    }
    if (hitRect(p, BACK_BTN.x, BACK_BTN.y, BACK_BTN.w, BACK_BTN.h)) {
      goTo(backTo ?? "h01"); // 탐색 메뉴에서 왔으면 탐색으로, 아니면 거점으로
      return;
    }
    if (!backTo && sub !== "stat" && hitRect(p, NAV_BTN.x, NAV_BTN.y, NAV_BTN.w, NAV_BTN.h)) {
      goTo(sub === "equip" ? "p02" : "p03", PARTY[current].name);
    }
  }

  function onEnter() {
    // P02에서 돌아오면 거기서 고른 캐릭터를 그대로 보여준다.
    const back = takeNavBack();
    backTo = back; // 탭·거점에서 들어오면 null (변경 가능)
    const name = takeNavChar();
    const i = PARTY.findIndex((a) => a.name === name);
    if (i >= 0) current = i;
  }

  function hoveredStat(): StatKey | null {
    if (sub !== "stat") return null;
    const i = STAT_ORDER.findIndex((_, k) => {
      const r = statLabelRect(k);
      return hitRect(mouse, r.x, r.y, r.w, r.h);
    });
    return i < 0 ? null : STAT_ORDER[i];
  }

  function drawCharTabs() {
    PARTY.forEach((a, i) => {
      const r = charTabRect(i);
      R(r.x, r.y, r.w, r.h, i === current ? C.gold : C.woodL);
      R(r.x + 4, r.y + 3, 12, 12, a.color);
      T(r.x + 20, r.y + 13, a.name, 8, C.woodD);
    });
  }

  function drawStatPanel() {
    const a = PARTY[current];
    const bonus = bonusOf(a);

    // HP·MP: 원정 중이면 남은 값 / 최대치(장비·코어 포함). TP는 전투 밖에서 0이라 최대치만 칸으로.
    const fs = finalStats(a.name), vt = vitalsOf(a.name);
    T(168, 64, "HP", 8, C.sub);
    R(196, 58, 120, 6, C.cell);
    R(196, 58, Math.round((120 * vt.hp) / Math.max(1, fs.hp)), 6, C.hp);
    T(322, 64, `${vt.hp} / ${fs.hp}`, 8, C.txt);
    T(168, 76, "MP", 8, C.sub);
    R(196, 70, 120, 6, C.cell);
    R(196, 70, Math.round((120 * vt.mp) / Math.max(1, fs.mp)), 6, C.mp);
    T(322, 76, `${vt.mp} / ${fs.mp}`, 8, C.txt);
    T(168, 88, "TP", 8, C.sub);
    const gap = 2, cw = Math.floor((120 - gap * (fs.tpMax - 1)) / fs.tpMax);
    for (let i = 0; i < fs.tpMax; i++) R(196 + i * (cw + gap), 82, cw, 6, C.lim);
    T(322, 88, `최대 ${fs.tpMax}`, 8, C.txt);

    R(168, 94, 294, 1, C.woodD);

    const hov = hoveredStat();
    STAT_ORDER.forEach((k, i) => {
      const y = STAT_Y0 + i * STAT_DY;
      T(168, y, STAT_INFO[k].name, 8, k === hov ? C.gold : C.sub);
      T(240, y, String(a[k] + bonus[k]), 8, C.txt, "end");
      const b = bonus[k];
      if (b > 0) T(246, y, `+${b}`, 8, C.good);
      else if (b < 0) T(246, y, `−${-b}`, 8, C.hp);
      if (k === "agi") T(270, y, `턴 속도 ${turnSpeedOf(a[k] + bonus[k])}`, 7, C.sub);
    });

    R(168, 166, LEFT_END - 168, 1, C.woodD);
    drawAptitude(a, 172);

    T(AFF_LABEL_X, 106, "속성 상성", 8, C.sub);
    T(AFF_X, AFF_Y0 - 3, "Weak", 7, C.hp);
    T(AFF_X + 6 * 12 + 10, AFF_Y0 - 3, "Resist", 7, C.aura, "end");
    ELEMENT_ORDER.forEach((el, i) => {
      const y = AFF_Y0 + i * AFF_DY;
      const lv = affinityStep(a, el);
      T(AFF_LABEL_X, y + 8, ELEMENT_DEFS[el].label, 8);
      for (let k = 0; k < 7; k++) {
        const v = k - 3;
        let col: string = C.cell;
        if (v === 0) col = C.cellExt;
        else if (lv > 0 && v > 0 && v <= lv) col = C.aura;
        else if (lv < 0 && v < 0 && v >= lv) col = C.hp;
        R(AFF_X + k * 12, y, 10, 8, col);
      }
    });
  }

  // 툴팁 (ui-spec 4.6): 커서 오른쪽 아래 +12, 화면 밖이면 반대쪽으로.
  function drawStatTip() {
    const k = hoveredStat();
    if (!k) return;
    const a = PARTY[current];
    const lines = wrap(STAT_INFO[k].tip, 168, 7);
    if (k === "agi") lines.push(`턴 속도 ${turnSpeedOf(a.agi + bonusOf(a).agi)} · 턴 대기 시간 ${baseWaitOf(turnSpeedOf(a.agi + bonusOf(a).agi))}`);
    const title = STAT_INFO[k].name;
    const w = Math.ceil(Math.max(textWidth(title, 8), ...lines.map((l) => textWidth(l, 7)))) + 16;
    const h = (lines.length + 1) * 14 + 4;
    let x = mouse.x + 12;
    let y = mouse.y + 12;
    if (x + w > 480) x = mouse.x - 12 - w;
    if (y + h > 270) y = mouse.y - 12 - h;
    R(x, y, w, h, C.tipLine);
    R(x + 1, y + 1, w - 2, h - 2, C.tipBg);
    T(x + 8, y + 14, title, 8, C.txt);
    lines.forEach((l, i) => T(x + 8, y + 28 + i * 14, l, 7, C.sub));
  }

  // 장비 현황 (읽기 전용). 슬롯 표시는 P02 drawSlot과 같은 규칙 — 양손 무기로 막힌 칸은 '착용 불가'.
  function drawEquipSlot(s: SlotId | null, i: number) {
    if (!s) return;
    const lo = getLoadout(PARTY[current].name);
    const x = EQ_X[i % 3];
    const y = EQ_Y[Math.floor(i / 3)];
    const blocked = isBlocked(lo, s);
    const locked = isLocked(PARTY[current].name, s);
    R(x, y, EQ_W, EQ_H, blocked || locked ? C.cellLocked : C.listRow);
    T(x + 3, y + 9, SLOT_INFO[s].label, 7, C.sub);
    if (locked) {
      T(x + 3, y + 24, "잠김", 7, C.cellExt);
      return;
    }
    if (blocked) {
      R(x + 3, y + 13, 14, 14, equipByUid(lo.w0!)!.def.color, "opacity='.3'");
      T(x + 20, y + 24, "착용 불가", 7, C.cellExt);
      T(x + EQ_W - 3, y + 9, "양손", 7, C.cellExt, "end");
      return;
    }
    const d = lo[s] ? equipByUid(lo[s]!)?.def : undefined;
    if (!d) {
      R(x + 3, y + 13, 14, 14, C.cell);
      T(x + 20, y + 24, "비어 있음", 7, C.cellExt);
      return;
    }
    R(x + 3, y + 13, 14, 14, d.color);
    T(x + EQ_W - 3, y + 9, d.hands === 2 ? "양손" : fitText(modsText(d.mods, true), 52, 7), 7, d.hands === 2 ? C.gold : C.sub, "end");
    T(x + 20, y + 24, fitText(d.name, EQ_W - 23, 8), 8, C.txt);
  }

  function drawEquipPanel() {
    const a = PARTY[current];
    EQ_SLOTS.forEach(drawEquipSlot);
    R(168, 170, 294, 1, C.woodD);
    T(168, 186, "장비 보정", 8, C.sub);
    const b = equipBonus(getLoadout(a.name));
    const text = modsText(b);
    T(222, 186, text || "없음", 8, text ? C.txt : C.cellExt);
    if (!backTo) btn(NAV_BTN.x, NAV_BTN.y, NAV_BTN.w, "장비 변경");
    else T(NAV_BTN.x + NAV_BTN.w, NAV_BTN.y + 10, "탐색 중 변경 불가", 7, C.cellExt, "end");
  }

  function skillMaxScroll() {
    const total = skillItems(PARTY[current].name).reduce((sum, it) => sum + itemH(it), 0);
    return Math.max(0, total - SK.h);
  }

  // 스킬 목록: 출처 분류 묶음(제목 + 구분선) → 액티브(gold 띠) → 패시브(good 띠 + "패시브"). 코어 수정은 P03으로.
  function drawSkillPanel() {
    const items = skillItems(PARTY[current].name);
    skillScroll = Math.min(skillScroll, skillMaxScroll());
    const g = pen();
    g.save();
    g.beginPath();
    g.rect(SK.x, SK.y, SK.w, SK.h);
    g.clip();
    let y = SK.y - skillScroll;
    for (const it of items) {
      const h = itemH(it);
      if (y + h > SK.y && y < SK.y + SK.h) {
        if (it.kind === "head") {
          const n = `${it.n}개`;
          T(168, y + 11, it.label, 7, C.gold);
          T(460, y + 11, n, 7, C.sub, "end");
          const lx = 168 + Math.ceil(textWidth(it.label, 7)) + 6;
          R(lx, y + 7, 460 - Math.ceil(textWidth(n, 7)) - 6 - lx, 1, C.woodL);
        } else {
          const r = it.row;
          R(168, y + 3, 2, 20, r.passive ? C.good : C.gold);
          T(174, y + 11, r.name, 9, r.passive ? C.good : C.txt);
          T(460, y + 11, fitText(r.passive ? `패시브 · ${r.meta}` : r.meta, 150, 7), 7, C.sub, "end");
          T(174, y + 22, fitText(r.desc, 286, 7), 7, C.txt);
        }
      }
      y += h;
    }
    g.restore();
    if (!items.length) T(168, SK.y + 12, "스킬 없음", 7, C.cellExt);
    const max = skillMaxScroll();
    if (max > 0) {
      // 오른쪽 2px 스크롤 막대 (P02 목록과 같은 방식)
      const barH = Math.max(12, Math.round((SK.h * SK.h) / (SK.h + max)));
      R(SK.x + SK.w, SK.y, 2, SK.h, C.listRow);
      R(SK.x + SK.w, SK.y + Math.round(((SK.h - barH) * skillScroll) / max), 2, barH, C.woodL);
    }
    btn(TREE_BTN.x, TREE_BTN.y, TREE_BTN.w, "스킬 목록");
    if (!backTo) btn(NAV_BTN.x, NAV_BTN.y, NAV_BTN.w, "스킬 코어");
    else T(NAV_BTN.x + NAV_BTN.w, NAV_BTN.y + 10, "탐색 중에는 변경 불가", 7, C.cellExt, "end");
  }

  /** 도감(J01) 획득 경로 배지와 같은 모양: 바깥 woodD, 안쪽 listRowSel, 왼쪽 3px 색 띠. */
  function badge(x: number, y: number, label: string, dot: string) {
    const w = Math.ceil(textWidth(label, 7)) + 14;
    R(x, y, w, 14, C.woodD);
    R(x + 1, y + 1, w - 2, 12, C.listRowSel);
    R(x + 1, y + 1, 3, 12, dot);
    T(x + 3 + (w - 3) / 2, y + 10, label, 7, C.txt, "middle");
    return w;
  }

  // 적성 배지 (직업 / 무기 / 속성(있을 때만) / 보조). 능력치 탭의 주 스탯 아래, 왼쪽 단(LEFT_END)까지.
  function drawAptitude(a: AllyDef, y: number) {
    const X0 = 194;
    const MAX_X = LEFT_END;
    const apt = aptitudeOf(a.name);
    const rows: Array<[string, Array<[string, string]>]> = [
      ["직업", apt.jobs.map((j) => [j, C.gold])],
      ["무기", apt.weapons.map((w) => [w, PIECE.steel])],
      ["속성", apt.elements.map((e) => [e, ELEMENT_DEFS[ELEMENT_APT[e]?.[0] ?? "red"].color])],
      ["보조", apt.subs.map((s) => [s, C.node])],
    ];
    for (const [label, tags] of rows) {
      if (!tags.length) continue; // 속성 적성은 없을 수 있다
      T(168, y + 10, label, 7, C.sub);
      let x = X0;
      for (const [t, dot] of tags) {
        const w = Math.ceil(textWidth(t, 7)) + 14;
        if (x > X0 && x + w > MAX_X) {
          x = X0;
          y += 16;
        }
        x += badge(x, y, t, dot) + 3;
      }
      y += 18;
    }
  }

  // 왼쪽 캐릭터 패널: 위 직업 이름 → 캐릭터 이미지 자리(최대한 크게) → 맨 아래 레벨·경험치.
  function drawCharPanel(a: AllyDef) {
    W(10, 28, 140, 234, "");
    T(80, 44, a.name, 9, C.txt, "middle");
    // 전신 일러스트 120×156 (data/charArt.ts). 불러오기 전·없으면 자리표시
    R(20, 52, 120, 156, "#000000"); // 일러스트 배경: 검정 (2026-11-09)
    const art = charArt(a.name, "illust");
    if (!art || !img(20, 52, 120, 156, art, 1, true)) {
      R(60, 78, 40, 32, a.color);
      R(54, 110, 52, 76, a.color);
    }

    // 경험치는 B02 정산(engine/battleResult)과 같은 값. TODO(spec): 성장 곡선, P03 판 레벨과 합치기.
    // 바는 이전 모양 그대로 — 20칸 도트, 찬 칸 gold.
    const { lv, exp } = partyExp(a.name);
    const need = expToNext(lv);
    T(18, 224, `Lv ${lv}`, 9, C.txt);
    T(142, 224, `EXP ${Math.floor((exp / need) * 100)}%`, 7, C.sub, "end");
    const filled = Math.floor((exp / need) * 20);
    for (let i = 0; i < 20; i++) R(21 + i * 6, 230, 5, 5, i < filled ? C.gold : C.cell);
    T(18, 250, "다음 레벨까지", 7, C.sub);
    T(142, 250, `${need - exp} / ${need}`, 7, C.txt, "end");
    // 누르면 스킬 목록
    if (hitRect(mouse, LV_AREA.x, LV_AREA.y, LV_AREA.w, LV_AREA.h)) R(LV_AREA.x, LV_AREA.y, LV_AREA.w, LV_AREA.h, "none", "stroke='#ffffff' stroke-width='1'");
  }

  function draw() {
    const a = PARTY[current];
    R(0, 0, 480, 270, C.screenBg);
    drawCharTabs();

    drawCharPanel(a);

    W(156, 28, 314, 234, "", 1);
    SUB_TABS.forEach(([key, label], i) => {
      const r = subTabRect(i);
      R(r.x, r.y, r.w, r.h, key === sub ? C.gold : C.woodL);
      T(r.x + r.w / 2, r.y + 10, label, 7, C.woodD, "middle");
    });

    btn(BACK_BTN.x, BACK_BTN.y, BACK_BTN.w, backTo ? "◀ 탐색으로" : "◀ 거점으로");
    if (sub === "stat") {
      drawStatPanel();
      drawStatTip();
    } else if (sub === "equip") drawEquipPanel();
    else drawSkillPanel();
  }

  return {
    id: "p01",
    label: "P01 스테이터스",
    draw,
    onEnter,
    onPointerDown,
    onPointerMove: (p) => {
      mouse = p;
    },
    onWheel: (dy) => {
      if (sub !== "skill") return;
      skillScroll = Math.max(0, Math.min(skillMaxScroll(), skillScroll + (dy > 0 ? SK_ROW_H : -SK_ROW_H)));
    },
  };
}
