import {
  useEffect,
  useMemo,
  useState,
} from "react";

import TrackArtwork from "../ui/TrackArtwork.jsx";
import Icon from "../ui/Icon.jsx";

import {
  deleteCatalogTrack,
  deleteCatalogTracks,
  useCatalogTracks,
} from "../../catalogStore.js";

import {
  addTrackGroupSelection,
  getTrackGroupSelectionState,
  pruneTrackSelection,
  toggleTrackGroupSelection,
  toggleTrackSelection,
} from "../../catalogSelection.js";

import {
  splitArtistCredits,
} from "../../libraryEntities.js";

import {
  sortCatalogFolderTracks,
} from "../../catalogOrdering.js";


export default function AdminCatalogPage() {
  const {
    tracks,
    loading,
    error,
    refreshCatalog,
  } = useCatalogTracks();

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    searchQuery,
    setSearchQuery,
  ] = useState("");

  const [
    category,
    setCategory,
  ] = useState(null);

  const [
    folderValue,
    setFolderValue,
  ] = useState(null);

  const [
    selectedTrackIds,
    setSelectedTrackIds,
  ] = useState(
    () =>
      new Set(),
  );

  const [
    bulkDeleteBusy,
    setBulkDeleteBusy,
  ] = useState(false);


  useEffect(() => {
    setSelectedTrackIds(
      (current) =>
        pruneTrackSelection(
          current,
          tracks,
        ),
    );
  }, [
    tracks,
  ]);


  const normalizedSearch =
    searchQuery
      .trim()
      .toLocaleLowerCase();


  const folderConfig = {
    artists: {
      label: "Artists",
      icon: "people",
      values:
        (track) => {
          const credits =
            splitArtistCredits(
              track.artist,
            );

          return (
            credits.length > 0
              ? credits
              : [
                  "Unknown Artist",
                ]
          );
        },
    },

    albums: {
      label: "Albums",
      icon: "disc",
      value:
        (track) =>
          track.album ||
          "No Album",
    },

    genres: {
      label: "Genres",
      icon: "music",
      value:
        (track) =>
          track.genre ||
          "No Genre",
    },
  };


  const folderValuesForTrack =
    (
      config,
      track,
    ) => {
      const rawValues =
        typeof config?.values ===
        "function"
          ? config.values(
              track,
            )
          : [
              config?.value?.(
                track,
              ),
            ];

      const seen =
        new Set();

      return rawValues
        .map(
          (value) =>
            String(
              value ?? "",
            ).trim(),
        )
        .filter(
          (value) => {
            if (!value) {
              return false;
            }

            const key =
              value
                .toLocaleLowerCase();

            if (
              seen.has(
                key,
              )
            ) {
              return false;
            }

            seen.add(
              key,
            );

            return true;
          },
        );
    };


  const searchResults =
    useMemo(
      () => {
        if (!normalizedSearch) {
          return [];
        }

        return tracks.filter(
          (track) =>
            [
              track.title,
              track.artist,
              track.album,
              track.genre,
            ]
              .filter(Boolean)
              .some(
                (value) =>
                  String(value)
                    .toLocaleLowerCase()
                    .includes(
                      normalizedSearch,
                    ),
              ),
        );
      },
      [
        normalizedSearch,
        tracks,
      ],
    );


  const folders =
    useMemo(
      () => {
        if (!category) {
          return [];
        }

        const config =
          folderConfig[
            category
          ];

        if (!config) {
          return [];
        }

        const grouped =
          new Map();

        tracks.forEach(
          (track) => {
            folderValuesForTrack(
              config,
              track,
            ).forEach(
              (value) => {
                const key =
                  value
                    .toLocaleLowerCase();

                if (
                  !grouped.has(
                    key,
                  )
                ) {
                  grouped.set(
                    key,
                    {
                      key,
                      value,
                      tracks: [],
                    },
                  );
                }

                grouped
                  .get(
                    key,
                  )
                  .tracks
                  .push(
                    track,
                  );
              },
            );
          },
        );

        return Array.from(
          grouped.values(),
        ).sort(
          (
            left,
            right,
          ) =>
            String(
              left.value,
            ).localeCompare(
              String(
                right.value,
              ),
              undefined,
              {
                sensitivity:
                  "base",
              },
            ),
        );
      },
      [
        category,
        tracks,
      ],
    );


  const folderTracks =
    useMemo(
      () => {
        if (
          !category ||
          !folderValue
        ) {
          return [];
        }

        const config =
          folderConfig[
            category
          ];

        const wanted =
          String(
            folderValue,
          )
            .trim()
            .toLocaleLowerCase();

        const matchingTracks =
          tracks.filter(
            (track) =>
              folderValuesForTrack(
                config,
                track,
              ).some(
                (value) =>
                  value
                    .toLocaleLowerCase()
                    === wanted,
              ),
          );

        return sortCatalogFolderTracks(
          matchingTracks,
        );
      },
      [
        category,
        folderValue,
        tracks,
      ],
    );


  const visibleTrackIds =
    (
      normalizedSearch
        ? searchResults
        : folderValue
          ? folderTracks
          : []
    ).map(
      (track) =>
        String(
          track.id,
        ),
    );

  const selectedTrackCount =
    selectedTrackIds.size;


  const deleteSelectedTracks =
    async () => {
      if (
        bulkDeleteBusy ||
        selectedTrackCount ===
          0
      ) {
        return;
      }

      const requestedTrackIds =
        Array.from(
          selectedTrackIds,
        );

      setBulkDeleteBusy(
        true,
      );

      setMessage("");

      try {
        const result =
          await deleteCatalogTracks(
            requestedTrackIds,
          );

        const deletedTrackIds =
          new Set(
            (
              Array.isArray(
                result?.deleted_track_ids,
              )
                ? result.deleted_track_ids
                : []
            ).map(
              (trackId) =>
                String(
                  trackId,
                ),
            ),
          );

        setSelectedTrackIds(
          (current) =>
            new Set(
              Array.from(
                current,
              ).filter(
                (trackId) =>
                  !deletedTrackIds.has(
                    String(
                      trackId,
                    ),
                  ),
              ),
            ),
        );

        const failed =
          Array.isArray(
            result?.failed,
          )
            ? result.failed
            : [];

        if (
          failed.length >
          0
        ) {
          setMessage(
            `Deleted ${result?.deleted_count ?? deletedTrackIds.size} songs; ${failed.length} could not be deleted.`,
          );
        } else {
          setMessage(
            `Deleted ${result?.deleted_count ?? deletedTrackIds.size} selected songs.`,
          );

          setSelectedTrackIds(
            new Set(),
          );
        }

      } catch (deleteError) {
        setMessage(
          deleteError instanceof Error
            ? deleteError.message
            : "Unable to delete selected tracks.",
        );

      } finally {
        setBulkDeleteBusy(
          false,
        );
      }
    };


  const deleteTrack =
    async (
      track,
    ) => {
      setMessage("");

      try {
        await deleteCatalogTrack(
          track.id,
        );

        setSelectedTrackIds(
          (current) => {
            const next =
              new Set(
                current,
              );

            next.delete(
              String(
                track.id,
              ),
            );

            return next;
          },
        );

        setMessage(
          `Deleted "${track.title}".`,
        );
      } catch (deleteError) {
        setMessage(
          deleteError instanceof Error
            ? deleteError.message
            : "Unable to delete track.",
        );
      }
    };


  const renderFile =
    (
      track,
    ) => {
      const trackId =
        String(
          track.id,
        );

      const selected =
        selectedTrackIds.has(
          trackId,
        );

      return (
      <div
        className={
          selected
            ? "admin-explorer-file is-selected"
            : "admin-explorer-file"
        }
        key={track.id}
        onContextMenu={(
          event,
        ) => {
          event.preventDefault();

          if (
            bulkDeleteBusy
          ) {
            return;
          }

          setSelectedTrackIds(
            (current) =>
              toggleTrackSelection(
                current,
                trackId,
              ),
          );
        }}
      >
        <TrackArtwork
          src={track.artwork_url}
          alt={track.title}
          variant={1}
        />

        <div className="admin-explorer-file__copy">
          <strong>
            {track.title}
          </strong>

          <span>
            {track.artist}
            {" • "}
            {track.album ||
              "No album"}
            {" • "}
            {track.genre ||
              "No genre"}
          </span>
        </div>

        <span className="admin-explorer-file__type">
          {String(
            track.mime_type ||
              "audio",
          )
            .replace(
              "audio/",
              "",
            )
            .toUpperCase()}
        </span>

        <button
          type="button"
          className="danger-button"
          onClick={() => {
            void deleteTrack(
              track,
            );
          }}
        >
          Delete
        </button>
      </div>
      );
    };


  let explorerBody = null;

  if (loading) {
    explorerBody = (
      <div className="admin-empty-state">
        <Icon
          name="chart"
          size={28}
        />

        <strong>
          Loading catalog...
        </strong>
      </div>
    );

  } else if (
    normalizedSearch
  ) {
    explorerBody =
      searchResults.length > 0
        ? (
          <div className="admin-explorer-files">
            {searchResults.map(
              renderFile,
            )}
          </div>
        )
        : (
          <div className="admin-empty-state">
            <Icon
              name="search"
              size={28}
            />

            <strong>
              No files or folders match
            </strong>

            <p>
              Search title, artist,
              album, or genre.
            </p>
          </div>
        );

  } else if (!category) {
    explorerBody = (
      <div className="admin-explorer-folder-grid">
        {Object.entries(
          folderConfig,
        ).map(
          ([
            key,
            config,
          ]) => {
            const count =
              new Set(
                tracks.flatMap(
                  (track) =>
                    folderValuesForTrack(
                      config,
                      track,
                    ).map(
                      (value) =>
                        value
                          .toLocaleLowerCase(),
                    ),
                ),
              ).size;

            return (
              <button
                type="button"
                className="admin-explorer-folder"
                key={key}
                onClick={() => {
                  setCategory(
                    key,
                  );

                  setFolderValue(
                    null,
                  );
                }}
              >
                <span className="admin-explorer-folder__icon">
                  <Icon
                    name={
                      config.icon
                    }
                    size={24}
                  />
                </span>

                <span>
                  <strong>
                    {config.label}
                  </strong>

                  <small>
                    {count}
                    {" folders"}
                  </small>
                </span>

                <Icon
                  name="chevron"
                  size={15}
                />
              </button>
            );
          },
        )}

      </div>
    );

  } else if (
    category &&
    !folderValue
  ) {
    explorerBody = (
      <div className="admin-explorer-folder-list">
        {folders.map(
          (folder) => {
            const folderTrackIds =
              folder.tracks.map(
                (track) =>
                  String(
                    track.id,
                  ),
              );

            const selectionState =
              getTrackGroupSelectionState(
                selectedTrackIds,
                folderTrackIds,
              );

            const artistSelectable =
              category ===
              "artists";

            const folderClassName =
              [
                "admin-explorer-folder",
                "admin-explorer-folder--row",
                selectionState.allSelected
                  ? "is-selected"
                  : "",
                selectionState.partiallySelected
                  ? "is-partial"
                  : "",
                artistSelectable
                  ? "is-multiselectable"
                  : "",
              ]
                .filter(
                  Boolean,
                )
                .join(
                  " ",
                );

            return (
            <button
              type="button"
              className={
                folderClassName
              }
              key={folder.key}
              onClick={() => {
                setFolderValue(
                  folder.value,
                );
              }}
              onContextMenu={(
                event,
              ) => {
                if (
                  !artistSelectable
                ) {
                  return;
                }

                event.preventDefault();

                if (
                  bulkDeleteBusy
                ) {
                  return;
                }

                setSelectedTrackIds(
                  (current) =>
                    toggleTrackGroupSelection(
                      current,
                      folderTrackIds,
                    ),
                );
              }}
              title={
                artistSelectable
                  ? "Right-click to select every song by this artist"
                  : undefined
              }
            >
              <span className="admin-explorer-folder__icon">
                <Icon
                  name={
                    folderConfig[
                      category
                    ].icon
                  }
                  size={20}
                />
              </span>

              <span>
                <strong>
                  {folder.value}
                </strong>

                <small>
                  {folder.tracks.length}
                  {" files"}

                  {artistSelectable &&
                  selectionState.selectedCount >
                    0
                    ? (
                        " • " +
                        selectionState.selectedCount +
                        " selected"
                      )
                    : ""}
                </small>
              </span>

              <Icon
                name="chevron"
                size={15}
              />
            </button>
            );
          },
        )}
      </div>
    );

  } else {
    explorerBody = (
      <div className="admin-explorer-files">
        {folderTracks.map(
          renderFile,
        )}
      </div>
    );
  }


  return (
    <div className="page-stack hs-search-page admin-page admin-catalog-explorer-page">
      <section className="hs-search-console admin-command-console">
        <div
          className="hs-search-console__grid"
          aria-hidden="true"
        />

        <div
          className="hs-search-console__ambient hs-search-console__ambient--one"
          aria-hidden="true"
        />

        <div className="hs-search-console__heading admin-command-console__heading">
          <div className="hs-search-console__intro">
            <div className="hs-search-console__eyebrow-row">
              <span className="hs-search-eyebrow">
                <i aria-hidden="true" />
                MEDIA STORAGE
              </span>
            </div>

            <h2>
              Catalog Explorer
            </h2>

            <p className="admin-command-console__copy">
              Browse the music catalog like a
              file system or search across
              artists, albums, genres, and tracks.
            </p>
          </div>

          <button
            type="button"
            className="hs-search-primary-action admin-refresh-button"
            disabled={loading}
            onClick={() => {
              refreshCatalog({
                force: true,
              });
            }}
          >
            <Icon
              name="chart"
              size={16}
            />

            {loading
              ? "Refreshing..."
              : "Refresh"}
          </button>
        </div>

        <label className="hs-search-input admin-explorer-search">
          <span className="hs-search-input__icon">
            <Icon
              name="search"
              size={17}
            />
          </span>

          <input
            type="search"
            value={searchQuery}
            placeholder="Search files, artists, albums, or genres..."
            onChange={(
              event,
            ) => {
              setSearchQuery(
                event.target.value,
              );
            }}
          />
        </label>

        <div className="admin-explorer-breadcrumb">
          <button
            type="button"
            onClick={() => {
              setCategory(null);
              setFolderValue(null);
              setSearchQuery("");
            }}
          >
            Catalog
          </button>

          {category ? (
            <>
              <Icon
                name="chevron"
                size={12}
              />

              <button
                type="button"
                onClick={() => {
                  setFolderValue(
                    null,
                  );

                  setSearchQuery(
                    "",
                  );
                }}
              >
                {folderConfig[
                  category
                ].label}
              </button>
            </>
          ) : null}

          {folderValue ? (
            <>
              <Icon
                name="chevron"
                size={12}
              />

              <span>
                {folderValue}
              </span>
            </>
          ) : null}

          {normalizedSearch ? (
            <>
              <Icon
                name="chevron"
                size={12}
              />

              <span>
                Search
              </span>
            </>
          ) : null}
        </div>
      </section>

      {message || error ? (
        <div className="admin-alert">
          <Icon
            name="shield"
            size={18}
          />

          <span>
            {message || error}
          </span>
        </div>
      ) : null}

      <section className="admin-panel admin-explorer-shell">
        <div className="admin-panel__heading">
          <div>
            <span>
              FILE EXPLORER
            </span>

            <h3>
              {normalizedSearch
                ? "Search Results"
                : folderValue ||
                  (
                    category
                      ? folderConfig[
                          category
                        ].label
                      : "Catalog Root"
                  )}
            </h3>
          </div>

          <strong className="admin-panel-count">
            {normalizedSearch
              ? searchResults.length
              : folderValue
                ? folderTracks.length
                : category
                  ? folders.length
                  : tracks.length}
            {" items"}
          </strong>
        </div>

        <div
          className={
            selectedTrackCount >
              0
              ? "admin-explorer-selection-bar is-active"
              : "admin-explorer-selection-bar"
          }
        >
          <span>
            {selectedTrackCount >
            0
              ? (
                  selectedTrackCount +
                  " songs selected"
                )
              : "Right-click songs or artist folders to select multiple items while you scroll."}
          </span>

          {selectedTrackCount >
          0 ? (
            <div className="admin-explorer-selection-bar__actions">
              {visibleTrackIds.length >
              0 ? (
                <button
                  type="button"
                  disabled={
                    bulkDeleteBusy
                  }
                  onClick={() => {
                    setSelectedTrackIds(
                      (current) =>
                        addTrackGroupSelection(
                          current,
                          visibleTrackIds,
                        ),
                    );
                  }}
                >
                  Select all shown
                </button>
              ) : null}

              <button
                type="button"
                disabled={
                  bulkDeleteBusy
                }
                onClick={() => {
                  setSelectedTrackIds(
                    new Set(),
                  );
                }}
              >
                Clear
              </button>

              <button
                type="button"
                className="danger-button"
                disabled={
                  bulkDeleteBusy
                }
                onClick={() => {
                  void deleteSelectedTracks();
                }}
              >
                {bulkDeleteBusy
                  ? (
                      "Deleting " +
                      selectedTrackCount +
                      "..."
                    )
                  : (
                      "Delete selected (" +
                      selectedTrackCount +
                      ")"
                    )}
              </button>
            </div>
          ) : null}
        </div>

        {explorerBody}
      </section>
    </div>
  );
}
