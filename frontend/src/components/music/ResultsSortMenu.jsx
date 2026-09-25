import {
  useEffect,
} from "react";

import {
  RESULTS_SORT_OPTIONS,
} from "../../sortResults.js";

import Icon from
  "../ui/Icon.jsx";


export default function ResultsSortMenu({
  menu,
  mode,
  onClose,
  onSelect,
}) {
  useEffect(() => {
    if (!menu) {
      return undefined;
    }

    function handleKeyDown(
      event,
    ) {
      if (
        event.key ===
        "Escape"
      ) {
        onClose();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [
    menu,
    onClose,
  ]);


  if (!menu) {
    return null;
  }

  const activeOption =
    RESULTS_SORT_OPTIONS.find(
      (option) =>
        option.value ===
        mode,
    ) ??
    RESULTS_SORT_OPTIONS[0];


  return (
    <div
      className={[
        "track-action-layer",

        menu.mode ===
          "mobile"
          ? "is-mobile"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="presentation"
      onPointerDown={(
        event,
      ) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <div
        role="menu"
        aria-label="Sort results"
        className="track-action-menu"
        onPointerDown={(
          event,
        ) => {
          event.stopPropagation();
        }}
      >
        <div className="track-action-menu__track">
          <div>
            <strong>
              Sort Results
            </strong>

            <small>
              {activeOption.label}
            </small>
          </div>

          <button
            type="button"
            aria-label="Close sort menu"
            onClick={
              onClose
            }
          >
            <Icon
              name="close"
              size={14}
            />
          </button>
        </div>

        {RESULTS_SORT_OPTIONS.map(
          (option) => {
            const selected =
              option.value ===
              mode;

            return (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={
                  selected
                }
                key={
                  option.value
                }
                onClick={() => {
                  onSelect(
                    option.value,
                  );

                  onClose();
                }}
              >
                <span className="track-action-icon">
                  <Icon
                    name={
                      selected
                        ? "check"
                        : (
                            option.value ===
                              "albums"
                              ? "disc"
                              : option.value ===
                                  "recent"
                                ? "play"
                                : option.value ===
                                    "alphabetical"
                                  ? "search"
                                  : "music"
                          )
                    }
                    size={15}
                  />
                </span>

                <span>
                  {option.label}
                </span>

                {selected ? (
                  <Icon
                    name="check"
                    size={13}
                  />
                ) : null}
              </button>
            );
          },
        )}
      </div>
    </div>
  );
}
