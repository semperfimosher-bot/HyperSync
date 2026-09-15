import {
  fileURLToPath,
} from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const indexHtml =
  fileURLToPath(
    new URL(
      './index.html',
      import.meta.url,
    ),
  )

const serviceWorker =
  fileURLToPath(
    new URL(
      './src/serviceWorker.js',
      import.meta.url,
    ),
  )

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      input: {
        app: indexHtml,
        serviceWorker,
      },
      output: {
        entryFileNames: (
          chunkInfo,
        ) => {
          if (
            chunkInfo.name ===
            'serviceWorker'
          ) {
            return 'sw.js'
          }

          return (
            'assets/[name]-[hash].js'
          )
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
