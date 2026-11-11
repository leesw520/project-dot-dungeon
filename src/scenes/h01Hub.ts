// H01 거점 — 2026-11-07 마을판 (docs/screens.md H01). 걷기 없음, 건물을 클릭해 화면을 옮긴다.
// - 2026-11-09: 고정 배경 그림(public/hub/hub_bg.webp) 위 부지 11곳(S01~S11)에 건물 그림을 얹는다. 던전 게이트는 배경 왼쪽 위에
//   그려진 고정 건물 (data/facilities.ts PLOTS·HUB_ART).
// - 2026-11-09 (사용자): 건설·업그레이드는 막아 두고 모든 시설을 지어진 상태로 둔다. 업그레이드는 나중에 시설 화면 안에서.
//   건물에 마우스를 올리면 그림 테두리가 하얗게 + 이름표. 클릭하면 그 시설 화면으로, 화면이 없는 시설은 "준비 중입니다" 창.
//   (옛 건설 모드 — 목록·짓기·옮기기 — 는 화면에서 뺐다. 데이터 쪽 build·moveFacility는 남아 있다.)
// - 머리띠: 왼쪽 캐릭터 관련(파티·편성), 오른쪽 창고·백업.
import { getGold } from "../data/inventory";
import { ensureStarterGear } from "../data/equipment";
import { ensureStartCores } from "../data/skillCores";
import { GATE_PLOT, HUB_ART, HUB_BG, PLOTS, artRect, facilityAt, facilityDef, hubArtSrc } from "../data/facilities";
import { goTo, goToWithBack } from "../engine/nav";
import { exportSave, importSave, resetSave, saveInfo } from "../engine/save";
import { cached } from "../render/layerCache";
import { C, R, T, W, btn, img, imgOutline, imgReady, textWidth } from "../render/primitives";
import { takeExpeditionResult } from "./d01Explore";
import type { LogicalPoint, Scene } from "./types";

/** 시설 화면. 없는 시설은 클릭하면 "준비 중입니다" (TODO(spec): 시설별 기능). */
const OPEN: Record<string, () => void> = {
  workshop: () => goTo("c01"),
  warehouse: () => goTo("h03"),
  gate: () => goTo("h04"), // 던전 게이트: 출발 준비(H04)에서 가방을 챙긴 뒤 원정 시작
};
const BG = HUB_BG;

type Rect = { x: number; y: number; w: number; h: number };
const inR = (p: LogicalPoint | null, r: Rect) => !!p && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

// 머리띠 버튼
const B_PARTY = { x: 2, y: 1, w: 44, h: 14 };
const B_FORM = { x: 48, y: 1, w: 44, h: 14 };
const B_STORE = { x: 378, y: 1, w: 46, h: 14 }; // 창고
const B_BACKUP = { x: 426, y: 1, w: 50, h: 14 }; // 백업 (진행은 자동 저장 — 파일 내보내기·가져오기·처음부터)

// 팝업 (준비 중 · 백업)
const CLOSE_W = 50;
type Popup = { kind: "wip"; id: string } | { kind: "save"; confirmReset: boolean };

/** 지어진 건물 (그리는 순서: 위쪽 부지 → 아래쪽 부지, 아래 건물이 위 건물을 덮는다) */
function builtPlots(): number[] {
  return PLOTS.map((_, i) => i)
    .filter((i) => {
      const id = facilityAt(i);
      return !!id && !facilityDef(id)?.hidden;
    })
    .sort((a, b) => PLOTS[a].y + PLOTS[a].h - (PLOTS[b].y + PLOTS[b].h));
}
/** 건물이 차지하는 자리 (게이트는 배경의 게이트 영역) */
const hitRect = (i: number): Rect => (i === GATE_PLOT ? PLOTS[i] : artRect(facilityAt(i)!, i));

export function createH01Scene(): Scene {
  let popup: Popup | null = null;
  let mouse: LogicalPoint | null = null;
  let message = "";
  let messageTimer = 0;

  function flashMessage(text: string) {
    message = text;
    messageTimer = 3200;
  }

  /** 마우스 아래 건물의 터 (없으면 −1). 겹치면 나중에 그린(아래쪽) 건물이 먼저. */
  function hovered(): number {
    if (!mouse || popup || mouse.y < 16) return -1;
    const list = builtPlots();
    for (let k = list.length - 1; k >= 0; k--) if (inR(mouse, hitRect(list[k]))) return list[k];
    return -1;
  }

  // ---- 팝업 ----
  const popupRect = (pp: Popup): Rect => (pp.kind === "wip" ? { x: 160, y: 100, w: 160, h: 66 } : { x: 70, y: 30, w: 340, h: 132 });
  const closeRect = (pp: Popup): Rect => {
    const r = popupRect(pp);
    return pp.kind === "wip" ? { x: r.x + r.w / 2 - CLOSE_W / 2, y: r.y + r.h - 20, w: CLOSE_W, h: 14 } : { x: r.x + r.w - CLOSE_W - 8, y: r.y + r.h - 20, w: CLOSE_W, h: 14 };
  };
  const saveBtn = (k: number): Rect => ({ x: 80 + (k % 2) * 130, y: 104 + Math.floor(k / 2) * 18, w: 124, h: 14 });

  function onPopupClick(pp: Popup, p: LogicalPoint) {
    if (inR(p, closeRect(pp)) || !inR(p, popupRect(pp))) {
      popup = null;
      return;
    }
    if (pp.kind !== "save") return;
    if (pp.confirmReset) {
      if (inR(p, saveBtn(2))) resetSave();
      else if (inR(p, saveBtn(3))) pp.confirmReset = false;
      return;
    }
    if (inR(p, saveBtn(0))) exportSave();
    else if (inR(p, saveBtn(1))) importSave((msg) => flashMessage(msg));
    else if (inR(p, saveBtn(2))) pp.confirmReset = true;
  }

  // ---- 클릭 ----
  function onHeaderClick(p: LogicalPoint): boolean {
    if (p.y >= 16) return false;
    if (inR(p, B_PARTY)) goTo("p01");
    else if (inR(p, B_FORM)) goToWithBack("d06", "h01");
    else if (inR(p, B_STORE)) goTo("h03");
    else if (inR(p, B_BACKUP)) popup = { kind: "save", confirmReset: false };
    return true;
  }

  function onPointerDown(p: LogicalPoint, button: number) {
    mouse = p;
    if (button === 2) {
      popup = null;
      return;
    }
    if (button !== 0) return;
    if (popup) return onPopupClick(popup, p);
    if (onHeaderClick(p)) return;
    const i = hovered();
    if (i < 0) return;
    const id = facilityAt(i)!;
    if (OPEN[id]) OPEN[id]();
    else popup = { kind: "wip", id };
  }

  function onKeyDown(key: string) {
    if (key === "Escape") popup = null;
  }

  // ---- 그리기 ----
  function drawBuilding(i: number) {
    const id = facilityAt(i)!;
    if (i === GATE_PLOT) return; // 배경에 그려져 있다
    const a = artRect(id, i);
    const art = HUB_ART[id];
    if (art) img(a.x, a.y, a.w, a.h, hubArtSrc(art.file), 1, true); // 아직 불러오는 중이면 비워 둔다 (시작할 때 미리 불러온다)
  }

  // 배경 + 건물은 배치·그림 로딩이 바뀔 때만 다시 그린다 (고정 레이어).
  function drawGround() {
    if (!img(0, 0, 480, 270, BG, 1, true)) R(0, 0, 480, 270, C.screenBg); // 불러오는 중: 어두운 바탕 (갈색 화면 없음)
    builtPlots().forEach(drawBuilding);
  }
  const groundKey = () =>
    builtPlots()
      .map((i) => {
        const id = facilityAt(i)!;
        return `${i}:${id}${HUB_ART[id] && imgReady(hubArtSrc(HUB_ART[id].file)) ? "" : "?"}`;
      })
      .join(",") + (imgReady(BG) ? "" : "?");

  /** 건물 위에 올린 마우스: 그림 테두리 흰색 + 이름표 */
  function drawHover(i: number) {
    const id = facilityAt(i)!;
    const def = facilityDef(id)!;
    const r = hitRect(i);
    if (i === GATE_PLOT) R(r.x - 1, r.y - 1, r.w + 2, r.h + 2, "none", "stroke='#ffffff' stroke-width='1'");
    else {
      const src = hubArtSrc(HUB_ART[id].file);
      if (imgOutline(r.x, r.y, r.w, r.h, src, "#ffffff", 1)) img(r.x, r.y, r.w, r.h, src, 1, true);
    }
    const label = def.name;
    const lw = Math.ceil(textWidth(label, 7)) + 8;
    const top = Math.max(17, r.y - 12);
    const lx = Math.max(2, Math.min(478 - lw, r.x + r.w / 2 - lw / 2));
    R(lx, top, lw, 11, C.dark, "opacity='.85'");
    T(lx + lw / 2, top + 8, label, 7, C.gold, "middle");
  }

  function drawHeader() {
    const hov = (r: Rect) => inR(mouse, r) && !popup;
    R(0, 0, 480, 16, C.dark);
    T(98, 11, "거점 · 건물을 클릭해 시설로", 7, C.gold);
    T(B_STORE.x - 6, 11, `${getGold()} G`, 7, C.gold, "end"); // 골드 (전투로 얻는다)
    btn(B_PARTY.x, B_PARTY.y, B_PARTY.w, "파티", hov(B_PARTY));
    btn(B_FORM.x, B_FORM.y, B_FORM.w, "편성", hov(B_FORM));
    btn(B_STORE.x, B_STORE.y, B_STORE.w, "창고", hov(B_STORE));
    btn(B_BACKUP.x, B_BACKUP.y, B_BACKUP.w, "백업", hov(B_BACKUP));
  }

  function drawPopup(pp: Popup) {
    const r = popupRect(pp);
    R(0, 0, 480, 270, C.screenBg, "opacity='.6'");
    const hov = (b: Rect) => inR(mouse, b);
    if (pp.kind === "wip") {
      W(r.x, r.y, r.w, r.h, facilityDef(pp.id)?.name ?? "", 1);
      T(r.x + r.w / 2, r.y + 34, "준비 중입니다", 8, C.txt, "middle");
    } else {
      W(r.x, r.y, r.w, r.h, "백업", 1);
      const info = saveInfo();
      T(r.x + 10, r.y + 30, "진행은 자동으로 저장된다. 따로 저장할 필요 없다.", 7, C.txt);
      const d = new Date(info.lastSavedAt);
      const t = info.lastSavedAt ? [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":") : "아직 없음";
      T(r.x + 10, r.y + 44, `마지막 저장 ${t}`, 7, C.sub);
      if (info.error) T(r.x + 10, r.y + 58, info.error, 7, C.hp);
      else T(r.x + 10, r.y + 58, "다른 기기로 옮기거나 백업할 때만 파일로", 7, C.sub);
      if (pp.confirmReset) {
        T(r.x + 10, r.y + 102, "저장된 진행을 지우고 처음부터 시작할까?", 7, C.hp);
        T(r.x + 10, r.y + 114, "되돌릴 수 없다 (내보낸 파일로만 복구)", 7, C.sub);
        const b2 = saveBtn(2);
        const b3 = saveBtn(3);
        btn(b2.x, b2.y, b2.w, "지운다", hov(b2));
        btn(b3.x, b3.y, b3.w, "취소", hov(b3));
      } else {
        ["파일로 내보내기", "파일 가져오기", "처음부터"].forEach((s, k) => {
          const b = saveBtn(k);
          btn(b.x, b.y, b.w, s, hov(b));
        });
      }
    }
    const c = closeRect(pp);
    btn(c.x, c.y, c.w, "닫기", hov(c));
  }

  function draw() {
    cached(`h01.ground:${groundKey()}`, 0, 0, 480, 270, drawGround);
    const h = hovered();
    if (h >= 0) drawHover(h);
    drawHeader();
    if (messageTimer > 0) {
      R(120, 256, 240, 13, C.dark, "opacity='.85'");
      T(240, 265, message, 7, C.gold, "middle");
    }
    if (popup) drawPopup(popup);
  }

  return {
    id: "h01",
    label: "H01 거점",
    draw,
    tick: (dt) => {
      if (messageTimer > 0) messageTimer = Math.max(0, messageTimer - dt);
    },
    // 움직이는 것은 안내 문구뿐 — 사라질 때를 맞추려고 10fps.
    isAnimating: () => (messageTimer > 0 ? 100 : false),
    onPointerDown,
    onPointerMove: (p) => {
      mouse = p;
    },
    // 원정에서 돌아오면 결과를 안내한다 (TODO(spec): 거점 회복 규칙).
    onEnter: () => {
      popup = null;
      const r = takeExpeditionResult();
      ensureStarterGear(); // 옛 장비가 사라진 세이브: 빈 무기 칸에 나무 무기
      ensureStartCores(); // 옛 세이브: 전사에게 빠졌던 필살의 일격
      if (r) flashMessage(r);
    },
    onKeyDown,
  };
}
