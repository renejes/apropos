import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Eigenständiger stdio-MCP-Server; läuft via ELECTRON_RUN_AS_NODE=1
          // mit derselben better-sqlite3-ABI wie die App (Review-Finding).
          stdio: resolve(__dirname, 'src/main/mcp/stdio-entry.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@renderer': resolve(__dirname, 'src/renderer/src') },
    },
  },
})
