import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  base: './',

  build: {
    rollupOptions: {
      output: {
        // めったに変わらないライブラリを別ファイルにして、アプリ更新時の再ダウンロードを減らす
        manualChunks: {
          react: ['react', 'react-dom'],
          vendor: ['@tonejs/midi', 'lucide-react', 'clsx', 'tailwind-merge'],
        },
      },
    },
  },
})
