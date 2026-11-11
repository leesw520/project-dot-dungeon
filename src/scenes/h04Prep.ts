// H04 출발 준비 (2026-11-08, docs/screens.md H04). 거점 던전 게이트의 "출발"로 들어온다.
// 창고의 사용 아이템(회복약·식품)을 골라 원정 가방에 챙긴다: 클릭하면 1개가 창고 → 가방(자동 배치, 빈자리 없으면 못 챙김).
// 오른쪽 챙긴 목록을 클릭하면 창고로 되돌린다. "출발"을 누르면 원정 시작 → D01. "◀ 거점으로"는 챙긴 것을 모두 되돌리고 나간다.
import { PIECES, pieceColors } from "../data/pieces";
import { addItem, holderOf, ownedItems, removeUid, type OwnedItem } from "../data/inventory";
import { goTo } from "../engine/nav";
import { C, R, T, W, btn, fitText, piece } from "../render/primitives";
import { bagContents, bagUsage, packIntoBags, unpackFromBags } from "./b03Loot";
import { beginExpedition } from "./d01Explore";
import type { LogicalPoint, Scene } from "./types";

const VISIBLE = 8;
const BACK = { x: 382, y: 10, w: 78, h: 12 };
const GO = { x: 312, y: 232, w: 136, h: 16 };

export function createH04Scene(): Scene {
  let scroll = 0;
  let message = "";
  /** 이번 준비에서 챙긴 가방 줄 (되돌리기용): 가방 uid → 보유 목록에 넣은 가방 줄 */
  const packed: Array<{ bagUid: number; itemId: string; bonuses?: string[] }> = [];

  /** 챙길 수 있는 창고 줄: 사용 아이템 (회복약·식품) */
  const rows = (): OwnedItem[] =>
    ownedItems((o) => o.location === "warehouse" && o.count > 0 && !holderOf(o.uid) && PIECES[o.itemId]?.kind === "consumable");
  const rowRect = (i: number) => ({ x: 20, y: 48 + i * 24, w: 270, h: 22 });
  const hit = (p: LogicalPoint, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
  const packedRect = (i: number) => ({ x: 310, y: 112 + i * 14, w: 140, h: 13 });

  function pack(o: OwnedItem) {
    const bagUid = packIntoBags(o.itemId);
    if (bagUid == null) { message = "가방에 빈자리가 없다"; return; }
    const bonuses = o.bonuses ? [...o.bonuses] : undefined;
    removeUid(o.uid);
    addItem(o.itemId, 1, "bag", bonuses); // 보유 목록: 위치 가방 (귀환하면 창고로, 패배하면 잃는다)
    packed.push({ bagUid, itemId: o.itemId, bonuses });
    message = `${PIECES[o.itemId].name}을(를) 챙겼다`;
  }
  /** 챙긴 것을 창고로 되돌린다 */
  function unpack(i: number) {
    const p = packed[i];
    if (!p || !unpackFromBags(p.bagUid)) return;
    const row = ownedItems((o) => o.location === "bag" && o.itemId === p.itemId)[0];
    if (row && removeUid(row.uid)) addItem(p.itemId, 1, "warehouse", p.bonuses);
    packed.splice(i, 1);
  }

  function onPointerDown(p: LogicalPoint, button: number) {
    if (button !== 0) return;
    if (hit(p, BACK)) {
      while (packed.length) unpack(packed.length - 1);
      return goTo("h01");
    }
    if (hit(p, GO)) {
      packed.length = 0;
      beginExpedition();
      return goTo("d01");
    }
    const list = rows();
    for (let i = 0; i < Math.min(VISIBLE, list.length - scroll); i++) if (hit(p, rowRect(i))) return pack(list[i + scroll]);
    for (let i = 0; i < packed.length; i++) if (hit(p, packedRect(i))) return unpack(i);
  }

  function draw() {
    R(0, 0, 480, 270, C.screenBg);
    W(10, 8, 460, 254, "출발 준비 — 가방 챙기기");
    R(BACK.x, BACK.y, BACK.w, BACK.h, C.woodL);
    T(BACK.x + BACK.w / 2, BACK.y + 10, "◀ 거점으로", 7, C.woodD, "middle");
    T(20, 37, "창고의 사용 아이템 — 클릭하면 1개를 가방에 넣는다", 7, C.sub);

    const list = rows();
    scroll = Math.max(0, Math.min(scroll, list.length - VISIBLE));
    list.slice(scroll, scroll + VISIBLE).forEach((o, i) => {
      const r = rowRect(i), d = PIECES[o.itemId];
      R(r.x, r.y, r.w, r.h, C.listRow);
      piece(r.x + 6, r.y + 4, 7, d.cells, pieceColors(d));
      T(r.x + 40, r.y + 14, fitText(o.bonuses?.length ? `${d.name} ★${o.bonuses.length}` : d.name, 150, 8), 8, o.bonuses?.length ? C.gold : C.txt);
      T(r.x + r.w - 10, r.y + 14, `창고 ${o.count}`, 7, C.sub, "end");
    });
    if (!list.length) T(30, 70, "챙길 사용 아이템이 없다 (작업대에서 회복약을 만들 수 있다)", 7, C.sub);
    if (message) T(20, 252, message, 7, C.good);

    W(300, 48, 160, 206, "원정 가방", 1);
    bagUsage().forEach((u, i) => {
      T(312, 70 + i * 10, u.owner, 7, C.txt);
      T(446, 70 + i * 10, `${u.filled}/${u.total}칸`, 7, u.filled >= u.total ? C.hp : C.sub, "end");
    });
    T(312, 108, "가방에 든 것 (클릭: 창고로)", 6, C.gold);
    const inBag = bagContents();
    packed.slice(0, 8).forEach((p, i) => {
      const r = packedRect(i);
      R(r.x, r.y, r.w, r.h, C.panelIn);
      T(r.x + 4, r.y + 10, fitText(PIECES[p.itemId].name, 110, 7), 7, C.txt);
      T(r.x + r.w - 4, r.y + 10, "↩", 7, C.sub, "end");
    });
    const before = inBag.length - packed.length;
    if (before > 0) T(312, 228, `원래 들어 있던 것 ${before}개`, 6, C.sub);
    btn(GO.x, GO.y, GO.w, "출발", true);
  }

  return {
    id: "h04", label: "H04 출발 준비", draw, onPointerDown,
    onEnter: () => { packed.length = 0; message = ""; },
    onWheel: (dy) => { scroll += dy > 0 ? 1 : -1; },
  };
}
