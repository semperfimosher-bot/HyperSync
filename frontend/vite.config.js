import {
  setDefaultResultOrder,
} from 'node:dns'
import {
  fileURLToPath,
} from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

setDefaultResultOrder(
  'verbatim',
)

const DEFAULT_DEV_HOST =
  'localhost'

const DEFAULT_DEV_PORT =
  4153

const DEFAULT_BACKEND_PORT =
  8000

function readPort(
  value,
  fallback,
) {
  const parsed =
    Number.parseInt(
      String(
        value ?? '',
      ),
      10,
    )

  return (
    Number.isInteger(
      parsed,
    ) &&
    parsed >= 1024 &&
    parsed <= 65535
  )
    ? parsed
    : fallback
}

const devHost =
  String(
    process.env
      .HYPERSYNC_DEV_HOST ??
    DEFAULT_DEV_HOST,
  ).trim() ||
  DEFAULT_DEV_HOST

const devPort =
  readPort(
    process.env
      .HYPERSYNC_DEV_PORT,
    DEFAULT_DEV_PORT,
  )

const backendPort =
  readPort(
    process.env
      .HYPERSYNC_BACKEND_PORT,
    DEFAULT_BACKEND_PORT,
  )

const apiTarget =
  `http://127.0.0.1:${backendPort}`

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
    host:
      devHost,
    port:
      devPort,
    strictPort:
      true,
    ws: {
      host:
        devHost,
      clientPort:
        devPort,
    },
    headers: {
      'Service-Worker-Allowed': '/',
    },
    proxy: {
      '/api': {
        target:
          apiTarget,
        changeOrigin:
          true,
      },
    },
  },
  preview: {
    proxy: {
      '/api': {
        target:
          apiTarget,
        changeOrigin:
          true,
      },
    },
  },
})
