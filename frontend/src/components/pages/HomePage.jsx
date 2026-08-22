function HomePage({
  currentUser,
  onNavigate,
  onOpenAuth,
}) {
  const greetingName =
    getGreetingName(currentUser);

  const timeGreeting =
    getTimeGreeting();

  const [tracks, setTracks] = useState([]);
  const [catalogError, setCatalogError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadTracks() {
      try {
        const data = await apiRequest("/catalog/tracks");
        if (cancelled) return;
        setTracks(data || []);
        setCatalogError("");
      } catch (error) {
        if (!cancelled) {
          setTracks([]);
          setCatalogError(
            error instanceof Error
              ? error.message
              : "Unable to load catalog.",
          );
        }
      }
    }

    loadTracks();

    return () => {
      cancelled = true;
    };
  }, []);

  const playTrack = async (trackId, track = null) => {
    if (!trackId) return;
    try {
      await player.playTrack(trackId, {
        artworkUrl: track?.artwork_url ?? null,
        title: track?.title ?? "",
        artist: track?.artist ?? "",
      });
    } catch (error) {
      setCatalogError(
        error instanceof Error
          ? error.message
          : "Playback failed.",
      );
    }
  };

  return (
    <div className="page-stack home-page">
      <section className="home-signal">
        <div className="home-signal__content">
          <div className="home-welcome">
            <h2>
              Hello {greetingName},
            </h2>

            <p className="home-welcome__time">
              {timeGreeting}
            </p>

            <div className="home-welcome__tagline">
              <span>your vibe.</span>

              <span>
                your <strong>music.</strong>
              </span>

              <span>
                your <strong>world.</strong>
              </span>
            </div>
          </div>

          <div className="home-signal__status">
            <span>
              <i aria-hidden="true" />

              {currentUser
                ? `Signed in as ${greetingName}`
                : "Sign in to save your music"}
            </span>
          </div>
        </div>

        <div
          className="home-signal__art"
          aria-hidden="true"
        >
          <div className="home-signal__poster">
            <img
              src="/hypersync-home-logo.png"
              alt=""
            />
          </div>
        </div>
      </section>

      <section>
        <SectionHeading
          title="Recently Played"
          actionLabel="View all"
          onAction={() => {
            onNavigate("library");
          }}
        />

        {catalogError ? (
          <div className="empty-content-card">
            <div>
              <strong>Catalog unavailable</strong>
              <p>{catalogError}</p>
            </div>
          </div>
        ) : tracks.length > 0 ? (
          <div className="search-chips">
            {tracks.map((track) => (
              <button
                key={track.id}
                type="button"
                onClick={() => playTrack(track.id, track)}
                title={`Play ${track.title}`}
              >
                {track.title} — {track.artist}
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-content-card">
            <div
              className="empty-content-card__covers"
              aria-hidden="true"
            >
              {[1, 2, 3, 4].map((variant) => (
                <CoverPlaceholder
                  key={variant}
                  variant={variant}
                />
              ))}
            </div>

            <div>
              <strong>
                No listening history yet
              </strong>

              <p>
                Once real playback is connected,
                recently played music will appear
                in this section.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default HomePage
