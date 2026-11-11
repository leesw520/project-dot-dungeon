import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages는 저장소 이름 경로 아래에서 서빙되므로 상대 경로로 빌드한다.
  base: "./",
  build: {
    // main.ts가 최상위 await를 쓴다.
    target: "es2022",
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
