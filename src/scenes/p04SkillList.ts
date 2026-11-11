// P04 스킬 목록 (2026-11-09, docs/screens.md P04). 스킬 트리를 없애고, 이 캐릭터가 배울 수 있는 스킬 전체를 보여 준다.
// P01의 레벨 칸이나 스킬 탭 "스킬 목록"으로 들어온다. 적성(직업·무기·속성·하위) 묶음마다 액티브 → 패시브 순, 변형은 그 스킬 아래.
// 줄 표시: 지금 판에 꽂혀 있으면 "장착", 해금되지 않았으면 해금 방법(신전·원정). 휠로 스크롤.
import { PARTY } from "../data/battle";
import { aptitudeOf, aptElements, type CoreReq } from "../data/aptitude";
import { CLASS_KEYS, CLASS_NAME, classKeyOf, type ClassKey } from "../data/skills";
import { SKILL_BOOK, type SkillDef } from "../data/skillbook";
import { CORE_MODES } from "../data/coreModes";
import { VARIANTS } from "../data/coreVariants";
import { coreLockText } from "../data/coreUnlock";
import { equippedSkills } from "../engine/party";
import { goTo, takeNavChar } from "../engine/nav";
import { C, R, T, W, btn, fitText, pen, textWidth } from "../render/primitives";
import type { LogicalPoint, Scene } from "./types";

const BACK = { x: 398, y: 8, w: 70, h: 14 };
const LIST = { x: 14, y: 30, w: 450, h: 228 };
const HEAD_H = 16, ROW_H = 34, MODE_H = 22;
const GROUP_ORDER: CoreReq["type"][] = ["job", "weapon", "element", "sub"];
const TYPE_LABEL: Record<string, string> = { job: "직업", weapon: "무기", element: "속성", sub: "하위" };

type Item =
  | { kind: "head"; label: string; n: number }
  | { kind: "row"; s: SkillDef }
  | { kind: "mode"; s: SkillDef; mode: string; effect: string };

/** 이 직업이 장착할 수 있는 스킬 (직업 전용 + 무기·속성·하위 적성) */
function usableBy(name: string, s: SkillDef): boolean {
  const a = aptitudeOf(name);
  const tags = s.req.type === "common" ? [] : (s.req.tags as string[]);
  if (s.req.type === "job") return tags.includes(name);
  if (s.req.type === "weapon") return tags.some((t) => a.weapons.includes(t));
  if (s.req.type === "element") return tags.some((t) => (aptElements(a.elements) as string[]).includes(t));
  if (s.req.type === "sub") return tags.some((t) => a.subs.includes(t));
  return false;
}

function itemsOf(name: string): Item[] {
  const groups = new Map<string, { type: CoreReq["type"]; list: SkillDef[] }>();
  for (const s of SKILL_BOOK) {
    if (!usableBy(name, s)) continue;
    if (!groups.has(s.apt)) groups.set(s.apt, { type: s.req.type, list: [] });
    groups.get(s.apt)!.list.push(s);
  }
  const out: Item[] = [];
  const order = [...groups.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[1].type) - GROUP_ORDER.indexOf(b[1].type));
  for (const [apt, g] of order) {
    const list = g.list.sort((x, y) => +!!x.passive - +!!y.passive);
    out.push({ kind: "head", label: `${TYPE_LABEL[g.type] ?? ""} 적성: ${apt}`, n: list.length });
    for (const s of list) {
      out.push({ kind: "row", s });
      // 변형 (전투 정의가 있는 것만): 그 스킬 코어를 만들 때 고르는 효과 변형
      for (const m of CORE_MODES.filter((x) => x.skill === s.id && VARIANTS[`${x.skill}:${x.mode}`])) out.push({ kind: "mode", s, mode: m.mode, effect: m.effect });
    }
  }
  return out;
}
const hOf = (it: Item) => (it.kind === "head" ? HEAD_H : it.kind === "row" ? ROW_H : MODE_H);
const costText = (s: SkillDef) =>
  s.cost?.tp === "all" ? "TP 전량" : s.cost?.tp ? `TP ${s.cost.tp}` : s.cost?.mp === "all" ? "MP 전량" : s.cost?.mpPct ? `최대 MP ${s.cost.mpPct}%` : s.cost?.mp ? `MP ${s.cost.mp}` : "";

export function createP04Scene(): Scene {
  let cls: ClassKey = "knight";
  let scroll = 0;
  let mouse: LogicalPoint = { x: -1, y: -1 };
  const charTab = (i: number) => ({ x: 10 + i * 50, y: 8, w: 46, h: 14 });
  const hit = (p: LogicalPoint, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
  const items = () => itemsOf(CLASS_NAME[cls]);
  const maxScroll = () => Math.max(0, items().reduce((t, it) => t + hOf(it), 0) - LIST.h);

  function onPointerDown(p: LogicalPoint, button: number) {
    if (button !== 0) return;
    if (hit(p, BACK)) return goTo("p01", CLASS_NAME[cls]);
    for (let i = 0; i < CLASS_KEYS.length; i++)
      if (hit(p, charTab(i))) {
        cls = CLASS_KEYS[i];
        scroll = 0;
        return;
      }
  }

  function draw() {
    R(0, 0, 480, 270, C.screenBg);
    W(4, 4, 472, 262, "", 1);
    PARTY.forEach((a, i) => {
      const r = charTab(i), k = CLASS_KEYS[i];
      R(r.x, r.y, r.w, r.h, k === cls ? C.gold : C.woodL);
      T(r.x + r.w / 2, r.y + 10, a.name, 7, C.woodD, "middle");
    });
    const list = items();
    const total = list.filter((x) => x.kind === "row").length;
    T(216, 18, `배울 수 있는 스킬 ${total}개`, 7, C.gold);
    btn(BACK.x, BACK.y, BACK.w, "◀ 돌아가기", hit(mouse, BACK));

    const equipped = new Set(equippedSkills(CLASS_NAME[cls]).map((s) => s.id));
    scroll = Math.min(scroll, maxScroll());
    const g = pen();
    g.save();
    g.beginPath();
    g.rect(LIST.x, LIST.y, LIST.w, LIST.h);
    g.clip();
    let y = LIST.y - scroll;
    const x0 = LIST.x + 4, x1 = LIST.x + LIST.w - 6;
    for (const it of list) {
      const h = hOf(it);
      if (y + h > LIST.y && y < LIST.y + LIST.h) {
        if (it.kind === "head") {
          const n = `${it.n}개`;
          T(x0, y + 11, it.label, 7, C.gold);
          T(x1, y + 11, n, 7, C.sub, "end");
          const lx = x0 + Math.ceil(textWidth(it.label, 7)) + 6;
          R(lx, y + 7, x1 - Math.ceil(textWidth(n, 7)) - 6 - lx, 1, C.woodL);
        } else if (it.kind === "row") {
          const s = it.s, lock = coreLockText(s.id), on = equipped.has(s.id);
          R(x0, y + 3, 2, ROW_H - 6, s.passive ? C.good : C.gold);
          T(x0 + 6, y + 12, s.name, 9, lock ? C.sub : s.passive ? C.good : C.txt);
          const meta = s.passive ? "패시브" : [costText(s), s.cd ? `재사용 ${s.cd}턴` : ""].filter(Boolean).join(" · ") || "액티브";
          T(x0 + 12 + Math.ceil(textWidth(s.name, 9)), y + 12, meta, 7, C.sub);
          if (on) T(x1, y + 12, "장착", 7, C.good, "end");
          else if (lock) T(x1, y + 12, lock, 7, C.hp, "end");
          const desc = s.lines.join(" ");
          wrap(desc, x1 - x0 - 8).slice(0, 2).forEach((l, k) => T(x0 + 6, y + 23 + k * 9, l, 7, lock ? C.sub : C.txt));
        } else {
          R(x0 + 10, y + 2, 1, MODE_H - 4, C.woodL);
          T(x0 + 16, y + 10, `변형 · ${it.mode}`, 7, C.gold);
          T(x0 + 16, y + 19, fitText(it.effect.replace(/ \/ /g, " · "), x1 - x0 - 20, 7), 7, C.sub);
        }
      }
      y += h;
    }
    g.restore();
    const max = maxScroll();
    if (max > 0) {
      const barH = Math.max(12, Math.round((LIST.h * LIST.h) / (LIST.h + max)));
      R(LIST.x + LIST.w, LIST.y, 2, LIST.h, C.listRow);
      R(LIST.x + LIST.w, LIST.y + Math.round(((LIST.h - barH) * scroll) / max), 2, barH, C.woodL);
    }
  }
  function wrap(text: string, w: number): string[] {
    const out: string[] = [];
    let line = "";
    for (const ch of text) {
      if (textWidth(line + ch, 7) > w) { out.push(line); line = ""; }
      line += ch;
    }
    if (line) out.push(line);
    return out;
  }

  return {
    id: "p04", label: "P04 스킬 목록", draw, onPointerDown,
    onPointerMove: (p) => { mouse = p; },
    onWheel: (dy) => { scroll = Math.max(0, Math.min(maxScroll(), scroll + (dy > 0 ? ROW_H : -ROW_H))); },
    onEnter: () => {
      const name = takeNavChar();
      const k = name ? classKeyOf(name) : null;
      if (k) cls = k;
      scroll = 0;
    },
  };
}
