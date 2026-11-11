// ui-spec.md 4.6 Tooltip 확장판 (2026-10-31 개편).
// 이름(제일 큰 글씨) / 속성 키워드 / 설명 / 묶음(소제목 중간 글씨 + 효과 줄 작은 글씨, 구분선) /
// 구분선 아래 짧은 조작 안내(아주 작은 글씨)로 구성한다. 줄 수·글자 폭을 실제로 재고 긴 줄은
// 접어서 창 크기를 정하므로, 능력치나 스킬이 여러 개여도 창이 같이 늘어난다.
// 회전·반전 같은 "배치 중" 조작 안내는 툴팁에 넣지 않고 drawControlsHint()로 화면 구석에 둔다.
import { coreBlockReason, coreReqText } from "../data/aptitude";
import { keywordNotes } from "../data/keywords";
import { SKILL_BOOK } from "../data/skillbook";
import { equippedSkills } from "../engine/party";
import type { PieceDef } from "../data/pieces";
import { skillInfo } from "../data/skills";
import { C, R, T, VIEW_H, VIEW_W, textWidth } from "../render/primitives";

// 글자 크기 위계: 제목 > 소제목 > 본문(효과·설명) > 보조(수치 줄) > 조작 안내
const SIZE = { title: 10, heading: 8, body: 7, meta: 6, hint: 5 };
const LINE_H: Record<number, number> = { 10: 15, 8: 13, 7: 10, 6: 9, 5: 8 };

export type TooltipLine = { text: string; color?: string; size?: number } | "divider";

export interface TooltipSection {
  heading: string;
  lines: TooltipLine[];
}

export interface TooltipContent {
  title: string;
  attrs?: string;
  desc?: string;
  sections?: TooltipSection[];
  hint?: string;
  /** 보조 창: 본 창 바로 아래 작은 창 (키워드 설명·적용 대상 등 참조 정보, 2026-11-07) */
  notes?: TooltipNote[];
}

export interface TooltipNote {
  title: string;
  lines: TooltipLine[];
}

const PAD = 8;
const MAX_W = 200;
const MIN_W = 80;
const DIVIDER_H = 7;

type Line = { kind: "text"; text: string; size: number; color: string; h: number } | { kind: "divider"; h: number };

/** 글 폭이 maxW를 넘으면 띄어쓰기 단위로(안 되면 글자 단위로) 줄을 나눈다. */
function wrap(text: string, size: number, maxW: number): string[] {
  if (textWidth(text, size) <= maxW) return [text];
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (textWidth(next, size) <= maxW) {
      cur = next;
      continue;
    }
    if (cur) out.push(cur);
    cur = word;
    while (textWidth(cur, size) > maxW) {
      let i = cur.length - 1;
      while (i > 1 && textWidth(cur.slice(0, i), size) > maxW) i--;
      out.push(cur.slice(0, i));
      cur = cur.slice(i);
    }
  }
  if (cur) out.push(cur);
  return out;
}

interface Box { lines: Line[]; w: number; h: number; hint?: string }

function layout(content: TooltipContent): Box {
  const maxText = MAX_W - PAD * 2;
  const lines: Line[] = [];
  const push = (text: string, size: number, color: string) =>
    wrap(text, size, maxText).forEach((t) => lines.push({ kind: "text", text: t, size, color, h: LINE_H[size] ?? size + 3 }));

  push(content.title, SIZE.title, C.txt);
  if (content.attrs) push(content.attrs, SIZE.body, C.sub);
  if (content.desc) push(content.desc, SIZE.heading, C.txt);
  content.sections?.forEach((sec) => {
    lines.push({ kind: "text", text: sec.heading, size: SIZE.heading, color: C.gold, h: LINE_H[SIZE.heading] + 2 });
    sec.lines.forEach((l) => {
      if (l === "divider") lines.push({ kind: "divider", h: DIVIDER_H });
      else push(l.text, l.size ?? SIZE.body, l.color ?? C.txt);
    });
  });
  const widths = lines.map((l) => (l.kind === "text" ? textWidth(l.text, l.size) : 0));
  if (content.hint) widths.push(textWidth(content.hint, SIZE.hint));
  const w = Math.ceil(Math.min(MAX_W, Math.max(MIN_W, PAD * 2 + Math.max(...widths))));
  const bodyH = lines.reduce((sum, l) => sum + l.h, 0);
  const hintH = content.hint ? 4 + 1 + 9 : 0; // 위 여백 4 + 구분선 1 + 글줄 9
  return { lines, w, h: PAD / 2 + bodyH + hintH + PAD / 2 + 2, hint: content.hint };
}

/** 보조 창: 작은 글씨. 항목마다 제목(금색) + 줄, 항목 사이 구분선. */
function layoutNotes(notes: TooltipNote[], maxW: number): Box {
  const NOTE_PAD = 6;
  const maxText = maxW - NOTE_PAD * 2;
  const lines: Line[] = [];
  const push = (text: string, size: number, color: string) =>
    wrap(text, size, maxText).forEach((t) => lines.push({ kind: "text", text: t, size, color, h: LINE_H[size] ?? size + 3 }));
  notes.forEach((n, i) => {
    if (i > 0) lines.push({ kind: "divider", h: 5 });
    push(n.title, SIZE.meta, C.gold);
    n.lines.forEach((l) => (l === "divider" ? lines.push({ kind: "divider", h: 5 }) : push(l.text, l.size ?? SIZE.meta, l.color ?? C.sub)));
  });
  const w = Math.ceil(Math.min(maxW, Math.max(MIN_W, NOTE_PAD * 2 + Math.max(...lines.map((l) => (l.kind === "text" ? textWidth(l.text, l.size) : 0))))));
  return { lines, w, h: 3 + lines.reduce((s, l) => s + l.h, 0) + 4 };
}

function paint(x: number, y: number, box: Box, pad: number, bg: string) {
  R(x, y, box.w, box.h, bg, `stroke='${C.tipLine}' stroke-width='1'`);
  let top = y + (pad === PAD ? PAD / 2 : 3);
  box.lines.forEach((l) => {
    if (l.kind === "divider") R(x + pad, top + Math.floor(l.h / 2), box.w - pad * 2, 1, C.tipLine, "opacity='.5'");
    else T(x + pad, top + l.h - 3, l.text, l.size, l.color);
    top += l.h;
  });
  if (box.hint) {
    const dividerY = top + 3;
    R(x + pad, dividerY, box.w - pad * 2, 1, C.tipLine);
    T(x + pad, dividerY + 8, box.hint, SIZE.hint, C.tipLine);
  }
}

export function drawTooltip(cursorX: number, cursorY: number, content: TooltipContent) {
  const main = layout(content);
  const notes = content.notes?.length ? layoutNotes(content.notes, MAX_W) : null;
  const GAP = 2;
  const w = Math.max(main.w, notes?.w ?? 0);
  const h = main.h + (notes ? GAP + notes.h : 0);

  let x = cursorX + 12;
  let y = cursorY + 12;
  if (x + w > VIEW_W) x = cursorX - 12 - w;
  if (y + h > VIEW_H) y = cursorY - 12 - h;
  x = Math.max(0, x);
  y = Math.max(0, Math.min(y, VIEW_H - h));

  paint(x, y, main, PAD, C.tipBg);
  if (notes) paint(x, y + main.h + GAP, notes, 6, C.tipBg);
}

const skillByLabel = (label: string) => {
  const name = label.includes(":") ? label.slice(label.indexOf(":") + 1).trim() : label;
  return SKILL_BOOK.find((x) => x.name === name);
};

/** 코어 효과의 스킬 하나를 툴팁 줄들로: 이름(종류) / 수치 줄 / 설명. 여러 개면 사이에 구분선. */
function skillLines(skills: Array<{ label: string; passive: boolean }>): TooltipLine[] {
  const out: TooltipLine[] = [];
  skills.forEach((s, i) => {
    if (i > 0) out.push("divider");
    const info = skillInfo(s.label, s.passive);
    out.push({ text: `[${info.passive ? "패시브" : "스킬"}: ${info.name}]`, color: C.good });
    if (info.meta) out.push({ text: info.meta, color: C.sub, size: SIZE.meta });
    if (info.desc) out.push({ text: info.desc });
  });
  return out;
}

/** 코어 스킬의 보조 창: 적용 대상(습득 가능한 스킬 중, 장착 중이면 강조) + 효과 문장에 나온 키워드 설명. */
function coreNotes(skills: Array<{ label: string }>, char?: string): TooltipNote[] {
  const out: TooltipNote[] = [];
  for (const s of skills) {
    const def = skillByLabel(s.label);
    if (!def) continue;
    if (def.refers && char) {
      const equipped = new Set(equippedSkills(char).map((x) => x.id));
      const hits = SKILL_BOOK.filter((x) => !x.passive && def.refers!(x) && !coreBlockReason(char, x.req));
      out.push({
        title: "적용 대상 (습득 가능)",
        lines: hits.length ? hits.map((x) => ({ text: `${equipped.has(x.id) ? "● " : "· "}${x.name}`, color: equipped.has(x.id) ? C.good : C.sub })) : [{ text: "없음" }],
      });
    }
    for (const k of keywordNotes(def.lines.join(" "))) out.push({ title: k.title, lines: [{ text: k.text }] });
  }
  return out;
}

/** 조각 툴팁 공통 내용. 코어는 "능력치"/"습득 스킬" 두 묶음만, 나머지는 등급·칸 수 + 설명. */
export function pieceTooltip(d: PieceDef, attrs: string, hint?: string, char?: string): TooltipContent {
  if (d.coreEffect) {
    const eff = d.coreEffect;
    return {
      notes: coreNotes(eff.skills, char),
      title: d.name,
      attrs: coreReqText(d.coreReq),
      // 능력치가 없으면 그 묶음은 뺀다 (2026-11-07)
      sections: [
        ...(eff.stats.length ? [{ heading: "능력치", lines: eff.stats.map((s) => ({ text: `${s.label} +${s.value}` })) }] : []),
        { heading: "습득 스킬", lines: eff.skills.length ? skillLines(eff.skills) : [{ text: "없음", color: C.sub }] },
      ],
      hint,
    };
  }
  return { title: d.name, attrs, desc: d.desc, hint };
}

/** 배치 화면 왼쪽 아래 조작 안내 띠. 각 화면이 이 높이(CONTROLS_HINT_H)만큼 자리를 비워둔다. */
export const CONTROLS_HINT_H = 10;
export function drawControlsHint(x: number, y: number, text = "휠 회전 · F 반전 · 우클릭 취소") {
  T(x, y + 8, text, 6, C.sub);
}
