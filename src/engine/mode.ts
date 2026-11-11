// 실행 모드 (2026-11-08). "play" = 테스트 플레이 서버 (npm run play, vite --mode play):
// 시작 화면(T01)부터, 화면 바로가기 탭 없음, 세이브 칸 따로, 새 게임은 깨끗한 초기 상태 (테스트용 소재·코어 지급 없음).
// 그 밖(npm run dev) = 개발 모드: 화면 탭, 테스트용 지급품.
export const PLAY = import.meta.env.MODE === "play";
