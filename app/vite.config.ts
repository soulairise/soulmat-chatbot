import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base:'./' — GitHub Pages 하위 경로에서도 자산을 상대 경로로 찾게 한다.
export default defineConfig({
  base: './',
  plugins: [react()],
})
