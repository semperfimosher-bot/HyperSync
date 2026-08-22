function SearchPage({
  query,
  onQueryChange,
}) {
  const normalizedQuery = query.trim();
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadResults() {
      if (!normalizedQuery) {
        setResults([]);
        setSearchError("");
        return;
      }

      try {
        const data = await apiRequest(
          `/catalog/tracks?q=${encodeURIComponent(normalizedQuery)}`,
        );

        if (!cancelled) {
          setResults(data || []);
          setSearchError("");
        }
      } catch (error) {
        if (!cancelled) {
          setResults([]);
          setSearchError(
            error instanceof Error
              ? error.message
              : "Unable to search the catalog.",
          );
        }
      }
    }

    loadResults();

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
          placeholder={
            "Search for songs, artists, or albums"
          }
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
        />
      </label>

      <section>
        <SectionHeading title="Browse by Category" />

        <div className="category-grid">
          {SEARCH_CATEGORIES.map(
            (category, index) => (
              <button
                className={
                  `category-card ` +
                  `category-card--${index + 1}`
                }
                type="button"
                key={category.id}
                onClick={() => {
                  onQueryChange(category.label);
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
        <SectionHeading title="Popular Searches" />

        <div className="search-chips">
          {SEARCH_SUGGESTIONS.map(
            (suggestion) => (
              <button
                type="button"
                key={suggestion}
                onClick={() => {
                  onQueryChange(suggestion);
                }}
              >
                {suggestion}
              </button>
            ),
          )}
        </div>
      </section>

      <section>
        <SectionHeading
          title={
            normalizedQuery
              ? `Results for “${normalizedQuery}”`
              : "Suggested for You"
          }
        />

        {normalizedQuery ? (
          searchError ? (
            <div className="empty-content-card">
              <div>
                <strong>Search failed</strong>
                <p>{searchError}</p>
              </div>
            </div>
          ) : results.length > 0 ? (
            <div className="search-chips">
              {results.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => {
                    player.playTrack(track.id, {
                      artworkUrl: track.artwork_url,
                      title: track.title,
                      artist: track.artist,
                    }).catch(() => {});
                  }}
                >
                  {track.title} — {track.artist}
                </button>
              ))}
            </div>
          ) : (
            <div className="search-empty-panel">
              <Icon
                name="search"
                size={30}
              />

              <strong>No songs match this search</strong>

              <p>
                Try another title, artist, or album name.
              </p>
            </div>
          )
        ) : (
          <div className="search-empty-panel">
            <Icon
              name="search"
              size={30}
            />

            <strong>Suggestions are waiting for your catalog</strong>

            <p>
              Real recommendations will be calculated from the catalog once you search for music.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

export default SearchPage