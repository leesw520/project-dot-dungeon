// 접속 코드 (2026-11-09, 사용자: 최소한의 보안). 온라인 판(빌드)에서만 게임 전에 코드를 묻는다 — 개발 서버는 묻지 않는다.
// 코드 원문은 저장소에 두지 않는다: 여기에는 SHA-256 해시만, 원문은 git에 올라가지 않는 access-code.local 파일.
// 맞으면 이 브라우저에 해시를 기억해 다음부터 묻지 않는다 (코드를 바꾸면 해시가 달라져 다시 묻는다).
// 주의: 정적 사이트라 브라우저 안에서만 확인한다 — 우연한 방문을 막는 정도이고, 코드를 뜯어보면 우회할 수 있다.
//
// 코드 바꾸기: 새 코드를 정해 아래로 해시를 만들고 ACCESS_HASH를 바꾼다.
//   python -c "import hashlib;print(hashlib.sha256(('dot-dungeon-access-v1:'+'새 코드').encode()).hexdigest())"
const SALT = "dot-dungeon-access-v1:";
const ACCESS_HASH = "edcf67a80cd0556756862d3789e88a718b3e1057b237835ea2573da617bb8036";
const KEY = "dot-dungeon-access";

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const normalize = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

function remembered(): boolean {
  try { return localStorage.getItem(KEY) === ACCESS_HASH; } catch { return false; }
}
function remember() {
  try { localStorage.setItem(KEY, ACCESS_HASH); } catch { /* 저장 못 하면 다음에 다시 묻는다 */ }
}

/** 코드를 맞힐 때까지 입력 화면을 띄운다. 개발 서버(DEV)거나 이미 맞힌 브라우저면 바로 통과. */
export async function requireAccess(root: HTMLElement): Promise<void> {
  if (import.meta.env.DEV || remembered() || !crypto?.subtle) return;
  return new Promise((resolve) => {
    const box = document.createElement("form");
    box.className = "access-gate";
    box.innerHTML = `
      <div class="access-card">
        <div class="access-title">도트 던전</div>
        <div class="access-sub">접속 코드를 입력하세요</div>
        <input class="access-input" type="password" autocomplete="off" spellcheck="false" placeholder="DD-XXXX-XXXX" />
        <button class="access-btn" type="submit">입장</button>
        <div class="access-msg"></div>
      </div>`;
    root.appendChild(box);
    const input = box.querySelector<HTMLInputElement>(".access-input")!;
    const msg = box.querySelector<HTMLDivElement>(".access-msg")!;
    input.focus();
    box.addEventListener("submit", async (e) => {
      e.preventDefault();
      if ((await sha256(SALT + normalize(input.value))) === ACCESS_HASH) {
        remember();
        box.remove();
        resolve();
      } else {
        msg.textContent = "코드가 맞지 않습니다";
        input.select();
      }
    });
  });
}
