import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import PageErrorBoundary from
  "./components/ui/PageErrorBoundary.jsx";
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
    <PageErrorBoundary scope="app">
      <App />
    </PageErrorBoundary>
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
   * A production/preview service worker can survive on the
   * same localhost origin and serve an old Vite client. Vite
   * 8 rejects that client's stale WebSocket token with HTTP
   * 400, and cached HTML/modules can point at files that no
   * longer exist (which leaves the app looking blank).
   *
   * Clear only service workers and app-shell caches. If
   * anything was removed, reload once so the browser fetches
   * the current Vite entry point without the stale worker.
   * The session flag prevents reload loops.
   *
   * Keep offline media databases intact.
   */
  void clearDevelopmentServiceWorkerState()
    .then((result) => {
      const cleared =
        (result?.registrationsCleared ?? 0) > 0 ||
        (result?.appShellCachesCleared ?? 0) > 0;

      const reloadKey =
        "hypersync:dev-service-worker-reload";

      let alreadyReloaded = false;

      try {
        alreadyReloaded =
          globalThis.sessionStorage
            ?.getItem(reloadKey) === "1";
      } catch {
        // If storage is blocked, avoid a forced reload loop.
        return;
      }

      if (cleared && !alreadyReloaded) {
        try {
          globalThis.sessionStorage
            ?.setItem(reloadKey, "1");
        } catch {
          return;
        }

        window.location.reload();
        return;
      }

      if (alreadyReloaded && !cleared) {
        try {
          globalThis.sessionStorage
            ?.removeItem(reloadKey);
        } catch {
          // The app still works if cleanup is unavailable.
        }
      }
    })
    .catch((error) => {
      console.warn(
        "Unable to clear stale development service-worker state.",
        error,
      );
    });
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
