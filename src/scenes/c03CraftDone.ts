// C03 제작 완료 — 결과 카드 컴포넌트 + 진입 연출.
// 순서: 도면 실루엣(C02에서 채운 칸 색 그대로) → 칸이 제자리에서 하얗게 바래고 몇 번 점멸한다 → 흰 번쩍임과
// 함께 완성 아이콘이 튀어나오고, 화면 아래에서 오색 도트 조각이 폭죽처럼 터져 오른다 → 결과 카드가 올라온다.
// 모든 그리기 좌표는 정수로 반올림한다 (서브픽셀 금지).
import { getLastCraft, RECIPES, type CraftResult, type Recipe } from "../data/recipes";
import { gradeLabel, itemImage, KIND_LABEL, PIECES, pieceColors, type Cell } from "../data/pieces";
import { goTo, goToItem } from "../engine/nav";
import { createConfetti, rand } from "../render/confetti";
import { cached } from "../render/layerCache";
import { C, R, T, W, btn, img, piece } from "../render/primitives";
import type { LogicalPoint, Scene } from "./types";

const CX = 240;
const CY = 92;
const BLUEPRINT_CS = 10;
// 아이콘이 차지할 최대 한 변 (px). 칸 수가 많은 아이템일수록 칸 크기가 작아진다.
const ICON_MAX = 66;
// 아이템 그림(public/items/*.png, 256px 원본)을 그릴 한 변. 화면 배율 2라 실제 128px = 원본의 정확히 1/2.
const ICON_IMG = 64;

// 타임라인 (ms)
const WHITEN_START = 450;
const BLINK_START = 700;
// 점멸 한 번(흰색 ↔ 원래 색)의 반주기
const BLINK_HALF = 60;
const REVEAL = 1050;
const POP_END = 1350;
const WAVE2 = 1250;
const CARD_IN = 1500;
const CARD_END = 1800;

const CARD = { x: 130, y: 156, w: 220, h: 106 };

function easeOutBack(t: number) {
  const s = 2.2;
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function clamp01(t: number) {
  return Math.max(0, Math.min(1, t));
}

// 빛 모으기 알갱이. 자리·속도는 한 번만 정해 두고, 다시 볼 때도 같은 모양으로 모인다.
const GATHER_PERIOD = 420;
const GATHER_SPARKS = Array.from({ length: 40 }, (_, i) => ({
  a: (i / 40) * Math.PI * 2 + rand(-0.1, 0.1),
  r0: rand(50, 95),
  off: rand(0, 1),
  speed: rand(0.85, 1.3),
  color: i % 3 ? "#ffffff" : C.gold,
}));

export function createC03Scene(): Scene {
  let elapsed = 0;
  const confetti = createConfetti();
  let firedWave1 = false;
  let firedWave2 = false;
  let pointer: LogicalPoint = { x: 0, y: 0 };

  // C03 탭을 바로 눌러 들어온 경우(제작 이력 없음)에는 현재 레시피로 도면을 꾸며 연출만 보여준다.
  /** C02에서 실제로 제작한 결과만 보여준다 (배치한 칸별 색·달성 보너스). 없으면 안내 문구. */
  function result(): { recipe: Recipe; craft: CraftResult } | null {
    const last = getLastCraft();
    const recipe = last && RECIPES.find((r) => r.id === last.recipeId);
    return last && recipe ? { recipe, craft: last } : null;
  }

  function restart() {
    // 그림은 연출 앞부분(약 1초) 동안 미리 받아 둔다 — 크기 0으로 부르면 불러오기만 한다.
    const res = result();
    if (res) img(0, 0, 0, 0, itemImage(res.recipe.resultItemId));
    elapsed = 0;
    confetti.clear();
    firedWave1 = false;
    firedWave2 = false;
  }

  // ---- 폭죽 ----
  const burst = confetti.burst;

  const UP = -Math.PI / 2;
  function fireWave1() {
    burst(70, UP + 0.38, 0.28, 55, 0.68, 0.98);
    burst(410, UP - 0.38, 0.28, 55, 0.68, 0.98);
    burst(CX, UP, 0.55, 50, 0.55, 0.9);
  }
  function fireWave2() {
    burst(30, UP + 0.3, 0.2, 30, 0.62, 0.88);
    burst(450, UP - 0.3, 0.2, 30, 0.62, 0.88);
  }

  function tick(dt: number) {
    const step = Math.min(dt, 50);
    elapsed += step;
    if (!firedWave1 && elapsed >= REVEAL) {
      firedWave1 = true;
      fireWave1();
    }
    if (!firedWave2 && elapsed >= WAVE2) {
      firedWave2 = true;
      fireWave2();
    }
    confetti.tick(step);
  }

  // ---- 그리기 ----
  function iconMetrics(cells: Cell[]) {
    const w = Math.max(...cells.map(([c]) => c)) + 1;
    const h = Math.max(...cells.map(([, r]) => r)) + 1;
    const cs = Math.min(24, Math.floor(ICON_MAX / Math.max(w, h)));
    return { w, h, cs };
  }

  function drawBlueprint(craft: CraftResult) {
    const cols = craft.cells.map(({ cell }) => cell[0]);
    const rows = craft.cells.map(({ cell }) => cell[1]);
    const minC = Math.min(...cols);
    const minR = Math.min(...rows);
    const bw = (Math.max(...cols) - minC + 1) * BLUEPRINT_CS;
    const bh = (Math.max(...rows) - minR + 1) * BLUEPRINT_CS;
    // 칸은 제자리에 그대로 두고 흰색만 덮는다: 서서히 하얗게 바랜 뒤, 완전한 흰색과 반쯤 바랜 색 사이를 점멸한다.
    let white = clamp01((elapsed - WHITEN_START) / (BLINK_START - WHITEN_START)) * 0.85;
    if (elapsed >= BLINK_START) white = Math.floor((elapsed - BLINK_START) / BLINK_HALF) % 2 ? 0.45 : 1;

    const ox = Math.round(CX - bw / 2);
    const oy = Math.round(CY - bh / 2);
    craft.cells.forEach(({ cell, color }) => {
      const x = ox + (cell[0] - minC) * BLUEPRINT_CS;
      const y = oy + (cell[1] - minR) * BLUEPRINT_CS;
      R(x, y, BLUEPRINT_CS - 2, BLUEPRINT_CS - 2, color);
      if (white > 0) R(x, y, BLUEPRINT_CS - 2, BLUEPRINT_CS - 2, "#ffffff", `opacity='${white.toFixed(2)}'`);
      if (white < 1) R(x, y, BLUEPRINT_CS - 2, 2, "#ffffff", "opacity='.35'");
    });
  }

  // ---- 빛 모으기 (하얗게 바래기 ~ 점멸 구간) ----
  function pixelDisc(r: number, color: string, alpha: string) {
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.floor(Math.sqrt(r * r - dy * dy));
      R(CX - half, CY + dy, half * 2, 1, color, `opacity='${alpha}'`);
    }
  }

  function drawGatherGlow(time: number) {
    // 도면 뒤에 깔리는 빛 덩어리. 빛이 모일수록 커지고 진해진다.
    const t = clamp01((time - WHITEN_START) / (REVEAL - WHITEN_START));
    if (t <= 0) return;
    pixelDisc(Math.round(10 + t * 34), C.gold, (0.06 + t * 0.12).toFixed(2));
    pixelDisc(Math.round(4 + t * 18), C.txt, (t * 0.18).toFixed(2));
  }

  function drawGatherSparks(time: number) {
    if (time < WHITEN_START) return;
    const fadeIn = clamp01((time - WHITEN_START) / 150);
    // 사방에서 빛 알갱이가 꼬리를 끌며 가운데로 빨려 든다. 가까워질수록 빨라지고 밝아진다.
    GATHER_SPARKS.forEach((s) => {
      const p = (((time - WHITEN_START) * s.speed) / GATHER_PERIOD + s.off) % 1;
      const k = p * p;
      const cos = Math.cos(s.a);
      const sin = Math.sin(s.a);
      [0, 4, 8, 12].forEach((back, i) => {
        const r = s.r0 * (1 - k) + back * (0.4 + k);
        if (r < 4) return;
        const size = i === 0 ? 2 : 1;
        const alpha = (0.55 + 0.45 * p) * fadeIn * (1 - i * 0.3);
        R(Math.round(CX + cos * r - size / 2), Math.round(CY + sin * r - size / 2), size, size, s.color, `opacity='${alpha.toFixed(2)}'`);
      });
    });
    // 점멸 구간에는 픽셀 고리가 바깥에서 안으로 조여든다 (점멸 한 번에 고리 하나).
    if (time >= BLINK_START) {
      const rt = ((time - BLINK_START) % (BLINK_HALF * 2)) / (BLINK_HALF * 2);
      const r = 8 + (1 - easeOutCubic(rt)) * 56;
      const steps = Math.round(r * 1.6);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        R(Math.round(CX + Math.cos(a) * r), Math.round(CY + Math.sin(a) * r), 1, 1, C.gold, `opacity='${(0.5 + rt * 0.5).toFixed(2)}'`);
      }
    }
  }

  function drawHalo(time: number) {
    // 픽셀 원 후광 — 행마다 사각형 하나씩 쌓아 계단식 원을 만든다.
    // pulse는 -2~2 다섯 값뿐이라 줄 단위 사각형 ~170개를 값마다 한 번만 그려 두고 붙인다.
    const pulse = Math.round(Math.sin(time * 0.004) * 2);
    cached(`c03.halo:${pulse}`, CX - 49, CY - 49, 98, 98, () =>
      [
        { r: 46 + pulse, a: ".10" },
        { r: 36 + pulse, a: ".12" },
      ].forEach(({ r, a }) => {
        for (let dy = -r; dy <= r; dy++) {
          const half = Math.floor(Math.sqrt(r * r - dy * dy));
          R(CX - half, CY + dy, half * 2, 1, C.gold, `opacity='${a}'`);
        }
      })
    );
    // 천천히 도는 점선 광선
    const rot = time * 0.0005;
    for (let i = 0; i < 12; i++) {
      const a = rot + (i * Math.PI) / 6;
      const len = i % 2 ? 46 : 58;
      for (let d = 30; d <= len; d += 5) {
        R(Math.round(CX + Math.cos(a) * d) - 1, Math.round(CY + Math.sin(a) * d) - 1, 2, 2, C.gold, "opacity='.45'");
      }
    }
  }

  function drawSparkles(time: number) {
    // 4갈래 반짝임. 자리마다 주기를 엇갈려 하나씩 켜졌다 꺼진다.
    const spots: Array<[number, number]> = [
      [-48, -30], [44, -38], [56, 14], [-58, 20], [-24, 46], [30, 44], [6, -52],
    ];
    spots.forEach(([ox, oy], i) => {
      const t = ((time + i * 230) % 1400) / 1400;
      if (t > 0.5) return;
      const arm = t < 0.15 || t > 0.35 ? 1 : 3;
      const x = CX + ox;
      const y = CY + oy;
      R(x, y - arm, 1, arm * 2 + 1, C.txt);
      R(x - arm, y, arm * 2 + 1, 1, C.txt);
    });
  }

  function drawIcon(recipe: Recipe, time: number) {
    const d = PIECES[recipe.resultItemId];
    if (!d) return;
    const pop = easeOutBack(clamp01((time - REVEAL) / (POP_END - REVEAL)));
    // 완성 후에는 1px씩 위아래로 숨 쉬듯 떠 있는다.
    const bob = time > POP_END && Math.floor(time / 450) % 2 ? -1 : 0;
    // 그림이 있으면 그림, 없거나 아직 불러오는 중이면 조각 모양 자리표시.
    const s = Math.max(2, Math.round(ICON_IMG * pop));
    if (img(Math.round(CX - s / 2), Math.round(CY - s / 2) + bob, s, s, itemImage(d.id))) return;
    const { w, h, cs } = iconMetrics(d.cells);
    const c = Math.max(2, Math.round(cs * pop));
    const x = Math.round(CX - (w * c - 2) / 2);
    const y = Math.round(CY - (h * c - 2) / 2) + bob;
    piece(x, y, c, d.cells, pieceColors(d));
  }

  function drawRevealFx(time: number) {
    const t = (time - REVEAL) / 260;
    if (t >= 0 && t < 1) R(0, 0, 480, 270, "#ffffff", `opacity='${(0.7 * (1 - t)).toFixed(2)}'`);
    // 퍼져나가는 사각 고리
    const rt = (time - REVEAL) / 480;
    if (rt >= 0 && rt < 1) {
      const s = Math.round(20 + easeOutCubic(rt) * 120);
      R(CX - s / 2, CY - s / 2, s, s, "none", `stroke='${C.gold}' stroke-width='2' opacity='${(1 - rt).toFixed(2)}'`);
    }
  }

  function drawTitle(time: number) {
    if (time < REVEAL) return;
    const t = clamp01((time - REVEAL) / 420);
    const y = Math.round(-6 + easeOutBack(t) * 32);
    T(CX + 1, y + 1, "제작 완료!", 9, C.woodD, "middle");
    T(CX, y, "제작 완료!", 9, C.gold, "middle");
  }

  function cardOffset(time: number) {
    return Math.round((1 - easeOutCubic(clamp01((time - CARD_IN) / (CARD_END - CARD_IN)))) * 24);
  }
  // 완성품은 C02에서 이미 보유 목록(창고)에 들어가 있다. 장착은 P02/P03이 창고 목록을 보고 한다.
  function viewButtonRect(oy: number) {
    return { x: CARD.x + 16, y: CARD.y + 88 + oy, w: 90, h: 14 };
  }
  function storeButtonRect(oy: number) {
    return { x: CARD.x + 114, y: CARD.y + 88 + oy, w: 90, h: 14 };
  }

  function drawCard(recipe: Recipe, craft: CraftResult, time: number) {
    if (time < CARD_IN) return;
    const oy = cardOffset(time);
    const x = CARD.x;
    const y = CARD.y + oy;
    const d = PIECES[recipe.resultItemId];
    W(x, y, CARD.w, CARD.h, "획득");
    T(CX, y + 28, recipe.name, 9, C.txt, "middle");
    T(CX, y + 39, d ? `${gradeLabel(d.grade)} · ${KIND_LABEL[d.kind]}` : KIND_LABEL[recipe.kind], 7, C.sub, "middle");
    R(x + 10, y + 44, CARD.w - 20, 1, C.woodD);
    T(x + 12, y + 56, "기본 성능", 7, C.gold);
    T(x + CARD.w - 12, y + 56, recipe.previewStat, 8, C.txt, "end");
    T(x + 12, y + 70, "추가 옵션", 7, C.gold);
    if (!craft.bonuses.length) T(x + CARD.w - 12, y + 70, "없음", 7, C.sub, "end");
    craft.bonuses.slice(0, 2).forEach((b, i) => T(x + CARD.w - 12, y + 70 + i * 10, b, 8, C.good, "end"));

    const vw = viewButtonRect(oy);
    btn(vw.x, vw.y, vw.w, "창고에서 보기", true);
    const st = storeButtonRect(oy);
    btn(st.x, st.y, st.w, "제작 목록");
  }

  function draw() {
    R(0, 0, 480, 270, C.screenBg);
    const res = result();
    if (!res) {
      T(20, 30, "아직 제작한 아이템이 없어요 — C02에서 도면을 채우고 제작하세요", 8, C.sub);
      return;
    }
    const { recipe, craft } = res;
    if (elapsed < REVEAL) {
      drawGatherGlow(elapsed);
      drawBlueprint(craft);
      drawGatherSparks(elapsed);
    } else {
      drawHalo(elapsed);
      drawIcon(recipe, elapsed);
      if (elapsed > POP_END) drawSparkles(elapsed);
    }
    drawTitle(elapsed);
    drawCard(recipe, craft, elapsed);
    confetti.draw();
    drawRevealFx(elapsed);
    if (elapsed >= CARD_END) T(6, 266, "R 다시 보기 · 아이템 클릭 폭죽", 7, C.cellExt);
  }

  // ---- 입력 ----
  function hitRect(p: LogicalPoint, r: { x: number; y: number; w: number; h: number }) {
    return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
  }

  function onPointerDown(p: LogicalPoint, button: number) {
    if (button !== 0) return;
    pointer = p;
    // 연출 중 클릭은 건너뛰기. 아직 안 터진 폭죽은 tick에서 바로 터진다.
    if (elapsed < CARD_END) {
      elapsed = CARD_END;
      return;
    }
    const res = result();
    if (!res) return;
    if (hitRect(p, viewButtonRect(0))) {
      if (res.craft.resultUid) goToItem("h03", res.craft.resultUid);
      else goTo("h03");
      return;
    }
    if (hitRect(p, storeButtonRect(0))) {
      goTo("c01");
      return;
    }
    if (Math.abs(p.x - CX) < 40 && Math.abs(p.y - CY) < 40) {
      burst(pointer.x < CX ? 90 : 390, pointer.x < CX ? UP + 0.35 : UP - 0.35, 0.3, 40, 0.5, 0.72);
    }
  }

  function onKeyDown(key: string) {
    if (key === "r" || key === "R") restart();
  }

  return {
    id: "c03",
    label: "C03 제작 완료",
    draw,
    tick,
    // 진입 연출·폭죽은 매 프레임. 끝난 뒤의 후광·반짝임·둥실거림은 느려서 30fps로 충분하다.
    isAnimating: () => (!result() ? false : elapsed < CARD_END || confetti.count > 0 ? true : 33),
    onEnter: restart,
    onPointerDown,
    onKeyDown,
  };
}
