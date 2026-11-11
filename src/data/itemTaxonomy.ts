// docs/items.md 기준 아이템 분류. 카탈로그(pieces.ts)와 도감(dex.ts)이 모두 이 정의를 쓴다.

export type ItemKind = "material" | "compound" | "consumable" | "equipment" | "core" | "key";

export const KIND_LABEL: Record<ItemKind, string> = {
  material: "소재",
  compound: "조합",
  consumable: "사용",
  equipment: "장비",
  core: "코어",
  key: "중요",
};

/** 버리기 금지 — 스토리 진행/레시피가 꼬이지 않게 */
export function isDiscardable(kind: ItemKind) {
  return kind !== "key";
}

export const COMMON_CATEGORIES = [
  "물", "식물", "꽃", "약재료", "독재료", "엘릭시르", "원소", "모래", "석재", "광석", "원석", "화약",
  "연료", "식재료", "나무열매", "버섯", "어패류", "곤충", "실소재", "목재", "동물소재", "용소재", "조미료", "금속",
] as const;
export const CRAFT_ONLY_CATEGORIES = ["식품", "잡화", "마법의도구", "폭탄", "포션", "잉곳", "직물", "보석", "촉매"] as const;

export type Category = (typeof COMMON_CATEGORIES)[number] | (typeof CRAFT_ONLY_CATEGORIES)[number];

export function isCraftOnlyCategory(c: Category) {
  return (CRAFT_ONLY_CATEGORIES as readonly string[]).includes(c);
}

export type ElementId = "red" | "yellow" | "green" | "blue" | "white" | "black";

export interface ElementDef {
  id: ElementId;
  label: string;
  color: string;
  /** 켜진 칸 위 하이라이트 / 꺼진 칸 테두리용 밝은 색 */
  light: string;
  special: boolean;
}

export const ELEMENT_DEFS: Record<ElementId, ElementDef> = {
  red: { id: "red", label: "불꽃", color: "#D85A30", light: "#F0997B", special: false },
  yellow: { id: "yellow", label: "번개", color: "#BA7517", light: "#FAC775", special: false },
  green: { id: "green", label: "바람", color: "#639922", light: "#97C459", special: false },
  blue: { id: "blue", label: "얼음", color: "#378ADD", light: "#85B7EB", special: false },
  white: { id: "white", label: "빛", color: "#F1EFE8", light: "#FFFFFF", special: true },
  black: { id: "black", label: "어둠", color: "#26215C", light: "#7F77DD", special: true },
};

/** 고정 칸 표시 순서: 좌상, 우상, 좌하, 우하 */
export const BASE_ELEMENTS: ElementId[] = ["red", "yellow", "green", "blue"];
export const SPECIAL_ELEMENTS: ElementId[] = ["white", "black"];
export const ELEMENT_ORDER: ElementId[] = [...BASE_ELEMENTS, ...SPECIAL_ELEMENTS];
