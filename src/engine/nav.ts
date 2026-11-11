// 거점(H01) 하위 기능(창고/작업대 등)이 독립된 화면으로 전환됐다가 되돌아오도록, 탭 목록과
// 무관하게 "화면 전환"을 요청할 수 있는 아주 작은 pub-sub. main.ts가 한 번 구독해 둔다.
type Listener = (id: string) => void;

let listener: Listener | null = null;
let pendingChar: string | null = null;
let pendingItem: string | null = null;
let pendingBack: string | null = null;

export function setNavigator(fn: Listener) {
  listener = fn;
}

/** char: 캐릭터 화면(P01/P02/P03) 사이에서 고른 캐릭터(PARTY name)를 넘길 때. */
export function goTo(id: string, char?: string) {
  pendingChar = char ?? null;
  listener?.(id);
}

/** 하위 화면을 열면서 돌아갈 화면을 맡긴다 (탐색 메뉴 → D06·인벤토리). 받는 화면이 뒤로가기 버튼을 그린다. */
export function goToWithBack(id: string, back: string) {
  pendingBack = back;
  goTo(id);
}

/** 맡겨 둔 돌아갈 화면. 받는 화면의 onEnter에서 한 번 읽으면 비운다. 탭으로 들어오면 null. */
export function takeNavBack(): string | null {
  const b = pendingBack;
  pendingBack = null;
  return b;
}

/** 창고(H03)를 열면서 보유 목록의 이 uid를 골라 둔다 (C03 "창고에서 보기"). */
export function goToItem(id: string, uid: string) {
  pendingItem = uid;
  goTo(id);
}

/** goToItem으로 넘겨받은 보유 uid. 받는 화면의 onEnter에서 한 번 읽으면 비운다. */
export function takeNavItem(): string | null {
  const u = pendingItem;
  pendingItem = null;
  return u;
}

/** goTo로 넘겨받은 캐릭터. 받는 화면의 onEnter에서 한 번 읽으면 비운다. */
export function takeNavChar(): string | null {
  const c = pendingChar;
  pendingChar = null;
  return c;
}
