import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import {
  registerHyperSyncServiceWorker,
} from "./serviceWorkerRegistration.js";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("HyperSync could not find the #root element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD) {
  window.addEventListener(
    "load",
    () => {
      void registerHyperSyncServiceWorker()
        .catch(
          (error) => {
            console.error(
              "HyperSync service worker registration failed.",
              error,
            );
          },
        );
    },
  );
}
