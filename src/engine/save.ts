// 세이브 (docs/roadmap.md "데이터 구조 원칙", 2026-11-07 구현).
// 저장 객체 1개 → localStorage JSON. 데이터 모듈이 registerSave로 자기 칸(dump/restore)을 등록하고,
// main.ts가 시작할 때 loadSave()를 한 번 부른다. 저장은 scheduleSave() — 입력·화면 전환 뒤마다 불러,
// 직렬화한 글이 지난번과 다를 때만 쓴다 ("바뀔 때마다 저장", 사용자 결정 2026-11-07).
// 전투 흐름(B01~B03) 동안에는 저장을 막는다 → 원정 중 새로고침하면 마지막 안전 지점(탐색 화면)에서 이어 한다.
// 파일 내보내기/가져오기: 같은 JSON. 가져오기·초기화는 localStorage를 바꾼 뒤 페이지를 다시 연다.

import { PLAY } from "./mode";

/** 테스트 플레이(play 모드)는 세이브 칸을 따로 쓴다 — 개발 세이브와 섞이지 않게 */
export const SAVE_KEY = PLAY ? "dot-dungeon-play" : "dot-dungeon-save";
export const SAVE_VERSION = 1;

interface SaveSlot {
  key: string;
  dump: () => unknown;
  restore: (v: unknown) => void;
}

/** 등록 순서 = 복원 순서. 보유 목록(inventory)이 장비·코어 판보다 먼저 와야 한다 (uid 참조). */
const slots: SaveSlot[] = [];
let blocked: () => boolean = () => false;
let lastWritten = "";
let lastSavedAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let loadError: string | null = null;

export function registerSave(key: string, dump: () => unknown, restore: (v: unknown) => void) {
  slots.push({ key, dump, restore });
}

/** 저장을 막을 조건 (main.ts: 전투 흐름 화면, 탐색 연출 중). */
export function setSaveBlocker(fn: () => boolean) {
  blocked = fn;
}

function snapshot(): string {
  const data: Record<string, unknown> = { version: SAVE_VERSION, savedAt: Date.now() };
  for (const s of slots) data[s.key] = s.dump();
  return JSON.stringify(data);
}

/** savedAt만 다른 글은 같은 것으로 본다. */
const body = (json: string) => json.replace(/"savedAt":\d+,?/, "");

function writeNow() {
  timer = null;
  if (blocked()) return;
  const json = snapshot();
  if (body(json) === body(lastWritten)) return;
  try {
    localStorage.setItem(SAVE_KEY, json);
    lastWritten = json;
    lastSavedAt = Date.now();
  } catch {
    // 저장 공간 부족·차단: 다음 기회에 다시 시도
  }
}

/** 바뀐 게 있으면 곧 저장한다 (연속 입력은 한 번으로 묶음). */
export function scheduleSave() {
  if (timer) return;
  timer = setTimeout(writeNow, 250);
}

/** 창을 닫거나 숨길 때 바로 저장. */
export function flushSave() {
  if (timer) clearTimeout(timer);
  writeNow();
}

function apply(data: Record<string, unknown>) {
  for (const s of slots) {
    if (!(s.key in data)) continue;
    try {
      s.restore(data[s.key]);
    } catch (e) {
      loadError = `${s.key} 불러오기 실패`;
      console.error(loadError, e);
    }
  }
}

/** 시작할 때 1번. 세이브가 있으면 복원하고 true. */
export function loadSave(): boolean {
  let json: string | null = null;
  try {
    json = localStorage.getItem(SAVE_KEY);
  } catch {
    return false;
  }
  if (!json) return false;
  try {
    const data = JSON.parse(json);
    if (typeof data !== "object" || data === null || Array.isArray(data) || data.version !== SAVE_VERSION) {
      loadError = "세이브 버전이 맞지 않아 새로 시작했다";
      return false;
    }
    apply(data);
    lastWritten = json;
    lastSavedAt = data.savedAt ?? 0;
    return true;
  } catch {
    loadError = "세이브가 깨져 새로 시작했다";
    return false;
  }
}

export const saveInfo = () => ({ lastSavedAt, error: loadError });

/** 브라우저가 저장소를 함부로 비우지 않게 요청 (지원할 때만). */
export function requestPersist() {
  navigator.storage?.persist?.().catch(() => {});
}

/** 세이브 파일 내보내기 (지금 상태를 바로 직렬화해 .json으로 내려받기). */
export function exportSave() {
  flushSave();
  const json = snapshot();
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  a.download = `dot-dungeon-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** 가져오기 직전의 세이브를 한 벌 남겨 두는 칸 (가져온 파일이 잘못됐을 때 되살릴 수 있게) */
export const SAVE_BACKUP_KEY = `${SAVE_KEY}-backup`;

/** 가져올 세이브 파일의 글을 검사한다. 문제가 있으면 이유를, 없으면 null을 돌려준다. */
export function checkSaveText(text: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return "세이브 파일을 읽을 수 없다";
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return "세이브 파일 형식이 아니다";
  if ((data as { version?: unknown }).version !== SAVE_VERSION) return "버전이 다른 세이브 파일이다";
  return null;
}

/** 세이브 파일 가져오기: 파일을 골라 검사한 뒤 localStorage에 쓰고 다시 연다. 실패하면 이유를 돌려준다. */
export function importSave(onError: (msg: string) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    f.text().then((text) => {
      const problem = checkSaveText(text);
      if (problem) return onError(problem);
      if (timer) clearTimeout(timer);
      const wasBlocked = blocked;
      blocked = () => true; // 다시 열기 전에 지금 상태로 덮어쓰지 않게
      try {
        // 지금 세이브를 한 벌 남긴다 (공간이 모자라 못 남겨도 가져오기는 계속한다)
        const prev = localStorage.getItem(SAVE_KEY);
        if (prev) try { localStorage.setItem(SAVE_BACKUP_KEY, prev); } catch { /* 무시 */ }
        localStorage.setItem(SAVE_KEY, text);
      } catch {
        // 저장 공간 부족·차단: 저장을 다시 풀어 주고 알린다 (예전에는 여기서 저장이 막힌 채로 남았다)
        blocked = wasBlocked;
        return onError("세이브를 저장할 수 없다 (저장 공간 부족)");
      }
      location.reload();
    }).catch(() => onError("세이브 파일을 읽을 수 없다"));
  };
  input.click();
}

/** 세이브 지우고 처음부터. */
export function resetSave(nextScene?: string) {
  if (timer) clearTimeout(timer);
  blocked = () => true;
  localStorage.removeItem(SAVE_KEY);
  // 새로고침 뒤 시작할 화면 (시작 화면의 "새로운 게임" → 거점)
  if (nextScene) try { sessionStorage.setItem("dd-next-scene", nextScene); } catch { /* 무시 */ }
  location.reload();
}
/** 새로고침 직전에 정해 둔 시작 화면을 한 번 꺼낸다 */
export function takeNextScene(): string | null {
  try {
    const v = sessionStorage.getItem("dd-next-scene");
    sessionStorage.removeItem("dd-next-scene");
    return v;
  } catch {
    return null;
  }
}
/** 저장된 게임이 있는가 (시작 화면 "이어하기") */
export function hasSave(): boolean {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}
