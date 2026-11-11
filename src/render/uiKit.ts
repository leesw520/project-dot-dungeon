// 공용 UI 이미지 키트 (docs/ui-spec.md 10장). 원본: 사용자 키트 v03, public/ui/atlas_ui.png + atlas_ui.json.
//
// - 좌표·크기·9-slice 경계는 전부 atlas_ui.json에서 읽는다. 코드에는 스프라이트 "이름"만 둔다 (UI_SPRITE).
//   PNG·JSON을 같은 이름으로 바꿔 넣으면 코드 수정 없이 교체된다. 이름이 바뀌면 UI_SPRITE 표만 고친다.
// - 지연 로드: 처음 그리려 할 때 JSON → PNG 순으로 받는다. 받기 전·실패 시에는 함수가 false를 돌려주고,
//   상위 그리기 함수(uiPanel 등)는 예전 단색 그림(W, btn 등)으로 대신 그린다. 다 받으면 고정 레이어 캐시를
//   비우고 다시 그리기를 요청한다 (cached()에 단색으로 저장된 그림이 남지 않게).
// - 정수 좌표, 보간 끔(primitives.bind / layerCache가 imageSmoothingEnabled=false로 둔다).
// - 글자는 이미지에 없다. 상위 함수가 T()로 쓴다.
import { requestRedraw } from "./frame";
import { clearLayerCache } from "./layerCache";
import { C, R, T, W, pen } from "./primitives";

/** 키트 스프라이트 이름표. 값은 atlas_ui.json의 sprites 키. */
export const UI_SPRITE = {
  frame: { basic: "UI-01_frame_basic", emphasis: "UI-02_frame_emphasis", info: "UI-03_frame_info", tooltip: "UI-04_frame_tooltip" },
  popup: { confirm: "UI-12_popup_confirmation", warning: "UI-12_popup_warning", info: "UI-12_popup_information" },
  button: {
    normal: "UI-05_button_normal",
    hover: "UI-05_button_hover",
    selected: "UI-05_button_selected",
    disabled: "UI-05_button_disabled",
    confirm: "UI-05_button_confirm",
    danger: "UI-05_button_danger",
  },
  tab: { normal: "UI-06_tab_normal", selected: "UI-06_tab_selected" },
  slot: {
    normal: "UI-07_slot_normal",
    selected: "UI-07_slot_selected",
    locked: "UI-07_slot_locked",
    disabled: "UI-07_slot_disabled",
    invalid: "UI-07_slot_invalid",
    rarity: "UI-07_slot_rarity",
    add: "UI-07_slot_add",
  },
  row: { normal: "UI-08_list_row_normal", hover: "UI-08_list_row_hover", selected: "UI-08_list_row_selected", disabled: "UI-08_list_row_disabled" },
  gauge: {
    hp: { track: "UI-09_hp_track", fill: "UI-09_hp_fill" },
    mp: { track: "UI-09_mp_track", fill: "UI-09_mp_fill" },
    tp: { track: "UI-09_tp_track", fill: "UI-09_tp_fill" },
    exp: { track: "UI-09_exp_track", fill: "UI-09_exp_fill" },
  },
  pip: { hp: { full: "UI-09_hp_pip_full", empty: "UI-09_hp_pip_empty" }, tp: { full: "UI-09_tp_pip_full", empty: "UI-09_tp_pip_empty" } },
  title: { wood: "UI-10_title_wood", navy: "UI-10_title_navy" },
  divider: { h: "UI-10_divider_horizontal", v: "UI-10_divider_vertical" },
} as const;

interface NineSlice {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface SpriteRect {
  x: number;
  y: number;
  w: number;
  h: number;
  nine_slice?: NineSlice;
}
interface Atlas {
  image: HTMLImageElement;
  sprites: Record<string, SpriteRect>;
}

const ATLAS_JSON = `${import.meta.env.BASE_URL}ui/atlas_ui.json`;

let state: "idle" | "loading" | "ready" | "error" = "idle";
let atlas: Atlas | null = null;
const warned = new Set<string>();

function warnOnce(key: string, msg: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[uiKit] ${msg}`);
}

function isRect(v: unknown): v is SpriteRect {
  const r = v as SpriteRect;
  return !!r && [r.x, r.y, r.w, r.h].every((n) => Number.isInteger(n) && n >= 0);
}

async function load() {
  try {
    const res = await fetch(ATLAS_JSON);
    if (!res.ok) throw new Error(`${ATLAS_JSON} ${res.status}`);
    const meta = (await res.json()) as { image?: unknown; sprites?: Record<string, unknown> };
    if (typeof meta.image !== "string" || !meta.sprites) throw new Error("atlas_ui.json 형식 오류 (image, sprites)");
    const sprites: Record<string, SpriteRect> = {};
    for (const [k, v] of Object.entries(meta.sprites)) if (isRect(v)) sprites[k] = v;
    // 이미지 경로는 JSON 기준 상대 경로
    const src = new URL(meta.image, new URL(ATLAS_JSON, location.href)).href;
    const image = new Image();
    image.src = src;
    await image.decode();
    atlas = { image, sprites };
    state = "ready";
    clearLayerCache();
    requestRedraw();
  } catch (e) {
    state = "error";
    console.warn("[uiKit] UI 키트를 불러오지 못해 단색 UI로 그린다.", e);
  }
}

/** 키트가 준비됐으면 true. 처음 부르면 불러오기를 시작한다. */
export function uiReady(): boolean {
  if (state === "idle") {
    state = "loading";
    void load();
  }
  return state === "ready";
}

function sprite(id: string): SpriteRect | null {
  if (!uiReady() || !atlas) return null;
  const s = atlas.sprites[id];
  if (!s) warnOnce(id, `스프라이트 없음: ${id}`);
  return s ?? null;
}

/** 스프라이트 원본 크기 (키트가 아직 없으면 null). */
export function spriteSize(id: string): { w: number; h: number } | null {
  const s = sprite(id);
  return s ? { w: s.w, h: s.h } : null;
}

/** 스프라이트 하나. w,h를 주면 그 크기로 늘린다(최근접). 못 그리면 false. */
export function drawSprite(id: string, x: number, y: number, w?: number, h?: number): boolean {
  const s = sprite(id);
  if (!s || !atlas) return false;
  pen().drawImage(atlas.image, s.x, s.y, s.w, s.h, Math.round(x), Math.round(y), Math.round(w ?? s.w), Math.round(h ?? s.h));
  return true;
}

/** 9-slice: 모서리는 원본 픽셀 그대로, 변·가운데만 늘린다. 경계는 JSON의 nine_slice. 너무 작으면 false. */
export function drawNineSlice(id: string, x: number, y: number, w: number, h: number): boolean {
  const s = sprite(id);
  if (!s || !atlas) return false;
  const m = s.nine_slice;
  if (!m) {
    warnOnce(`${id}:9`, `${id}는 9-slice가 아니다`);
    return false;
  }
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  if (w < m.left + m.right || h < m.top + m.bottom) {
    warnOnce(`${id}:${w}x${h}`, `${id} ${w}×${h}: 9-slice 최소 크기 ${m.left + m.right}×${m.top + m.bottom}보다 작다`);
    return false;
  }
  const g = pen();
  const sx = [0, m.left, s.w - m.right, s.w];
  const sy = [0, m.top, s.h - m.bottom, s.h];
  const dx = [x, x + m.left, x + w - m.right, x + w];
  const dy = [y, y + m.top, y + h - m.bottom, y + h];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const sw = sx[c + 1] - sx[c];
      const sh = sy[r + 1] - sy[r];
      const dw = dx[c + 1] - dx[c];
      const dh = dy[r + 1] - dy[r];
      if (sw > 0 && sh > 0 && dw > 0 && dh > 0) g.drawImage(atlas.image, s.x + sx[c], s.y + sy[r], sw, sh, dx[c], dy[r], dw, dh);
    }
  return true;
}

// ---- 상위 그리기 함수: 바깥 크기·글자 자리는 예전 함수(W, btn)와 같게 둔다 ----

export type PanelKind = "basic" | "emphasis" | "info" | "tooltip" | "popupConfirm" | "popupWarning" | "popupInfo";

function panelSprite(kind: PanelKind): string {
  if (kind === "popupConfirm") return UI_SPRITE.popup.confirm;
  if (kind === "popupWarning") return UI_SPRITE.popup.warning;
  if (kind === "popupInfo") return UI_SPRITE.popup.info;
  return UI_SPRITE.frame[kind];
}

/** 창 프레임의 테두리 두께 (안쪽 내용은 이만큼 들여 그린다). 키트 v03 프레임 실측: 투명 1 + 테두리 4. */
export const PANEL_BORDER = 5;

/**
 * W(x,y,w,h,title,dark)의 이미지판. 바깥 크기는 W와 같다. 제목 띠는 높이 12로 W와 같고,
 * 프레임 테두리 때문에 (x+5, y+4)에서 시작한다 → 띠 끝이 y+16으로 W(y+14)보다 2px 내려온다.
 * W 기준으로 y+16부터 내용을 둔 화면은 그대로 맞는다. 키트가 없으면 W 그대로.
 */
export function uiPanel(x: number, y: number, w: number, h: number, title?: string, kind: PanelKind = "basic") {
  const dark = kind !== "basic" && kind !== "emphasis";
  if (!drawNineSlice(panelSprite(kind), x, y, w, h)) return W(x, y, w, h, title, dark);
  if (!title) return;
  const b = PANEL_BORDER;
  drawNineSlice(dark ? UI_SPRITE.title.navy : UI_SPRITE.title.wood, x + b, y + 4, w - b * 2, 12) || R(x + b, y + 4, w - b * 2, 12, C.woodL);
  T(x + 12, y + 14, title, 8, dark ? C.txt : C.gold);
}

export type ButtonState = keyof typeof UI_SPRITE.button;

/** 버튼 상태별 글자색 (키트 바탕색에 맞춤). */
export function buttonTextColor(st: ButtonState): string {
  if (st === "selected") return C.woodD;
  if (st === "disabled") return C.sub;
  return C.txt;
}

/** 버튼 바탕만. 키트가 없으면 예전 btn 색(woodD 테두리 + woodL/gold). */
export function uiButtonFrame(x: number, y: number, w: number, h: number, st: ButtonState) {
  if (drawNineSlice(UI_SPRITE.button[st], x, y, w, h)) return;
  R(x, y, w, h, C.woodD);
  R(x + 1, y + 1, w - 2, h - 2, st === "selected" ? C.gold : st === "disabled" ? C.cellLocked : st === "danger" ? C.hp : C.woodL);
}

/** btn(x,y,w,s,hl)의 이미지판. 글자는 가운데, 기준선 y+round(h/2)+3 (h 14→10, 16→11, btn과 같음). */
export function uiButton(x: number, y: number, w: number, h: number, label: string, st: ButtonState = "normal", size = 8) {
  uiButtonFrame(x, y, w, h, st);
  const col = uiReady() ? buttonTextColor(st) : st === "disabled" ? C.sub : C.woodD;
  T(x + w / 2, y + Math.round(h / 2) + 3, label, size, col, "middle");
}

/** 탭. selected면 금색 탭. 글자는 호출 쪽 자리 그대로 쓰도록 바탕만 그린다. */
export function uiTabFrame(x: number, y: number, w: number, h: number, selected: boolean) {
  if (drawNineSlice(selected ? UI_SPRITE.tab.selected : UI_SPRITE.tab.normal, x, y, w, h)) return;
  R(x, y, w, h, selected ? C.gold : C.woodL);
}
export function tabTextColor(selected: boolean): string {
  return !uiReady() || selected ? C.woodD : C.txt;
}

export type RowState = keyof typeof UI_SPRITE.row;
/** 목록 행 바탕. 키트가 없으면 listRow / listRowSel. */
export function uiRow(x: number, y: number, w: number, h: number, st: RowState) {
  if (drawNineSlice(UI_SPRITE.row[st], x, y, w, h)) return;
  R(x, y, w, h, st === "selected" ? C.listRowSel : st === "disabled" ? C.cellLocked : C.listRow);
}

export type SlotState = keyof typeof UI_SPRITE.slot;
/** 20×20 슬롯 (16×16 아이콘 자리). 가방·제작·배치판의 12/14px 칸에는 쓰지 않는다. */
export function uiSlot(x: number, y: number, st: SlotState = "normal") {
  if (drawSprite(UI_SPRITE.slot[st], x, y)) return;
  R(x, y, 20, 20, st === "locked" || st === "disabled" ? C.cellLocked : C.cell, st === "selected" ? `stroke='${C.gold}' stroke-width='1'` : undefined);
}

export type GaugeKind = keyof typeof UI_SPRITE.gauge;
const GAUGE_FALLBACK: Record<GaugeKind, string> = { hp: C.hp, mp: C.mp, tp: C.lim, exp: C.good };

/** 막대 게이지 (track 9-slice + fill 늘이기). ratio 0~1. fill은 track 안쪽 경계(nine_slice)에 맞춘다. */
export function uiGauge(kind: GaugeKind, x: number, y: number, w: number, h: number, ratio: number) {
  const r = Math.max(0, Math.min(1, ratio));
  const ids = UI_SPRITE.gauge[kind];
  const track = sprite(ids.track);
  if (track?.nine_slice && drawNineSlice(ids.track, x, y, w, h)) {
    // 안쪽 칸 = 테두리 안쪽에서 1px씩 더 들인 자리 (키트 v03 track 실측: 바깥 3·안쪽 회색 칸)
    const m = track.nine_slice;
    const ix = x + m.left - 2;
    const iw = w - (m.left - 2) * 2;
    const iy = y + m.top - 1;
    const ih = h - (m.top - 1) * 2;
    const fw = Math.round(iw * r);
    if (fw > 0) drawSprite(ids.fill, ix, iy, fw, ih);
    return;
  }
  R(x, y, w, h, C.cell);
  R(x, y, Math.round(w * r), h, GAUGE_FALLBACK[kind]);
}

/** 칸 게이지 한 칸 (HP·TP). */
export function uiPip(kind: keyof typeof UI_SPRITE.pip, x: number, y: number, full: boolean) {
  if (drawSprite(full ? UI_SPRITE.pip[kind].full : UI_SPRITE.pip[kind].empty, x, y)) return;
  R(x, y, 7, 6, full ? (kind === "hp" ? C.hp : C.lim) : C.cell);
}
