import "./style.css";
import { mountCanvas } from "./render/canvas";
import { setNavigator } from "./engine/nav";
import { ALWAYS_REDRAW, requestRedraw } from "./render/frame";
import { layerCacheStats } from "./render/layerCache";
import "./data/skillCores"; // 스킬 코어·도안 등록 (다른 화면보다 먼저)
import { SCENES } from "./scenes";
import { flushSave, loadSave, requestPersist, scheduleSave, setSaveBlocker, takeNextScene } from "./engine/save";
import { PLAY } from "./engine/mode";
import { expeditionActive, expeditionSettled } from "./scenes/d01Explore";
import { preloadImages } from "./render/primitives";
import { hubImages } from "./data/facilities";
import { charArt } from "./data/charArt";
import { PARTY } from "./data/battle";
import { requireAccess } from "./engine/access";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app 루트를 찾을 수 없다");

app.innerHTML = `
  <header id="tabs"></header>
  <div id="stage"></div>
`;

// 접속 코드 (온라인 판에서만, engine/access.ts): 맞힐 때까지 게임을 띄우지 않는다
await requireAccess(document.body);

const tabs = app.querySelector<HTMLElement>("#tabs")!;
const stage = app.querySelector<HTMLDivElement>("#stage")!;

// 세이브 (engine/save.ts): 모든 데이터 모듈이 등록을 마친 지금 1번 불러온다.
// 원정 중이었으면 탐색(D01)에서, 아니면 거점(H01)에서 시작한다.
loadSave();
requestPersist();
// 거점·캐릭터 그림은 시작 화면에 있는 동안 미리 받아 둔다 (들어간 뒤 자리표시·갈색 화면이 보이지 않게)
preloadImages([...hubImages(), ...PARTY.flatMap((a) => (["illust", "portrait", "battle", "mini"] as const).map((k) => charArt(a.name, k)).filter((s): s is string => !!s))]);
// 테스트 플레이(play 모드)는 시작 화면(T01)부터 — "새로운 게임"으로 새로고침했으면 거점부터
const next = takeNextScene();
let current = next ?? (PLAY ? "t01" : expeditionActive() ? "d01" : "h01");
// 전투 흐름(B01~B03) 동안·탐색 연출 중에는 저장하지 않는다 → 새로고침하면 마지막 탐색 화면에서 이어 한다.
setSaveBlocker(() => ["t01", "b01", "b02", "b03"].includes(current) || (current === "d01" && !expeditionSettled()));
window.addEventListener("pagehide", flushSave);
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushSave());

function currentScene() {
  return SCENES.find((s) => s.id === current) ?? SCENES[0];
}

function renderTabs() {
  if (PLAY) { tabs.innerHTML = ""; tabs.style.display = "none"; return; } // 테스트 플레이: 화면 바로가기 탭 없음
  tabs.innerHTML = SCENES.map(
    (s) => `<button type="button" data-id="${s.id}" class="${s.id === current ? "on" : ""}">${s.label}</button>`
  ).join("");
}

tabs.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
  if (!btn) return;
  current = btn.dataset.id!;
  renderTabs();
  currentScene().onEnter?.();
  requestRedraw();
  scheduleSave();
});

renderTabs();
setNavigator((id) => {
  if (!SCENES.some((s) => s.id === id)) return;
  current = id;
  renderTabs();
  currentScene().onEnter?.();
  requestRedraw();
  scheduleSave();
});

// ui-spec.md 9장: 그리는 프레임마다 tick → draw, 그 뒤 화면이 아직 움직이는 중인지 물어 다음 프레임 여부를 정한다.
const mount = await mountCanvas(stage, (dt) => {
  const scene = currentScene();
  scene.tick?.(dt);
  scene.draw();
  return scene.isAnimating?.() ?? false;
});

/** 입력 핸들러를 부른 뒤 다시 그리기를 요청한다. 입력으로 바뀐 그림은 화면이 따로 알릴 필요가 없다. */
function input<A extends unknown[]>(fn: ((...args: A) => void) | undefined, ...args: A) {
  fn?.(...args);
  requestRedraw();
  scheduleSave();
}

mount.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
mount.canvas.addEventListener("auxclick", (e) => e.preventDefault());

mount.canvas.addEventListener("mousedown", (e) => {
  e.preventDefault();
  const p = mount.toLogical(e.clientX, e.clientY);
  input(currentScene().onPointerDown, p, e.button);
});

mount.canvas.addEventListener("mousemove", (e) => {
  const p = mount.toLogical(e.clientX, e.clientY);
  currentScene().onPointerMove?.(p); // 마우스 이동만으로는 데이터가 안 바뀌니 저장 예약 없이 다시 그리기만
  requestRedraw();
});

window.addEventListener("mouseup", (e) => {
  const p = mount.toLogical(e.clientX, e.clientY);
  input(currentScene().onPointerUp, p, e.button);
});

window.addEventListener("keydown", (e) => {
  input(currentScene().onKeyDown, e.key);
});

window.addEventListener("keyup", (e) => {
  input(currentScene().onKeyUp, e.key);
});

mount.canvas.addEventListener(
  "wheel",
  (e) => {
    if (!currentScene().onWheel) return;
    e.preventDefault();
    input(currentScene().onWheel, e.deltaY);
  },
  { passive: false }
);

// 개발 모드 그리기 카운터: 가만히 있을 때 숫자가 멈춰야 정상. 화면 위 DOM이라 캔버스 그림에는 안 섞인다.
if (import.meta.env.DEV) {
  const meter = document.createElement("div");
  meter.id = "draw-meter";
  meter.style.cssText =
    "position:fixed;right:4px;bottom:4px;padding:2px 6px;font:11px monospace;color:#9FE1CB;background:#000a;pointer-events:none;z-index:9";
  document.body.appendChild(meter);
  let shown = -1;
  setInterval(() => {
    const s = mount.stats;
    if (s.draws === shown) return;
    shown = s.draws;
    const c = layerCacheStats();
    meter.textContent = `draws ${s.draws} · ${s.lastMs.toFixed(1)}ms · layers ${c.entries}${ALWAYS_REDRAW ? " · ALWAYS" : ""}`;
  }, 250);
  (window as unknown as { __drawStats: unknown }).__drawStats = () => ({ ...mount.stats, layers: layerCacheStats() });
}
