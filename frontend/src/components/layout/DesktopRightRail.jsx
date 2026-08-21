function DesktopRightRail() {
  const [state, setState] = useState(() => ({
    src: null,
    artworkUrl: null,
    title: "",
    artist: "",
    paused: true,
    currentTime: 0,
    duration: 0,
  }));

  useEffect(() => {
    const unsub = player.subscribe((s) => {
      setState(s);
    });

    return unsub;
  }, []);

  const titleText = state.title || "No track selected";
  const hasTrack = Boolean(state.src);

  return (
    <aside className="desktop-right-rail">
      <div className="right-rail-heading">
        <span>Now playing</span>

        <h2>
          {titleText}
        </h2>
      </div>

      <div className="right-rail-art">
        <TrackArtwork
          src={state.artworkUrl}
          alt={state.title || "No track artwork"}
          variant={2}
        />
      </div>

      {!hasTrack ? (
        <div className="right-rail-empty">
          <Icon
            name="music"
            size={28}
          />

          <strong>Playback is waiting</strong>

          <p>
            Choose a track to start listening.
          </p>
        </div>
      ) : (
        <div className="right-rail-empty">
          <strong>
            {state.artist || "Unknown artist"}
          </strong>
        </div>
      )}

      <div
        className="right-rail-tabs"
        role="tablist"
        aria-label="Player details"
      >
        <button
          type="button"
          className="is-active"
        >
          Queue
        </button>

        <button type="button">
          Lyrics
        </button>
      </div>

      <div className="right-rail-list">
        <span>Queue is empty</span>

        <small>
          Add tracks to your queue to see them here.
        </small>
      </div>
    </aside>
  );
}

export default DesktopRightRail
