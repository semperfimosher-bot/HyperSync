import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import {
  syncGlobalResetState,
} from "./globalResetSync.js";
import {
  clearDevelopmentServiceWorkerState,
  registerHyperSyncServiceWorker,
} from "./serviceWorkerRegistration.js";

import {
  initializePwaInstall,
} from "./pwaInstall.js";
import "./styles.css";

initializePwaInstall();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("HyperSync could not find the #root element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

let resetSyncInFlight =
  null;


function syncResetAndReload() {
  if (resetSyncInFlight) {
    return resetSyncInFlight;
  }

  resetSyncInFlight =
    syncGlobalResetState()
      .then(
        (result) => {
          if (
            result
              ?.resetApplied
          ) {
            window.location.replace(
              "/",
            );
          }

          return result;
        },
      )
      .catch(
        () => null,
      )
      .finally(
        () => {
          resetSyncInFlight =
            null;
        },
      );

  return resetSyncInFlight;
}


void syncResetAndReload();


window.addEventListener(
  "online",
  () => {
    void syncResetAndReload();
  },
);


if (import.meta.env.DEV) {
  /*
   * A production/preview service worker can
   * survive on the same localhost origin and
   * cache an old Vite client. Vite 8 uses a
   * per-process WebSocket token, so that stale
   * client is rejected with HTTP 400.
   *
   * Keep offline media databases intact; only
   * remove service workers and app-shell caches.
   */
  void clearDevelopmentServiceWorkerState()
    .catch(
      () => {},
    );
} else if (import.meta.env.PROD) {
  const registerAppWorker =
    () => {
      void registerHyperSyncServiceWorker()
        .then(
          (registration) => {
            void registration
              ?.update?.();
          },
        )
        .catch(
          (error) => {
            console.error(
              "HyperSync service worker registration failed.",
              error,
            );
          },
        );
    };

  /*
   * Register immediately so Chromium can
   * evaluate installability without waiting
   * for every image/font to finish loading.
   */
  registerAppWorker();

  window.addEventListener(
    "online",
    registerAppWorker,
  );
}
