import {
  useEffect,
  useRef,
} from "react";


export const QUIET_REFRESH_DEFAULT_MS =
  30_000;


export default function useQuietRefresh(
  refresh,
  {
    enabled = true,
    intervalMs =
      QUIET_REFRESH_DEFAULT_MS,
  } = {},
) {
  const refreshRef =
    useRef(
      refresh,
    );

  const inFlightRef =
    useRef(
      false,
    );


  useEffect(() => {
    refreshRef.current =
      refresh;
  }, [
    refresh,
  ]);


  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let disposed =
      false;

    const canRefresh =
      () => (
        !disposed &&
        globalThis.navigator
          ?.onLine !==
          false &&
        globalThis.document
          ?.visibilityState !==
          "hidden"
      );

    const run =
      async () => {
        if (
          !canRefresh() ||
          inFlightRef.current
        ) {
          return;
        }

        inFlightRef.current =
          true;

        try {
          await refreshRef
            .current?.();
        } catch {
          /*
           * Quiet refreshes never replace
           * usable on-screen data with a
           * background request error.
           */
        } finally {
          inFlightRef.current =
            false;
        }
      };

    const handleFocus =
      () => {
        void run();
      };

    const handleOnline =
      () => {
        void run();
      };

    const handleVisibility =
      () => {
        if (
          globalThis.document
            ?.visibilityState ===
            "visible"
        ) {
          void run();
        }
      };

    const intervalId =
      intervalMs > 0
        ? globalThis.window
            ?.setInterval(
              () => {
                void run();
              },
              intervalMs,
            )
        : null;

    globalThis.window
      ?.addEventListener(
        "focus",
        handleFocus,
      );

    globalThis.window
      ?.addEventListener(
        "online",
        handleOnline,
      );

    globalThis.document
      ?.addEventListener(
        "visibilitychange",
        handleVisibility,
      );

    return () => {
      disposed =
        true;

      if (
        intervalId != null
      ) {
        globalThis.window
          ?.clearInterval(
            intervalId,
          );
      }

      globalThis.window
        ?.removeEventListener(
          "focus",
          handleFocus,
        );

      globalThis.window
        ?.removeEventListener(
          "online",
          handleOnline,
        );

      globalThis.document
        ?.removeEventListener(
          "visibilitychange",
          handleVisibility,
        );
    };
  }, [
    enabled,
    intervalMs,
  ]);
}
