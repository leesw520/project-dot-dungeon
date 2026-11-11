// H05 신전 (2026-11-08, docs/skill-cores.md 1장). 거점에 신전을 지으면 "해금" 버튼으로 들어온다.
// 치유·축복 계열 액티브 스킬 코어를 골드로 해금한다 → 작업대에서 그 코어를 만들 수 있다 (코어 자체는 주지 않는다).
// 패시브(치유 숙련·치유의 물결·축문 강화 …)는 사제 레벨로 열린다.
import { getGold } from "../data/inventory";
import { TEMPLE_CORES, isTempleUnlocked, templeUnlock } from "../data/coreUnlock";
import { goTo } from "../engine/nav";
import { C, R, T, W, btn, fitText } from "../render/primitives";
import type { LogicalPoint, Scene } from "./types";

const BACK = { x: 382, y: 10, w: 78, h: 12 };
const rowRect = (i: number) => ({ x: 20, y: 52 + i * 34, w: 440, h: 30 });
const buyRect = (i: number) => ({ x: 380, y: 52 + i * 34 + 8, w: 70, h: 14 });

export function createH05Scene(): Scene {
  let message = "";
  const hit = (p: LogicalPoint, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

  function onPointerDown(p: LogicalPoint, button: number) {
    if (button !== 0) return;
    if (hit(p, BACK)) return goTo("h01");
    TEMPLE_CORES.forEach((t, i) => {
      if (!hit(p, buyRect(i)) || isTempleUnlocked(t.skill.id)) return;
      message = templeUnlock(t.skill.id) ? `${t.skill.name} 해금 — 작업대에서 만들 수 있다` : `골드가 모자라다 (${t.price} G 필요)`;
    });
  }

  function draw() {
    R(0, 0, 480, 270, C.screenBg);
    W(10, 8, 460, 254, "신전 — 기술 해금");
    R(BACK.x, BACK.y, BACK.w, BACK.h, C.woodL);
    T(BACK.x + BACK.w / 2, BACK.y + 10, "◀ 거점으로", 7, C.woodD, "middle");
    T(20, 38, "치유·축복의 기술을 배운다. 해금하면 작업대에서 그 코어를 만들 수 있다.", 7, C.sub);
    T(460, 38, `보유 ${getGold()} G`, 8, C.gold, "end");
    TEMPLE_CORES.forEach((t, i) => {
      const r = rowRect(i), done = isTempleUnlocked(t.skill.id);
      R(r.x, r.y, r.w, r.h, done ? C.listRowSel : C.listRow);
      T(r.x + 8, r.y + 12, `${t.skill.name}`, 8, done ? C.good : C.txt);
      T(r.x + 110, r.y + 12, `${t.skill.apt} · 액티브`, 7, C.sub);
      T(r.x + 8, r.y + 24, fitText(t.skill.lines.join(" "), 340, 7), 7, C.sub);
      const b = buyRect(i);
      if (done) T(b.x + b.w / 2, b.y + 10, "해금됨", 7, C.good, "middle");
      else btn(b.x, b.y, b.w, `${t.price} G`, getGold() >= t.price);
    });
    if (message) T(20, 252, message, 7, C.good);
  }

  return { id: "h05", label: "H05 신전", draw, onPointerDown, onEnter: () => { message = ""; } };
}
