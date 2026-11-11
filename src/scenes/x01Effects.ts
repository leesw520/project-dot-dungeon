// X01 이펙트 샘플 (2026-11-07): 스킬 이펙트 확인용 개발 화면 (render/effects.ts). 문서: docs/art.md
// 위: 재생 (버튼 · 손대지 않으면 차례로 자동 재생). 아래: 고른 이펙트의 프레임 낱장.
import { createFx, type FxKind } from "../render/effects";
import { C, R, T, W, btn, pen } from "../render/primitives";
import type { LogicalPoint, Scene } from "./types";

const KINDS: Array<[FxKind, string]> = [["bolt", "번개"], ["fire", "화염"], ["frost", "냉기"], ["wind", "바람"], ["slash", "베기"], ["prism", "프리즘"], ["hit", "피격"]];
const FRAMES: Record<FxKind, number> = { bolt: 13, fire: 12, frost: 11, wind: 10, slash: 8, prism: 16, hit: 6 };
const BTN = (i: number) => ({ x: 14 + i * 52, y: 26, w: 48 });
const TARGET = { x: 240, y: 132 };

export function createX01Scene(): Scene {
  const fx = createFx();
  let auto = 0, autoIdx = 0;
  let pick: FxKind = "bolt";

  function draw() {
    R(0, 0, 480, 270, C.screenBg);
    T(8, 12, "X01 이펙트 — 45ms 프레임, 1px 사각형으로 그림 (버튼을 누르면 재생 · 아래는 프레임 낱장)", 7, C.gold);
    KINDS.forEach(([k, label], i) => { const b = BTN(i); btn(b.x, b.y, b.w, label, k === pick); });

    // 재생 칸: 대상 자리 표시만
    R(6, 44, 468, 100, "#1f2a48");
    R(TARGET.x - 10, TARGET.y - 24, 20, 24, "#3a4a70");
    R(TARGET.x - 14, TARGET.y, 28, 2, "#5a6a90");
    fx.draw();

    // 프레임 낱장
    W(6, 148, 468, 116, `프레임 낱장 — ${KINDS.find(([k]) => k === pick)![1]} (${FRAMES[pick]}프레임)`, 1);
    const n = FRAMES[pick], cw = 58, ch = 88, per = 8;
    const g = pen();
    for (let f = 0; f < n; f++) {
      const col = f % per, row = Math.floor(f / per);
      const scale = n > per ? 0.5 : 1;
      const x = 10 + col * cw, y = 160 + row * (ch * scale + 6);
      R(x, y, cw - 4, ch * scale, "#1f2a48");
      T(x + 2, y + 7, String(f + 1), 6, C.sub);
      const one = createFx();
      one.spawn(pick, 0, 0);
      one.tick(f * 45 + 1);
      g.save();
      g.beginPath();
      g.rect(x, y, cw - 4, ch * scale);
      g.clip();
      g.translate(x + (cw - 4) / 2, y + ch * scale - 8 * scale);
      g.scale(scale, scale);
      one.draw();
      g.restore();
    }
  }

  function onPointerDown(p: LogicalPoint, button: number) {
    if (button !== 0) return;
    KINDS.forEach(([k], i) => {
      const b = BTN(i);
      if (p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + 14) { pick = k; fx.spawn(k, TARGET.x, TARGET.y); auto = -2500; }
    });
  }

  return {
    id: "x01",
    label: "X01 이펙트",
    draw,
    tick: (dt) => {
      fx.tick(dt);
      if ((auto += dt) > 1100) { auto = 0; fx.spawn(KINDS[autoIdx][0], TARGET.x, TARGET.y); autoIdx = (autoIdx + 1) % KINDS.length; }
    },
    isAnimating: () => true,
    onPointerDown,
  };
}
