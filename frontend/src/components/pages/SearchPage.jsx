import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  API_BASE,
} from "../../api/client.js";

import * as player from
  "../../audioPlayer.js";

import {
  getSearchPreferences,
  saveSearchPreferences,
  searchHypersync,
  SEARCH_SORT_OPTIONS,
} from "../../searchApi.js";

import {
  SEARCH_SUGGESTIONS,
} from "../../constants.js";

import Avatar from
  "../profile/Avatar.jsx";

import Icon from
  "../ui/Icon.jsx";


const EMPTY_RESULTS = {
  query: "",
  interpreted_query: "",
  intent: "general",
  sort_mode: "smart",
  processing_ms: 0,

  counts: {
    tracks: 0,
    artists: 0,
    albums: 0,
    people: 0,
  },

  tracks: [],
  artists: [],
  albums: [],
  people: [],
};


const FILTERS = [
  ["all", "All"],
  ["tracks", "Tracks"],
  ["artists", "Artists"],
  ["albums", "Albums"],
  ["people", "People"],
];


const QUICK_COMMANDS = [
  "my most played",
  "recent songs",
  ...SEARCH_SUGGESTIONS.slice(
    0,
    4,
  ),
];


function resolveArtworkUrl(url) {
  if (!url) {
    return null;
  }

  if (
    url.startsWith("http://") ||
    url.startsWith("https://")
  ) {
    return url;
  }

  return `${API_BASE}${url.replace(
    /^\/api/,
    "",
  )}`;
}


function memberFor(value) {
  if (!value) {
    return "New member";
  }

  const days = Math.max(
    0,
    Math.floor(
      (
        Date.now() -
        new Date(value).getTime()
      ) /
        86400000,
    ),
  );

  if (days < 30) {
    return `${Math.max(
      days,
      1,
    )}d on HyperSync`;
  }

  if (days < 365) {
    return `${Math.max(
      1,
      Math.floor(days / 30),
    )}mo on HyperSync`;
  }

  return `${Math.floor(
    days / 365,
  )}y on HyperSync`;
}


function formatDuration(seconds) {
  const safe = Number(seconds);

  if (
    !Number.isFinite(safe) ||
    safe <= 0
  ) {
    return "--:--";
  }

  const minutes =
    Math.floor(
      safe / 60,
    );

  const remainder =
    Math.floor(
      safe % 60,
    )
      .toString()
      .padStart(
        2,
        "0",
      );

  return (
    `${minutes}:${remainder}`
  );
}


function totalCount(counts) {
  return (
    Number(
      counts?.tracks || 0
    ) +
    Number(
      counts?.artists || 0
    ) +
    Number(
      counts?.albums || 0
    ) +
    Number(
      counts?.people || 0
    )
  );
}


function filterCount(
  filter,
  counts,
) {
  if (filter === "all") {
    return totalCount(
      counts
    );
  }

  return Number(
    counts?.[filter] || 0,
  );
}


function SearchPage({
  query,
  onQueryChange,
  onOpenProfile,
  currentUser,
}) {
  const normalizedQuery =
    query.trim();

  const [
    sortMode,
    setSortMode,
  ] = useState("smart");

  const [
    preferenceReady,
    setPreferenceReady,
  ] = useState(
    !currentUser,
  );

  const [
    preferenceStatus,
    setPreferenceStatus,
  ] = useState(
    currentUser
      ? "loading"
      : "guest",
  );

  const [
    activeFilter,
    setActiveFilter,
  ] = useState("all");

  const [
    selectedTrackIndex,
    setSelectedTrackIndex,
  ] = useState(-1);

  const [
    results,
    setResults,
  ] = useState(
    EMPTY_RESULTS,
  );

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    searchError,
    setSearchError,
  ] = useState("");


  /*
   * Load the user's dropdown
   * choice from PostgreSQL.
   *
   * No localStorage is used.
   */
  useEffect(() => {
    let cancelled = false;

    if (!currentUser) {
      setSortMode("smart");

      setPreferenceReady(
        true,
      );

      setPreferenceStatus(
        "guest",
      );

      return undefined;
    }

    setPreferenceReady(false);

    setPreferenceStatus(
      "loading",
    );

    getSearchPreferences()
      .then((data) => {
        if (cancelled) {
          return;
        }

        setSortMode(
          data?.sort_mode ||
            "smart",
        );

        setPreferenceStatus(
          "synced",
        );

        setPreferenceReady(
          true,
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setSortMode("smart");

        setPreferenceStatus(
          "error",
        );

        setPreferenceReady(
          true,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentUser?.username,
  ]);


  /*
   * Search debounce.
   *
   * Old SearchPage hit both
   * endpoints immediately after
   * every query change.
   *
   * We wait 220ms and abort stale
   * searches while the user types.
   */
  useEffect(() => {
    if (!preferenceReady) {
      return undefined;
    }

    if (!normalizedQuery) {
      setResults(
        EMPTY_RESULTS,
      );

      setLoading(false);
      setSearchError("");

      setSelectedTrackIndex(
        -1,
      );

      return undefined;
    }

    const controller =
      new AbortController();

    setLoading(true);
    setSearchError("");

    const timer =
      window.setTimeout(
        async () => {
          try {
            const data =
              await searchHypersync(
                normalizedQuery,
                sortMode,
                {
                  signal:
                    controller.signal,
                },
              );

            if (
              controller.signal
                .aborted
            ) {
              return;
            }

            setResults({
              ...EMPTY_RESULTS,
              ...(data || {}),

              counts: {
                ...EMPTY_RESULTS.counts,
                ...(data?.counts ||
                  {}),
              },

              tracks:
                data?.tracks || [],

              artists:
                data?.artists || [],

              albums:
                data?.albums || [],

              people:
                data?.people || [],
            });

            setSelectedTrackIndex(
              -1,
            );

          } catch (error) {
            if (
              error?.name ===
              "AbortError"
            ) {
              return;
            }

            setSearchError(
              error instanceof Error
                ? error.message
                : "Unable to search.",
            );

          } finally {
            if (
              !controller.signal
                .aborted
            ) {
              setLoading(false);
            }
          }
        },
        220,
      );

    return () => {
      window.clearTimeout(
        timer,
      );

      controller.abort();
    };

  }, [
    normalizedQuery,
    preferenceReady,
    sortMode,
  ]);


  const resultTotal =
    useMemo(
      () =>
        totalCount(
          results.counts,
        ),
      [results.counts],
    );


  /*
   * IMPORTANT:
   *
   * No extra request happens
   * when play is pressed.
   *
   * The signed B2 audio_url from
   * /api/search is placed directly
   * into the queue.
   */
  function playTrack(
    trackIndex,
  ) {
    const queue =
      results.tracks.map(
        (track) => ({
          id:
            track.id,

          audioUrl:
            track.audio_url,

          artworkUrl:
            resolveArtworkUrl(
              track.artwork_url,
            ),

          title:
            track.title,

          artist:
            track.artist,
        }),
      );

    void player
      .playTrackQueue(
        queue,
        trackIndex,
      )
      .catch(() => {});
  }


  function handleSearchKeyDown(
    event,
  ) {
    const trackCount =
      results.tracks.length;

    if (
      event.key ===
        "ArrowDown" &&
      trackCount > 0
    ) {
      event.preventDefault();

      setSelectedTrackIndex(
        (current) =>
          Math.min(
            current + 1,
            trackCount - 1,
          ),
      );

      return;
    }

    if (
      event.key ===
        "ArrowUp" &&
      trackCount > 0
    ) {
      event.preventDefault();

      setSelectedTrackIndex(
        (current) =>
          Math.max(
            current - 1,
            0,
          ),
      );

      return;
    }

    if (
      event.key ===
        "Enter" &&
      trackCount > 0
    ) {
      event.preventDefault();

      playTrack(
        selectedTrackIndex >= 0
          ? selectedTrackIndex
          : 0,
      );

      return;
    }

    if (
      event.key === "Escape"
    ) {
      onQueryChange("");
    }
  }


  function changeSortMode(
    event,
  ) {
    const nextMode =
      event.target.value;

    setSortMode(
      nextMode,
    );

    if (!currentUser) {
      setPreferenceStatus(
        "guest",
      );

      return;
    }

    setPreferenceStatus(
      "saving",
    );

    void saveSearchPreferences(
      nextMode,
    )
      .then(() => {
        setPreferenceStatus(
          "synced",
        );
      })
      .catch(() => {
        setPreferenceStatus(
          "error",
        );
      });
  }


  const topTrack =
    results.tracks[0] || null;


  const showTracks =
    activeFilter === "all" ||
    activeFilter === "tracks";

  const showArtists =
    activeFilter === "all" ||
    activeFilter === "artists";

  const showAlbums =
    activeFilter === "all" ||
    activeFilter === "albums";

  const showPeople =
    activeFilter === "all" ||
    activeFilter === "people";


  return (
    <div className="page-stack hs-search-page">

      <section className="hs-search-console">

  <div
    className="hs-search-console__grid"
    aria-hidden="true"
  />

  <div
    className={
      "hs-search-console__ambient " +
      "hs-search-console__ambient--one"
    }
    aria-hidden="true"
  />

  <div
    className={
      "hs-search-console__ambient " +
      "hs-search-console__ambient--two"
    }
    aria-hidden="true"
  />


  <div className="hs-search-console__heading">

    <div className="hs-search-console__intro">

      <div className="hs-search-console__eyebrow-row">

        <span className="hs-search-eyebrow">
          <i aria-hidden="true" />

          HYPERSYNC DISCOVERY
        </span>

      </div>


      <h2>
       Tune into something new.
      </h2>


      

    </div>


    <div className="hs-search-sort">

      <label
        htmlFor="hs-search-sort-mode"
      >
        SORT RESULTS
      </label>

      <select
        id="hs-search-sort-mode"
        value={sortMode}
        disabled={!preferenceReady}
        onChange={changeSortMode}
      >
        {SEARCH_SORT_OPTIONS.map(
          (option) => (
            <option
              key={option.value}
              value={option.value}
            >
              {option.label}
            </option>
          ),
        )}
      </select>

      <small>
        {preferenceStatus === "saving"
          ? "SYNCING PREFERENCE"
          : preferenceStatus === "synced"
            ? "PREFERENCE SYNCED"
            : preferenceStatus === "error"
              ? "SYNC RETRY NEEDED"
              : preferenceStatus === "loading"
                ? "LOADING PREFERENCE"
                : "GUEST DEFAULT"}
      </small>

    </div>

  </div>


  <label className="hs-search-input">

    <span className="hs-search-input__icon">
      <Icon
        name="search"
        size={23}
      />
    </span>

    <input
      type="search"
      value={query}
      placeholder={
        "Search songs, artists, albums, or people..."
      }
      autoComplete="off"
      spellCheck="false"
      onChange={(event) => {
        onQueryChange(
          event.target.value,
        );
      }}
      onKeyDown={
        handleSearchKeyDown
      }
    />

    <span
      className={
        loading
          ? "hs-search-scan-dot is-active"
          : "hs-search-scan-dot"
      }
      aria-hidden="true"
    />

  </label>


  <div className="hs-search-console__status">

    <span
      className={
        "hs-search-status-chip " +
        "hs-search-status-chip--primary"
      }
    >
      <i
        className={
          loading
            ? "is-scanning"
            : ""
        }
      />

      {loading
        ? "SEARCHING"
        : normalizedQuery
          ? "RESULTS READY"
          : "SEARCH READY"}
    </span>


    <span className="hs-search-status-chip">
      {normalizedQuery
        ? `${resultTotal} RESULTS`
        : "MUSIC INDEX ONLINE"}
    </span>


    <span className="hs-search-status-chip">
      {normalizedQuery &&
      results.processing_ms
        ? `${results.processing_ms}ms`
        : "SMART MATCHING"}
    </span>

  </div>

</section>


      {normalizedQuery ? (
        <>

          <section className="hs-search-filterbar">

            {FILTERS.map(
              ([
                filter,
                label,
              ]) => (
                <button
                  type="button"
                  key={filter}
                  className={
                    activeFilter ===
                    filter
                      ? "is-active"
                      : ""
                  }
                  onClick={() => {
                    setActiveFilter(
                      filter,
                    );
                  }}
                >
                  <span>
                    {label}
                  </span>

                  <strong>
                    {filterCount(
                      filter,
                      results.counts,
                    )}
                  </strong>
                </button>
              ),
            )}

          </section>


          {searchError ? (
            <section className="hs-search-message hs-search-message--error">

              <Icon
                name="search"
                size={24}
              />

              <div>
                <strong>
                  SEARCH CORE ERROR
                </strong>

                <p>
                  {searchError}
                </p>
              </div>

            </section>
          ) : null}


          {!searchError &&
          !loading &&
          resultTotal === 0 ? (
            <section className="hs-search-message">

              <Icon
                name="search"
                size={28}
              />

              <div>
                <strong>
                  NO SIGNALS FOUND
                </strong>

                <p>
                  Try another title, artist,
                  album, username, or a shorter
                  search phrase.
                </p>
              </div>

            </section>
          ) : null}


          {!searchError &&
          resultTotal > 0 &&
          activeFilter === "all" &&
          topTrack ? (
            <section className="hs-search-top-signal">

              <div className="hs-search-top-signal__label">
                TOP SIGNAL
              </div>

              <div className="hs-search-top-signal__body">

                <div className="hs-search-top-signal__art">

                  {resolveArtworkUrl(
                    topTrack.artwork_url,
                  ) ? (
                    <img
                      src={
                        resolveArtworkUrl(
                          topTrack.artwork_url,
                        )
                      }
                      alt=""
                      fetchPriority="high"
                    />
                  ) : (
                    <Icon
                      name="music"
                      size={34}
                    />
                  )}

                </div>


                <div className="hs-search-top-signal__copy">

                  <span>
                    {topTrack.match_label}
                  </span>

                  <h3>
                    {topTrack.title}
                  </h3>

                  <p>
                    {topTrack.artist}

                    {topTrack.album
                      ? ` • ${topTrack.album}`
                      : ""}
                  </p>

                </div>


                <button
                  type="button"
                  className="hs-search-primary-action"
                  onClick={() => {
                    playTrack(0);
                  }}
                >
                  <Icon
                    name="play"
                    size={18}
                  />

                  PLAY
                </button>

              </div>

            </section>
          ) : null}


          {showTracks &&
          results.tracks.length > 0 ? (

            <section className="hs-search-section">

              <div className="hs-search-section__heading">

                <div>
                  <span>
                    AUDIO INDEX
                  </span>

                  <h3>
                    Tracks
                  </h3>
                </div>

                <strong>
                  {results.counts.tracks}
                </strong>

              </div>


              <div className="hs-search-track-list">

                {results.tracks.map(
                  (
                    track,
                    trackIndex,
                  ) => {

                    const artworkUrl =
                      resolveArtworkUrl(
                        track.artwork_url,
                      );

                    return (
                      <button
                        type="button"
                        key={track.id}
                        className={
                          selectedTrackIndex ===
                          trackIndex
                            ? "hs-search-track is-selected"
                            : "hs-search-track"
                        }
                        onMouseEnter={() => {
                          setSelectedTrackIndex(
                            trackIndex,
                          );
                        }}
                        onClick={() => {
                          playTrack(
                            trackIndex,
                          );
                        }}
                      >

                        <span className="hs-search-track__rank">
                          {String(
                            trackIndex + 1,
                          ).padStart(
                            2,
                            "0",
                          )}
                        </span>


                        <span className="hs-search-track__art">

                          {artworkUrl ? (
                            <img
                              src={artworkUrl}
                              alt=""
                              loading={
                                trackIndex < 6
                                  ? "eager"
                                  : "lazy"
                              }
                              fetchPriority={
                                trackIndex < 3
                                  ? "high"
                                  : "auto"
                              }
                            />
                          ) : (
                            <Icon
                              name="music"
                              size={20}
                            />
                          )}

                          <i aria-hidden="true">
                            <Icon
                              name="play"
                              size={15}
                            />
                          </i>

                        </span>


                        <span className="hs-search-track__copy">

                          <strong>
                            {track.title}
                          </strong>

                          <small>
                            {track.artist}

                            {track.album
                              ? ` • ${track.album}`
                              : ""}
                          </small>

                        </span>


                        <span className="hs-search-track__signals">

                          <em>
                            {track.user_play_count > 0
                              ? "IN YOUR ROTATION"
                              : track.match_label}
                          </em>

                          <small>
                            {track.global_play_count}
                            {" "}
                            plays
                          </small>

                        </span>


                        <span className="hs-search-track__duration">
                          {formatDuration(
                            track.duration_seconds,
                          )}
                        </span>


                        <span className="hs-search-track__play">
                          <Icon
                            name="play"
                            size={16}
                          />
                        </span>

                      </button>
                    );
                  },
                )}

              </div>

            </section>
          ) : null}


          {showArtists &&
          results.artists.length > 0 ? (

            <section className="hs-search-section">

              <div className="hs-search-section__heading">

                <div>
                  <span>
                    ENTITY INDEX
                  </span>

                  <h3>
                    Artists
                  </h3>
                </div>

                <strong>
                  {results.counts.artists}
                </strong>

              </div>


              <div className="hs-search-entity-grid">

                {results.artists.map(
                  (artist) => (

                    <button
                      type="button"
                      key={artist.name}
                      className="hs-search-entity-card"
                      onClick={() => {
                        onQueryChange(
                          `songs by ${artist.name}`,
                        );
                      }}
                    >

                      <span className="hs-search-entity-card__art">

                        {resolveArtworkUrl(
                          artist.artwork_url,
                        ) ? (
                          <img
                            src={
                              resolveArtworkUrl(
                                artist.artwork_url,
                              )
                            }
                            alt=""
                          />
                        ) : (
                          <Icon
                            name="music"
                            size={26}
                          />
                        )}

                      </span>

                      <span>

                        <small>
                          ARTIST
                        </small>

                        <strong>
                          {artist.name}
                        </strong>

                        <em>
                          {artist.track_count}
                          {" "}
                          matching tracks
                        </em>

                      </span>

                      <Icon
                        name="chevron"
                        size={16}
                      />

                    </button>
                  ),
                )}

              </div>

            </section>
          ) : null}


          {showAlbums &&
          results.albums.length > 0 ? (

            <section className="hs-search-section">

              <div className="hs-search-section__heading">

                <div>
                  <span>
                    RELEASE INDEX
                  </span>

                  <h3>
                    Albums
                  </h3>
                </div>

                <strong>
                  {results.counts.albums}
                </strong>

              </div>


              <div className="hs-search-entity-grid">

                {results.albums.map(
                  (album) => (

                    <button
                      type="button"
                      key={
                        `${album.artist}:${album.title}`
                      }
                      className="hs-search-entity-card"
                      onClick={() => {
                        onQueryChange(
                          album.title,
                        );
                      }}
                    >

                      <span className="hs-search-entity-card__art">

                        {resolveArtworkUrl(
                          album.artwork_url,
                        ) ? (
                          <img
                            src={
                              resolveArtworkUrl(
                                album.artwork_url,
                              )
                            }
                            alt=""
                          />
                        ) : (
                          <Icon
                            name="disc"
                            size={26}
                          />
                        )}

                      </span>

                      <span>

                        <small>
                          ALBUM
                        </small>

                        <strong>
                          {album.title}
                        </strong>

                        <em>
                          {album.artist}
                        </em>

                      </span>

                      <Icon
                        name="chevron"
                        size={16}
                      />

                    </button>
                  ),
                )}

              </div>

            </section>
          ) : null}


          {showPeople &&
          results.people.length > 0 ? (

            <section className="hs-search-section">

              <div className="hs-search-section__heading">

                <div>
                  <span>
                    SOCIAL INDEX
                  </span>

                  <h3>
                    People
                  </h3>
                </div>

                <strong>
                  {results.counts.people}
                </strong>

              </div>


              <div className="hs-search-people-list">

                {results.people.map(
                  (person) => (

                    <button
                      type="button"
                      className="hs-search-person"
                      key={
                        person.username
                      }
                      onClick={() => {
                        onOpenProfile?.(
                          person.username,
                        );
                      }}
                    >

                      <Avatar
                        src={
                          person.avatar_url
                        }
                        name={
                          person.display_name
                        }
                        size="small"
                      />

                      <span>

                        <small>
                          {person.match_label}
                        </small>

                        <strong>
                          {person.display_name}
                        </strong>

                        <em>
                          @{person.username}
                          {" • "}
                          {person.followers_count}
                          {" followers • "}
                          {memberFor(
                            person.member_since,
                          )}
                        </em>

                      </span>

                      <Icon
                        name="chevron"
                        size={16}
                      />

                    </button>
                  ),
                )}

              </div>

            </section>
          ) : null}

        </>
      ) : (

        <section className="hs-search-standby">

          <div className="hs-search-standby__symbol">
            <Icon
              name="search"
              size={34}
            />
          </div>

          <span>
            SEARCH ARRAY STANDBY
          </span>

          <h3>
            Try searching for something you love, or use one of the quick commands below.
          </h3>

          <p>
            Try typing a song title, artist, album, or username. HyperSync will prioritize the strongest music matches first.
          </p>

          <div className="hs-search-quick-commands">

            {QUICK_COMMANDS.map(
              (command) => (

                <button
                  type="button"
                  key={command}
                  onClick={() => {
                    onQueryChange(
                      command,
                    );
                  }}
                >
                  {command}
                </button>
              ),
            )}

          </div>

        </section>
      )}

    </div>
  );
}


export default SearchPage;
