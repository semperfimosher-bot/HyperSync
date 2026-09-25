import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";


const LONG_PRESS_MS = 520;
const MOVE_LIMIT = 12;


export default function useCollectionActionMenu() {
  const [
    menu,
    setMenu,
  ] = useState(null);

  const timerRef =
    useRef(null);

  const pointerRef =
    useRef(null);

  const suppressClickRef =
    useRef(false);


  const clearLongPress =
    useCallback(() => {
      if (timerRef.current) {
        window.clearTimeout(
          timerRef.current,
        );

        timerRef.current =
          null;
      }

      pointerRef.current =
        null;
    }, []);


  const closeMenu =
    useCallback(() => {
      clearLongPress();
      setMenu(null);
    }, [
      clearLongPress,
    ]);


  useEffect(() => {
    return () => {
      clearLongPress();
    };
  }, [
    clearLongPress,
  ]);


  const getTriggerProps =
    useCallback(
      (collection) => ({
        onContextMenu:
          (event) => {
            if (
              !collection?.key
            ) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();

            clearLongPress();

            setMenu({
              ...collection,
              mode:
                "desktop",
              x:
                event.clientX,
              y:
                event.clientY,
            });
          },

        onPointerDown:
          (event) => {
            if (
              event.pointerType !==
                "touch" ||
              !collection?.key
            ) {
              return;
            }

            clearLongPress();

            const x =
              event.clientX;
            const y =
              event.clientY;

            pointerRef.current = {
              pointerId:
                event.pointerId,
              x,
              y,
            };

            timerRef.current =
              window.setTimeout(
                () => {
                  suppressClickRef.current =
                    true;

                  setMenu({
                    ...collection,
                    mode:
                      "mobile",
                    x,
                    y,
                  });

                  timerRef.current =
                    null;

                  window.setTimeout(
                    () => {
                      suppressClickRef.current =
                        false;
                    },
                    800,
                  );
                },
                LONG_PRESS_MS,
              );
          },

        onPointerMove:
          (event) => {
            const pointer =
              pointerRef.current;

            if (
              !pointer ||
              pointer.pointerId !==
                event.pointerId
            ) {
              return;
            }

            if (
              Math.abs(
                event.clientX -
                  pointer.x,
              ) >
                MOVE_LIMIT ||
              Math.abs(
                event.clientY -
                  pointer.y,
              ) >
                MOVE_LIMIT
            ) {
              clearLongPress();
            }
          },

        onPointerUp:
          clearLongPress,

        onPointerCancel:
          clearLongPress,

        onClickCapture:
          (event) => {
            if (
              !suppressClickRef.current
            ) {
              return;
            }

            suppressClickRef.current =
              false;

            event.preventDefault();
            event.stopPropagation();
          },
      }),
      [
        clearLongPress,
      ],
    );


  return {
    menu,
    closeMenu,
    getTriggerProps,
  };
}
