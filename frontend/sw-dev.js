/*
 * Development-only root-scope service worker.
 *
 * Keeping the registered script at /sw-dev.js
 * lets localhost use scope "/" without needing
 * Service-Worker-Allowed header exceptions.
 *
 * Vite serves/transforms the real worker module
 * from /src during development.
 */
import "./src/serviceWorker.js";
