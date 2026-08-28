import {
  useEffect,
  useState,
} from "react";

import {
  apiRequest,
} from "../../api/client.js";

import * as player from "../../audioPlayer.js";

import Icon from "../ui/Icon.jsx";
import SectionHeading from "../ui/SectionHeading.jsx";

import {
  SEARCH_CATEGORIES,
  SEARCH_SUGGESTIONS,
} from "../../constants.js";


function SearchPage({
  query,
  onQueryChange,
}) {
  const normalizedQuery =
    query.trim();

  const [
    results,
    setResults,
  ] = useState([]);

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

    loadResults();

    return () => {
      cancelled = true;
    };
  }, [
    normalizedQuery,
  ]);


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
          placeholder={
            "Search for songs, artists, albums, or people"
          }
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
                  name={category.icon}
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
              {userResults.length > 0 ? (
                <div>
                  <SectionHeading
                    title="People"
                  />

                  <div className="user-search-results">
                    {userResults.map(
                      (user) => (
                        <button
                          className="user-search-card"
                          type="button"
                          key={user.username}
                          onClick={() => {
                            window.location.hash =
                              `profile/${encodeURIComponent(
                                user.username,
                              )}`;
                          }}
                        >
                          {user.avatar_url ? (
                            <img
                              src={user.avatar_url}
                              alt=""
                            />
                          ) : (
                            <span>
                              {user.display_name
                                .slice(0, 2)
                                .toUpperCase()}
                            </span>
                          )}

                          <div>
                            <strong>
                              {user.display_name}
                            </strong>

                            <small>
                              @{user.username}
                            </small>

                            {user.bio ? (
                              <p>
                                {user.bio}
                              </p>
                            ) : null}
                          </div>
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

                  <div className="search-chips">
                    {results.map(
                      (track) => (
                        <button
                          key={track.id}
                          type="button"
                          onClick={() => {
                            player.playTrack(
                              track.id,
                              {
                                artworkUrl:
                                  track.artwork_url,

                                title:
                                  track.title,

                                artist:
                                  track.artist,
                              },
                            ).catch(() => {});
                          }}
                        >
                          {track.title}
                          {" — "}
                          {track.artist}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              ) : null}


              {results.length === 0 &&
              userResults.length === 0 ? (
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
              Search HyperSync
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
