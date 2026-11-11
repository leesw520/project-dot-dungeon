// J02 몬스터 도감 — 왼쪽 몬스터 목록, 오른쪽 상세(정체·약점/내성·사용 기술·드롭). docs/screens.md J02.
// 몬스터 DB(src/data/monsters.ts)를 그대로 읽는다. J01(아이템 도감)과 위쪽 버튼으로 오간다.
// 정지 화면이라 isAnimating 없음 — 입력이 있을 때만 다시 그린다 (ui-spec.md 9장).
// TODO(spec): 상성은 "처음 그 속성으로 맞혔을 때 공개"(character-system.md 2.5) — 지금은 전부 공개 상태로 보인다.
import type { FoeAct } from "../data/battle";
import { ELEMENT_DEFS, ELEMENT_ORDER } from "../data/itemTaxonomy";
import { MONSTER_DB, SIZE_LABEL, type MonsterRecord, type MonsterSize } from "../data/monsters";
import { PIECES, pieceColors } from "../data/pieces";
import { goTo } from "../engine/nav";
import { cached } from "../render/layerCache";
import { C, R, T, W, fitText, piece, textWidth } from "../render/primitives";
import type { LogicalPoint, Scene } from "./types";

type Hit = { x: number; y: number; w: number; h: number; key: string; fn?: () => void };

const LIST = { x: 16, y: 28, w: 122, row: 13 };
const ID = { x: 144, y: 26, w: 152, h: 104 };
const AFF = { x: 300, y: 26, w: 164, h: 104 };
const DESC = { x: 144, y: 134, w: 320, h: 36 };
const SKILL = { x: 144, y: 174, w: 320, h: 40 };
const DROP = { x: 144, y: 218, w: 320, h: 38 };
const SPR: Record<MonsterSize, [number, number]> = { small: [18, 20], medium: [24, 40], large: [32, 54], boss: [52, 56] };

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 폭 maxW 안에서 띄어쓰기 단위로 줄을 나눈다. 넘치는 줄은 마지막 줄에 …로 자른다. */
function wrap(s: string, maxW: number, lines: number, sz = 7): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of s.split(" ")) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, sz) <= maxW || !cur) cur = next;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  if (out.length > lines) out.splice(lines - 1, out.length, fitText(out.slice(lines - 1).join(" ") + " …", maxW, sz));
  return out.map((l) => fitText(l, maxW, sz));
}

/** 행동 한 칸을 사람이 읽는 말로. 예: "전체 마법 공격 (불꽃) 100%" */
export function describeAct(a: FoeAct): string {
  const kind = a.dmgType === "magic" ? "마법 공격" : "공격";
  const el = a.element ? ` (${ELEMENT_DEFS[a.element].label})` : "";
  const fx = a.effect ? `${a.effect.key} ${a.effect.v}${a.effect.key === "고양" || a.effect.key === "취약" || a.effect.key === "약화" ? "%" : ""} · ${a.effect.n}턴` : "";
  switch (a.k) {
    case "one": return `단일 ${kind}${el} ${a.pct}%`;
    case "multi": return `연속 ${kind}${el} ${a.pct}% × ${a.hits}회`;
    case "all": return `전체 ${kind}${el} ${a.pct}%`;
    case "row": return `${a.row === "b" ? "후열" : "전열"} ${kind}${el} ${a.pct}%`;
    case "aim": return `조준 ${kind}${el} ${a.pct}% (예고한 대상)`;
    case "guard": return "방어 (방어력만큼 방어도)";
    case "buff": return `강화: ${fx}${a.effect?.to === "self" ? " (자신)" : ""}`;
    case "debuff": return `약화: ${fx}`;
  }
}

export function createJ02Scene(): Scene {
  const list: MonsterRecord[] = Object.values(MONSTER_DB).sort((a, b) => a.dex.no - b.dex.no);
  let index = 0;
  let over = "";
  let hits: Hit[] = [];

  const hit = (x: number, y: number, w: number, h: number, key: string, fn?: () => void) => hits.push({ x, y, w, h, key, fn });
  const hitAt = (p: LogicalPoint) => {
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (p.x >= h.x && p.x < h.x + h.w && p.y >= h.y && p.y < h.y + h.h) return h;
    }
    return undefined;
  };
  const show = (i: number) => (index = (i + list.length) % list.length);

  function smallButton(x: number, y: number, w: number, label: string, key: string, fn: () => void) {
    R(x, y, w, 12, over === key ? C.gold : C.woodL);
    T(x + w / 2, y + 9, label, 7, C.woodD, "middle");
    hit(x, y, w, 12, key, fn);
  }
  function panel(x: number, y: number, w: number, h: number, title: string) {
    R(x, y, w, h, C.woodD);
    R(x + 1, y + 1, w - 2, h - 2, C.panelIn);
    T(x + 6, y + 10, title, 7, C.gold);
  }

  // 고정 레이어: 바탕, 큰 창, 목록 바탕, 상세 패널 네 개 틀과 제목
  function base() {
    R(0, 0, 480, 270, C.screenBg);
    W(10, 8, 460, 254, "몬스터 도감");
    R(LIST.x - 2, LIST.y - 2, LIST.w + 4, 230, C.woodD);
    R(LIST.x - 1, LIST.y - 1, LIST.w + 2, 228, C.listRow);
    panel(ID.x, ID.y, ID.w, ID.h, "정보");
    panel(AFF.x, AFF.y, AFF.w, AFF.h, "약점 · 내성");
    panel(DESC.x, DESC.y, DESC.w, DESC.h, "설명");
    panel(SKILL.x, SKILL.y, SKILL.w, SKILL.h, "사용 기술");
    panel(DROP.x, DROP.y, DROP.w, DROP.h, "드롭");
    T(AFF.x + 52, AFF.y + 20, "Weak", 7, C.hp);
    T(AFF.x + 52 + 6 * 12 + 10, AFF.y + 20, "Resist", 7, C.aura, "end");
  }

  function drawList() {
    list.forEach((m, i) => {
      const y = LIST.y + i * LIST.row, sel = i === index, hov = over === "row:" + i;
      if (sel || hov) R(LIST.x, y, LIST.w, LIST.row - 1, sel ? C.listRowSel : C.panelIn);
      if (sel) R(LIST.x, y, 2, LIST.row - 1, C.gold);
      R(LIST.x + 5, y + 3, 6, 6, m.color);
      T(LIST.x + 15, y + 9, `No.${String(m.dex.no).padStart(3, "0")}`, 7, C.sub);
      T(LIST.x + 52, y + 9, fitText(m.name, LIST.w - 56, 7), 7, sel ? C.gold : C.txt);
      hit(LIST.x, y, LIST.w, LIST.row - 1, "row:" + i, () => show(i));
    });
  }

  function drawIdentity(m: MonsterRecord) {
    const x = ID.x, y = ID.y;
    // 스프라이트 자리 — 크기에 따라 몸통 크기만 다르게 (B01 자리표시와 같은 모양)
    R(x + 6, y + 16, 58, 62, C.dark);
    const [w, h] = SPR[m.size], sx = x + 35 - Math.round(w / 2), sy = y + 74 - h;
    R(sx, sy, w, h, m.color);
    R(sx + Math.round(w / 4) - 2, sy + Math.min(Math.round(h / 4), 10), 3, 3, C.gold);
    R(sx + w - Math.round(w / 4) - 1, sy + Math.min(Math.round(h / 4), 10), 3, 3, C.gold);
    T(x + 70, y + 26, fitText(m.name, ID.w - 74, 9), 9, C.txt);
    const rw = ID.w - 74;
    T(x + 70, y + 38, fitText(`${SIZE_LABEL[m.size]} · Lv${m.lv}`, rw, 7), 7, C.sub);
    T(x + 70, y + 50, fitText(`경험치 ${m.exp}`, rw, 7), 7, C.good);
    // 고정 수치. 큰 수치(보스)도 칸 안에 들어가게 두 줄로 나누고 폭을 자른다
    const s = m.stats, tw = ID.w - 12;
    T(x + 6, y + 89, fitText(`HP ${s.hp}`, tw, 7), 7, C.sub);
    T(x + 6, y + 99, fitText(`공 ${s.atk} · 주 ${s.spl} · 방 ${s.def} · 민 ${s.agi}`, tw, 7), 7, C.sub);
  }

  function drawAffinity(m: MonsterRecord) {
    const x0 = AFF.x + 52;
    ELEMENT_ORDER.forEach((el, i) => {
      const y = AFF.y + 25 + i * 11;
      const v = m.affinity[el];
      T(AFF.x + 8, y + 7, ELEMENT_DEFS[el].label, 7, v != null && v !== 0 ? C.txt : C.sub);
      if (v === "null" || v === "absorb") {
        // 무효·흡수는 단계 밖 — 막대 대신 글자 (character-system.md 2.5)
        R(x0, y, 82, 8, C.dark);
        T(x0 + 41, y + 7, v === "null" ? "무효 ✕" : "흡수 ♥", 7, C.aura, "middle");
        return;
      }
      const lv = v ?? 0;
      for (let k = 0; k < 7; k++) {
        const s = k - 3;
        let col: string = s === 0 ? C.cellExt : C.cell;
        if (lv > 0 && s > 0 && s <= lv) col = C.aura;
        else if (lv < 0 && s < 0 && s >= lv) col = C.hp;
        R(x0 + k * 12, y, 10, 8, col);
      }
    });
  }

  function drawSkills(m: MonsterRecord) {
    m.pattern.slice(0, 4).forEach((a, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = SKILL.x + 8 + col * 156, y = SKILL.y + 22 + row * 11;
      T(x, y, `${i + 1}.`, 7, C.gold);
      T(x + 12, y, fitText(describeAct(a), 140, 7), 7, C.txt);
    });
    // 행동은 매 차례 이 중 하나를 무작위로 고른다 (patternMode "random"). TODO(spec): 5개 이상이면 스크롤, 가중치 표시
  }

  /** 드롭 (2026-11-08): 위 줄 소재, 아래 줄 코어 조각·스킬 코어 — 이 적에게서 무엇을 얻는지 한눈에 */
  function drawDrops(m: MonsterRecord) {
    const rows = [m.drops, m.coreDrops ?? []];
    if (!rows[0].length && !rows[1].length) T(DROP.x + 8, DROP.y + 26, "없음", 7, C.sub);
    rows.forEach((list, ri) =>
      list.slice(0, 4).forEach((d, i) => {
        const x = DROP.x + 6 + i * 78, y = DROP.y + 13 + ri * 12;
        smallDropIcon(d.itemId, x, y);
        T(x + 13, y + 9, fitText(PIECES[d.itemId]?.name ?? d.itemId, 44, 6), 6, C.txt);
        T(x + 74, y + 9, pct(d.chance), 6, d.chance >= 1 ? C.gold : C.good, "end");
      })
    );
  }
  function smallDropIcon(id: string, x: number, y: number) {
    R(x, y, 11, 11, C.listRow);
    const d = PIECES[id];
    if (!d) return;
    const w = Math.max(...d.cells.map(([c]) => c)) + 1, h = Math.max(...d.cells.map(([, r]) => r)) + 1;
    const cs = Math.max(2, Math.floor(10 / Math.max(w, h)));
    piece(Math.round(x + 6 - (w * cs) / 2), Math.round(y + 6 - (h * cs) / 2), cs, d.cells, pieceColors(d));
  }

  function draw() {
    hits = [];
    cached("j02.base", 0, 0, 480, 270, base);
    const m = list[index];
    smallButton(240, 10, 18, "◀", "prev", () => show(index - 1));
    T(282, 19, `${index + 1} / ${list.length}`, 7, C.woodD, "middle");
    smallButton(306, 10, 18, "▶", "next", () => show(index + 1));
    smallButton(334, 10, 64, "아이템 도감", "j01", () => goTo("j01"));
    smallButton(402, 10, 64, "◀ 거점으로", "h01", () => goTo("h01"));
    drawList();
    drawIdentity(m);
    drawAffinity(m);
    drawSkills(m);
    drawDrops(m);
    wrap(m.dex.desc, DESC.w - 12, 2).forEach((l, i) => T(DESC.x + 6, DESC.y + 21 + i * 10, l, 7, C.txt));
  }

  return {
    id: "j02",
    label: "J02 몬스터 도감",
    draw,
    onPointerMove: (p) => { over = hitAt(p)?.key ?? ""; },
    onPointerDown: (p, button) => { if (button === 0) hitAt(p)?.fn?.(); },
    onKeyDown: (k) => {
      if (k === "ArrowUp" || k === "ArrowLeft") show(index - 1);
      else if (k === "ArrowDown" || k === "ArrowRight") show(index + 1);
    },
  };
}
