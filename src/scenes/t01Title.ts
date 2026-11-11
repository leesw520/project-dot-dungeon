// T01 시작 화면 (2026-11-08, docs/screens.md T01). 테스트 플레이(play 모드)는 여기서 시작한다.
// - 새로운 게임을 시작한다: 세이브를 지우고 새로고침 → 거점(H01)에서 시작 (기본 4직업 Lv1, Lv1 직업 코어 장착, 초기 거점·창고).
//   저장된 게임이 있으면 한 번 더 눌러 확인한다.
// - 이어하기: 저장된 게임이 있을 때. 원정 중이었으면 탐색(D01), 아니면 거점.
import { goTo } from "../engine/nav";
import { hasSave, resetSave } from "../engine/save";
import { C, R, T, btn } from "../render/primitives";
import { expeditionActive } from "./d01Explore";
import type { LogicalPoint, Scene } from "./types";

const NEW = { x: 160, y: 150, w: 160, h: 16 };
const CONT = { x: 160, y: 174, w: 160, h: 16 };

export function createT01Scene(): Scene {
  let confirm = false;
  let mouse: LogicalPoint = { x: -1, y: -1 };
  const hit = (p: LogicalPoint, r: typeof NEW) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

  function onPointerDown(p: LogicalPoint, button: number) {
    if (button !== 0) return;
    if (hit(p, NEW)) {
      if (hasSave() && !confirm) { confirm = true; return; }
      return resetSave("h01");
    }
    confirm = false;
    if (hit(p, CONT) && hasSave()) goTo(expeditionActive() ? "d01" : "h01");
  }

  function draw() {
    R(0, 0, 480, 270, C.screenBg);
    // 제목 띠와 도트 장식 (임시)
    for (let i = 0; i < 30; i++) R(i * 16, 0, 15, 3, i % 2 ? C.woodD : C.woodL);
    for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) R(204 + i * 8, 52 + j * 8, 7, 7, j === 1 ? C.gold : C.woodL);
    T(240, 106, "도트 던전", 20, C.gold, "middle");
    T(240, 124, "테스트 플레이", 8, C.sub, "middle");
    btn(NEW.x, NEW.y, NEW.w, confirm ? "저장된 게임을 지우고 시작" : "새로운 게임을 시작한다", hit(mouse, NEW) || confirm);
    const can = hasSave();
    if (can) btn(CONT.x, CONT.y, CONT.w, "이어하기", hit(mouse, CONT));
    else { R(CONT.x, CONT.y, CONT.w, CONT.h, C.cellLocked); T(CONT.x + CONT.w / 2, CONT.y + 11, "이어하기 (저장 없음)", 8, C.sub, "middle"); }
    if (confirm) T(240, 206, "한 번 더 누르면 지금 저장된 게임이 지워진다", 7, C.hp, "middle");
    T(240, 250, "기본 4직업 Lv1 · 거점에서 시작 · 이 브라우저에 자동 저장", 7, C.sub, "middle");
  }

  return {
    id: "t01", label: "T01 시작", draw, onPointerDown,
    onPointerMove: (p) => { mouse = p; },
    onEnter: () => { confirm = false; },
  };
}
