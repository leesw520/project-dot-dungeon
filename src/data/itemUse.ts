// 인벤토리에서 쓸 수 있는 아이템의 효과. 여기 없는 종류는 '사용'이 비활성이다.
// 다른 데이터처럼 순수 데이터 (키는 PIECES id). TODO(spec): 탐색 보조 도구 효과.
export interface ItemUseDef {
  /** 대상 아군 하나를 골라 회복 (포션). 식품이면 없다. */
  stat?: "hp" | "mp";
  amount?: number;
  /** 식품 (2026-11-08): 탐색 중에만 — 체류 횟수 + 파티 전원 HP·MP 회복. 만들기 어려울수록 크다. 전투에서는 못 쓴다. */
  food?: { stay: number; hp?: number; mp?: number };
}

export const ITEM_USE: Record<string, ItemUseDef> = {
  // 제작 포션 (docs/materials.md 2.2). TODO(spec): 소재 등급·보너스에 따른 회복량
  "c:HP 회복약": { stat: "hp", amount: 60 }, // 2026-11-08: 캐릭터 HP 하향(65~120)에 맞춰 150 → 60
  "c:MP 회복약": { stat: "mp", amount: 20 },
  // 식품: 체류 +n (한 번에 타일 n개 더) · 파티 전원 HP/MP. 단계 = 해금 노트 (초급 → 중급 → 상급 → 전설). 수치 첫 안 TODO(spec)
  "c:구운 고기": { food: { stay: 2, hp: 15 } },
  "c:감자 수프": { food: { stay: 2, mp: 5 } },
  "c:버섯 꼬치": { food: { stay: 3 } },
  "c:오믈렛": { food: { stay: 2, hp: 10, mp: 3 } },
  "c:빵": { food: { stay: 4 } },
  "c:열매 파이": { food: { stay: 3, hp: 20, mp: 5 } },
  "c:열매 꿀절임": { food: { stay: 3, mp: 10 } },
  "c:고기 스튜": { food: { stay: 5, hp: 35 } },
  "c:용 고기 스테이크": { food: { stay: 8, hp: 60, mp: 20 } },
  // 어패류 요리 (낚시 시설과 함께 열 예정 — 지금은 레시피 숨김)
  "c:생선 구이": { food: { stay: 2, hp: 10 } },
  "c:새우 튀김": { food: { stay: 3, hp: 15 } },
};
