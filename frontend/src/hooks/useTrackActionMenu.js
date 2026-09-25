import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";


const LONG_PRESS_MS = 520;
const MOVE_LIMIT = 12;


export default function useTrackActionMenu() {
  const [
    menu,
    setMenu,
  ] = useState(
    null,
  );

  const timerRef =
    useRef(null);

  const pointerRef =
    useRef(null);

  const suppressClickRef =
    useRef(false);


  const clearLongPress =
    useCallback(
      () => {
        if (
          timerRef.current
        ) {
          window.clearTimeout(
            timerRef.current,
          );

          timerRef.current =
            null;
        }

        pointerRef.current =
          null;
      },
      [],
    );


  const closeMenu =
    useCallback(
      () => {
        clearLongPress();

        setMenu(
          null,
        );
      },
      [
        clearLongPress,
      ],
    );


  useEffect(() => {
    return () => {
      clearLongPress();
    };
  }, [
    clearLongPress,
  ]);


  const getTriggerProps =
    useCallback(
      (
        track,
        options = {},
      ) => ({
        onContextMenu:
          (event) => {
            if (
              !track?.id
            ) {
              return;
            }

            event.preventDefault();

            event.stopPropagation();

            clearLongPress();

            setMenu({
              track,

              contextActions:
                Array.isArray(
                  options.actions,
                )
                  ? options.actions
                  : [],

              hideLikeAction:
                Boolean(
                  options.hideLikeAction,
                ),

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
              !track?.id
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
                    track,

                    contextActions:
                      Array.isArray(
                        options.actions,
                      )
                        ? options.actions
                        : [],

                    hideLikeAction:
                      Boolean(
                        options.hideLikeAction,
                      ),

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

            const movedX =
              Math.abs(
                event.clientX -
                  pointer.x,
              );

            const movedY =
              Math.abs(
                event.clientY -
                  pointer.y,
              );

            if (
              movedX >
                MOVE_LIMIT ||
              movedY >
                MOVE_LIMIT
            ) {
              clearLongPress();
            }
          },


        onPointerUp:
          () => {
            clearLongPress();
          },


        onPointerCancel:
          () => {
            clearLongPress();
          },


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
