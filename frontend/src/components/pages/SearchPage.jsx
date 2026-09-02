import {
  useEffect,
  useState,
} from "react";

import {
  API_BASE,
  apiRequest,
} from "../../api/client.js";

import * as player from "../../audioPlayer.js";

import Avatar from "../profile/Avatar.jsx";
import Icon from "../ui/Icon.jsx";
import SectionHeading from "../ui/SectionHeading.jsx";

import {
  SEARCH_CATEGORIES,
  SEARCH_SUGGESTIONS,
} from "../../constants.js";

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

  return `${API_BASE}${url.replace(/^\/api/, "")}`;
}

function memberFor(value) {
  if (!value) {
    return "New member";
  }

  const days =
    Math.max(
      0,
      Math.floor(
        (
          Date.now() -
          new Date(value).getTime()
        ) / 86400000,
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


function SearchPage({
  query,
  onQueryChange,
  onOpenProfile,
}) {
  const normalizedQuery =
    query.trim();

  const [results, setResults] =
    useState([]);

  const [
    userResults,
    setUserResults,
  ] = useState([]);

  const [
    searchError,
    setSearchError,
  ] = useState("");


  useEffect(() => {
    let cancelled = false;

    async function loadResults() {
      if (!normalizedQuery) {
        setResults([]);
        setUserResults([]);
        setSearchError("");
        return;
      }

      try {
        const [
          tracks,
          users,
        ] = await Promise.all([
          apiRequest(
            `/catalog/tracks?q=${encodeURIComponent(
              normalizedQuery,
            )}`,
          ),

          apiRequest(
            `/users/search?q=${encodeURIComponent(
              normalizedQuery,
            )}`,
          ),
        ]);

        if (!cancelled) {
          setResults(
            tracks || [],
          );

          setUserResults(
            users || [],
          );

          setSearchError("");
        }

      } catch (error) {
        if (!cancelled) {
          setResults([]);
          setUserResults([]);

          setSearchError(
            error instanceof Error
              ? error.message
              : "Unable to search.",
          );
        }
      }
    }

    void loadResults();

    return () => {
      cancelled = true;
    };

  }, [normalizedQuery]);


  return (
    <div className="page-stack search-page">
      <label className="mobile-search-field">
        <Icon
          name="search"
          size={17}
        />

        <input
          type="search"
          value={query}
          placeholder="Search songs, artists, albums, or people"
          onChange={(event) => {
            onQueryChange(
              event.target.value,
            );
          }}
        />
      </label>


      <section>
        <SectionHeading
          title="Browse by Category"
        />

        <div className="category-grid">
          {SEARCH_CATEGORIES.map(
            (
              category,
              index,
            ) => (
              <button
                className={
                  `category-card ` +
                  `category-card--${index + 1}`
                }
                type="button"
                key={category.id}
                onClick={() => {
                  onQueryChange(
                    category.label,
                  );
                }}
              >
                <strong>
                  {category.label}
                </strong>

                <Icon
                  name={
                    category.icon
                  }
                  size={31}
                />
              </button>
            ),
          )}
        </div>
      </section>


      <section>
        <SectionHeading
          title="Popular Searches"
        />

        <div className="search-chips">
          {SEARCH_SUGGESTIONS.map(
            (suggestion) => (
              <button
                type="button"
                key={suggestion}
                onClick={() => {
                  onQueryChange(
                    suggestion,
                  );
                }}
              >
                {suggestion}
              </button>
            ),
          )}
        </div>
      </section>


      <section>
        {normalizedQuery ? (
          searchError ? (
            <div className="empty-content-card">
              <div>
                <strong>
                  Search failed
                </strong>

                <p>
                  {searchError}
                </p>
              </div>
            </div>

          ) : (
            <div className="search-results-stack">
              {userResults.length >
              0 ? (
                <div>
                  <SectionHeading
                    title="People"
                  />

                  <div className="user-search-results">
                    {userResults.map(
                      (user) => (
                        <button
                          className="user-search-card hs-user-result"
                          type="button"
                          key={
                            user.username
                          }
                          onClick={() => {
                            onOpenProfile?.(
                              user.username,
                            );
                          }}
                        >
                          <Avatar
                            src={
                              user.avatar_url
                            }
                            name={
                              user.display_name
                            }
                            size="small"
                          />

                          <div>
                            <strong>
                              {
                                user.display_name
                              }
                            </strong>

                            <small>
                              @
                              {
                                user.username
                              }
                            </small>

                            <p>
                              {
                                user.followers_count
                              }
                              {" "}
                              followers
                              {" • "}
                              {memberFor(
                                user.member_since,
                              )}
                            </p>
                          </div>

                          <Icon
                            name="chevron"
                            size={16}
                          />
                        </button>
                      ),
                    )}
                  </div>
                </div>
              ) : null}


              {results.length > 0 ? (
  <div>
    <SectionHeading
      title="Music"
    />

    <div className="search-music-results">
      {results.map((track, trackIndex) => {
        const artworkUrl =
          resolveArtworkUrl(
            track.artwork_url,
          );

        return (
          <button
            key={track.id}
            className="search-music-row"
            type="button"
            onClick={() => {
  const queue =
  results.map(
    (item) => ({
      id:
        item.id,

      audioUrl:
        item.audio_url,

      artworkUrl:
        resolveArtworkUrl(
          item.artwork_url,
        ),

      title:
        item.title,

      artist:
        item.artist,
    }),
  );

  player
    .playTrackQueue(
      queue,
      trackIndex,
    )
    .catch(() => {});
}}
          >
            <div className="search-music-row__art">
              {artworkUrl ? (
                <img
                  src={artworkUrl}
                  alt=""
                />
              ) : (
                <div className="search-music-row__fallback">
                  <Icon
                    name="music"
                    size={20}
                  />
                </div>
              )}

              <span
                className="search-music-row__playing"
                aria-hidden="true"
              >
                ▶
              </span>
            </div>

            <div className="search-music-row__info">
              <strong>
                {track.title}
              </strong>

              <small>
                {track.artist ||
                  "Unknown artist"}
              </small>

              {track.album ? (
                <span>
                  {track.album}
                </span>
              ) : null}
            </div>

            <div
              className="search-music-row__action"
              aria-hidden="true"
            >
              ▶
            </div>
          </button>
        );
      })}
    </div>
  </div>
) : null}


              {results.length ===
                0 &&
              userResults.length ===
                0 ? (
                <div className="search-empty-panel">
                  <Icon
                    name="search"
                    size={30}
                  />

                  <strong>
                    No results found
                  </strong>

                  <p>
                    Try another song,
                    artist, album, or
                    username.
                  </p>
                </div>
              ) : null}
            </div>
          )

        ) : (
          <div className="search-empty-panel">
            <Icon
              name="search"
              size={30}
            />

            <strong>
              Search Hypersynced
            </strong>

            <p>
              Find music and people.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}


export default SearchPage;
