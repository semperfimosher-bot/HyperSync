import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import {
  syncGlobalResetState,
} from "./globalResetSync.js";
import {
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


if (import.meta.env.PROD) {
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
