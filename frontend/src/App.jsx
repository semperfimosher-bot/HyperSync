<<<<<<< HEAD
import { useMemo, useState } from 'react'
import './styles.css'

const iconPaths = {
  home: '<path d="M3 10.8 12 3l9 7.8v9.7a1.5 1.5 0 0 1-1.5 1.5H15v-7H9v7H4.5A1.5 1.5 0 0 1 3 20.5Z"/><path d="M8 22v-7h8v7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  library: '<path d="M4 4v16M9 4v16M14 4v16M19 8v12"/><path d="M19 4v.01"/>',
  message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  camera: '<path d="M14.5 5 13 3h-2L9.5 5H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12.5" r="4"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  next: '<path d="m6 5 10 7-10 7Z"/><path d="M18 5v14"/>',
  previous: '<path d="m18 5-10 7 10 7Z"/><path d="M6 5v14"/>',
  shuffle: '<path d="M16 3h5v5M4 20l17-17M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  queue: '<path d="M4 6h10M4 12h10M4 18h7"/><path d="m16 15 5 3-5 3Z"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sparkles: '<path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4Z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8Z"/><path d="m5 15 .7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7Z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-5-5L5 20"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
}

function Icon({ name, size = 20, className = '' }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: iconPaths[name] }}
    />
  )
}

const tracks = [
  { id: 1, title: 'Midnight Signal', artist: 'Nova Lane', duration: '3:42', color: 'violet' },
  { id: 2, title: 'Glass Horizon', artist: 'Low Orbit', duration: '4:08', color: 'blue' },
  { id: 3, title: 'Stay in Motion', artist: 'Kairo', duration: '2:57', color: 'orange' },
  { id: 4, title: 'Afterimage', artist: 'Violet Static', duration: '3:31', color: 'pink' },
  { id: 5, title: 'Slow Current', artist: 'Northline', duration: '4:20', color: 'green' },
]

const playlists = [
  { id: 'night-drive', title: 'Night Drive', subtitle: 'A smooth after-dark mix', color: 'violet', count: 42 },
  { id: 'focus-mode', title: 'Focus Mode', subtitle: 'Low-key tracks for deep work', color: 'blue', count: 31 },
  { id: 'new-energy', title: 'New Energy', subtitle: 'Fresh uploads and discoveries', color: 'orange', count: 28 },
  { id: 'soft-static', title: 'Soft Static', subtitle: 'Dreamy alternative favorites', color: 'pink', count: 36 },
]

const navItems = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'messages', label: 'Messages', icon: 'message' },
  { id: 'profile', label: 'Profile', icon: 'user' },
]

function Artwork({ color = 'violet', size = 'medium', label = '' }) {
  return (
    <div className={`artwork artwork--${size} artwork--${color}`} aria-label={label}>
      <span className="artwork__glow" />
      <span className="artwork__mark">H</span>
    </div>
  )
}

function SearchBox({ compact = false, value, onChange, onFocus }) {
  return (
    <label className={`search-box ${compact ? 'search-box--compact' : ''}`}>
      <Icon name="search" size={compact ? 16 : 18} />
      <input
        aria-label="Search HyperSync"
        onChange={(event) => onChange?.(event.target.value)}
        onFocus={onFocus}
        placeholder="What do you want to listen to?"
        value={value}
      />
    </label>
  )
}

function ProfileButton({ onClick }) {
  return (
    <button className="profile-button" onClick={onClick} aria-label="Open profile menu">
      <span>SC</span>
    </button>
  )
}

function LoginOverlay({ mode, onClose, onModeChange }) {
  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="auth-overlay__close" onClick={onClose} aria-label="Continue as guest">
        <Icon name="close" />
      </button>
      <div className="auth-card">
        <div className="brand-mark brand-mark--large">H</div>
        <p className="eyebrow">Your music, synchronized</p>
        <h1 id="auth-title">Welcome to HyperSync</h1>
        <p className="auth-card__copy">
          Stream as a guest, or sign in to save playlists, view listening stats, and connect with other listeners.
        </p>

        {mode === 'welcome' ? (
          <div className="auth-card__actions">
            <button className="button button--primary" onClick={() => onModeChange('login')}>Log in</button>
            <button className="button button--secondary" onClick={() => onModeChange('create')}>Create account</button>
            <button className="button button--text" onClick={onClose}>Continue without an account</button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
            <div className="auth-form__heading">
              <button type="button" className="icon-button" onClick={() => onModeChange('welcome')} aria-label="Back">
                <Icon name="back" />
              </button>
              <h2>{mode === 'login' ? 'Log in' : 'Create account'}</h2>
            </div>
            {mode === 'create' && <input placeholder="Display name" autoComplete="name" />}
            <input placeholder="Email" type="email" autoComplete="email" />
            <input placeholder="Password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            <button className="button button--primary" type="submit">
              {mode === 'login' ? 'Log in' : 'Create account'}
            </button>
            <p className="form-note">Account authentication will connect to the FastAPI backend in the next milestone.</p>
          </form>
        )}
      </div>
    </div>
  )
}

function ProfileMenu({ onClose, onOpenAuth }) {
  return (
    <div className="profile-menu">
      <div className="profile-menu__header">
        <ProfileButton />
        <div>
          <strong>Guest listener</strong>
          <span>Sign in to sync your account</span>
        </div>
      </div>
      <button><Icon name="stats" /> Listening statistics</button>
      <button><Icon name="image" /> Add or edit profile image</button>
      <button><Icon name="settings" /> Account settings</button>
      <button onClick={onOpenAuth}><Icon name="logout" /> Log in or create account</button>
      <button className="profile-menu__close" onClick={onClose}>Close menu</button>
    </div>
  )
}

function LeftSidebar({ activeView, onNavigate, onOpenPlaylist }) {
  return (
    <aside className="desktop-panel desktop-panel--left">
      <div className="desktop-brand">
        <div className="brand-mark">H</div>
        <div>
          <strong>HyperSync</strong>
          <span>Music without friction</span>
        </div>
      </div>

      <nav className="desktop-nav" aria-label="Main navigation">
        {navItems.slice(0, 3).map((item) => (
          <button
            className={activeView === item.id ? 'is-active' : ''}
            key={item.id}
            onClick={() => onNavigate(item.id)}
          >
            <Icon name={item.icon} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-heading">
        <span>Your library</span>
        <button className="icon-button" aria-label="Create playlist"><Icon name="plus" /></button>
      </div>

      <SearchBox compact />

      <div className="library-list">
        {playlists.slice(0, 4).map((playlist) => (
          <button key={playlist.id} onClick={() => onOpenPlaylist(playlist)}>
            <Artwork color={playlist.color} size="tiny" />
            <span>
              <strong>{playlist.title}</strong>
              <small>Playlist · {playlist.count} songs</small>
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}

function RightSidebar({ currentTrack, queue, isPlaying, onTogglePlay, onSelectTrack }) {
  const [tab, setTab] = useState('now-playing')

  return (
    <aside className="desktop-panel desktop-panel--right">
      <div className="panel-tabs">
        <button className={tab === 'now-playing' ? 'is-active' : ''} onClick={() => setTab('now-playing')}>Now playing</button>
        <button className={tab === 'queue' ? 'is-active' : ''} onClick={() => setTab('queue')}>Queue</button>
      </div>

      {tab === 'now-playing' ? (
        <div className="now-playing-card">
          <Artwork color={currentTrack.color} size="hero" label={`${currentTrack.title} artwork`} />
          <div className="now-playing-card__copy">
            <span className="eyebrow">Playing from Night Drive</span>
            <h2>{currentTrack.title}</h2>
            <p>{currentTrack.artist}</p>
          </div>
          <div className="now-playing-card__actions">
            <button className="icon-button" aria-label="Like track"><Icon name="heart" /></button>
            <button className="round-play" onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
              <Icon name={isPlaying ? 'pause' : 'play'} size={25} />
            </button>
            <button className="icon-button" aria-label="More options"><Icon name="more" /></button>
          </div>
          <div className="track-context">
            <span>Up next</span>
            <strong>{queue[1]?.title ?? queue[0]?.title}</strong>
          </div>
        </div>
      ) : (
        <div className="queue-list">
          <div className="queue-list__heading">
            <div>
              <span className="eyebrow">Current session</span>
              <h2>Queue</h2>
            </div>
            <button className="text-button">Clear</button>
          </div>
          {queue.map((track, index) => (
            <button key={track.id} className={currentTrack.id === track.id ? 'is-active' : ''} onClick={() => onSelectTrack(track)}>
              <span className="queue-number">{index + 1}</span>
              <Artwork color={track.color} size="tiny" />
              <span className="queue-copy">
                <strong>{track.title}</strong>
                <small>{track.artist}</small>
              </span>
              <small>{track.duration}</small>
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}

function HomeView({ onOpenPlaylist, onPlayTrack, onProfileClick, onSearchFocus }) {
  return (
    <div className="view home-view">
      <div className="mobile-header">
        <ProfileButton onClick={onProfileClick} />
        <div className="mobile-header__brand">HyperSync</div>
        <button className="icon-button"><Icon name="camera" /></button>
      </div>

      <div className="view-heading desktop-only-heading">
        <div>
          <span className="eyebrow">Good evening</span>
          <h1>Find your next favorite</h1>
        </div>
        <button className="button button--secondary button--small"><Icon name="sparkles" /> Generate a mix</button>
      </div>

      <SearchBox onFocus={onSearchFocus} />

      <section>
        <div className="section-heading">
          <div>
            <span className="section-kicker">Start browsing</span>
            <h2>Explore HyperSync</h2>
          </div>
        </div>
        <div className="category-grid">
          {[
            ['Music', 'violet'],
            ['Playlists', 'blue'],
            ['Recent uploads', 'orange'],
            ['Generated mixes', 'pink'],
          ].map(([title, color]) => (
            <button className={`category-card category-card--${color}`} key={title}>
              <span>{title}</span>
              <span className="category-card__shape" />
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <span className="section-kicker">Picked for you</span>
            <h2>Made for your session</h2>
          </div>
          <button className="text-button">View all</button>
        </div>
        <button className="featured-playlist" onClick={() => onOpenPlaylist(playlists[0])}>
          <Artwork color="violet" size="large" />
          <span className="featured-playlist__copy">
            <span className="eyebrow">Generated playlist</span>
            <strong>Midnight Motion</strong>
            <small>Dreamy electronic, alternative R&B, and late-night energy.</small>
            <span className="featured-playlist__meta">42 tracks · 2 hr 39 min</span>
          </span>
          <span className="round-play"><Icon name="play" size={22} /></span>
        </button>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <span className="section-kicker">Recently uploaded</span>
            <h2>Fresh on HyperSync</h2>
          </div>
          <button className="text-button">See more</button>
        </div>
        <div className="card-row">
          {playlists.map((playlist) => (
            <button className="media-card" key={playlist.id} onClick={() => onOpenPlaylist(playlist)}>
              <Artwork color={playlist.color} size="medium" />
              <strong>{playlist.title}</strong>
              <span>{playlist.subtitle}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <span className="section-kicker">Quick play</span>
            <h2>Recently heard</h2>
          </div>
        </div>
        <div className="compact-track-grid">
          {tracks.slice(0, 4).map((track) => (
            <button key={track.id} onClick={() => onPlayTrack(track)}>
              <Artwork color={track.color} size="tiny" />
              <span><strong>{track.title}</strong><small>{track.artist}</small></span>
              <Icon name="play" size={17} />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function SearchView({ onOpenPlaylist, onPlayTrack }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')

  const filteredTracks = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return tracks
    return tracks.filter((track) => `${track.title} ${track.artist}`.toLowerCase().includes(normalized))
  }, [query])

  const filteredPlaylists = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return playlists
    return playlists.filter((playlist) => `${playlist.title} ${playlist.subtitle}`.toLowerCase().includes(normalized))
  }, [query])

  return (
    <div className="view search-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">Search</span>
          <h1>What do you want to hear?</h1>
        </div>
      </div>
      <SearchBox value={query} onChange={setQuery} />
      <div className="filter-row" role="tablist" aria-label="Search filters">
        {['all', 'songs', 'playlists'].map((item) => (
          <button className={filter === item ? 'is-active' : ''} key={item} onClick={() => setFilter(item)}>
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {(filter === 'all' || filter === 'playlists') && (
        <section>
          <div className="section-heading"><h2>Playlists</h2></div>
          <div className="card-row">
            {filteredPlaylists.map((playlist) => (
              <button className="media-card" key={playlist.id} onClick={() => onOpenPlaylist(playlist)}>
                <Artwork color={playlist.color} size="medium" />
                <strong>{playlist.title}</strong>
                <span>{playlist.subtitle}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {(filter === 'all' || filter === 'songs') && (
        <section>
          <div className="section-heading"><h2>Songs</h2></div>
          <div className="track-list track-list--search">
            {filteredTracks.map((track) => (
              <button className="track-row" key={track.id} onDoubleClick={() => onPlayTrack(track)}>
                <Artwork color={track.color} size="small" />
                <span className="track-row__copy">
                  <strong>{track.title}</strong>
                  <small>{track.artist}</small>
                </span>
                <small>{track.duration}</small>
                <span className="track-row__action" onClick={() => onPlayTrack(track)}><Icon name="play" /></span>
                <Icon name="more" />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function PlaylistView({ playlist, onBack, onPlayTrack, onPlayAll }) {
  const [playlistSearch, setPlaylistSearch] = useState('')
  const visibleTracks = tracks.filter((track) => `${track.title} ${track.artist}`.toLowerCase().includes(playlistSearch.toLowerCase()))

  return (
    <div className="view playlist-view">
      <div className="playlist-toolbar">
        <button className="icon-button" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
        <SearchBox compact value={playlistSearch} onChange={setPlaylistSearch} />
        <button className="icon-button"><Icon name="more" /></button>
      </div>

      <div className="playlist-hero">
        <Artwork color={playlist.color} size="playlist" />
        <div className="playlist-hero__copy">
          <span className="eyebrow">Playlist</span>
          <h1>{playlist.title}</h1>
          <p>{playlist.subtitle}. Curated for smooth transitions and uninterrupted listening.</p>
          <strong>HyperSync</strong>
          <span>{playlist.count} songs · 2 hr 39 min</span>
        </div>
      </div>

      <div className="playlist-actions">
        <div>
          <button className="icon-button" aria-label="Save playlist"><Icon name="heart" /></button>
          <button className="icon-button" aria-label="Add playlist"><Icon name="plus" /></button>
          <button className="icon-button" aria-label="More options"><Icon name="more" /></button>
        </div>
        <div>
          <button className="icon-button" aria-label="Shuffle"><Icon name="shuffle" /></button>
          <button className="round-play round-play--large" onClick={onPlayAll} aria-label="Play playlist"><Icon name="play" size={27} /></button>
        </div>
      </div>

      <div className="playlist-track-heading">
        <span>#</span>
        <span>Title</span>
        <span className="desktop-track-column">Album</span>
        <Icon name="clock" size={17} />
      </div>

      <div className="track-list">
        {visibleTracks.map((track, index) => (
          <button className="track-row" key={track.id} onDoubleClick={() => onPlayTrack(track)}>
            <span className="track-number">{index + 1}</span>
            <Artwork color={track.color} size="small" />
            <span className="track-row__copy">
              <strong>{track.title}</strong>
              <small>{track.artist}</small>
            </span>
            <span className="desktop-track-column">{playlist.title}</span>
            <small>{track.duration}</small>
            <Icon name="more" />
          </button>
        ))}
      </div>
    </div>
  )
}

function LibraryView({ onOpenPlaylist }) {
  return (
    <div className="view library-view">
      <div className="view-heading">
        <div><span className="eyebrow">Saved music</span><h1>Your library</h1></div>
        <button className="button button--primary button--small"><Icon name="plus" /> Create playlist</button>
      </div>
      <SearchBox />
      <div className="library-page-list">
        {playlists.map((playlist) => (
          <button key={playlist.id} onClick={() => onOpenPlaylist(playlist)}>
            <Artwork color={playlist.color} size="medium" />
            <span><strong>{playlist.title}</strong><small>Playlist · {playlist.count} songs</small></span>
            <Icon name="chevron" />
          </button>
        ))}
      </div>
    </div>
  )
}

function EmptyView({ activeView }) {
  const content = {
    messages: ['Messages', 'Direct messages and playlist sharing will be added after accounts and streaming are stable.'],
    profile: ['Your profile', 'Account settings, profile images, and listening statistics will connect to the backend later.'],
  }
  const [title, copy] = content[activeView] ?? ['HyperSync', 'This section is coming soon.']
  return (
    <div className="view empty-view">
      <div className="empty-view__icon"><Icon name={activeView === 'messages' ? 'message' : 'user'} size={34} /></div>
      <span className="eyebrow">Coming in a later milestone</span>
      <h1>{title}</h1>
      <p>{copy}</p>
    </div>
  )
}

function MiniPlayer({ currentTrack, isPlaying, progress, onTogglePlay, onNext, onPrevious }) {
  return (
    <div className="mini-player">
      <div className="mini-player__progress"><span style={{ width: `${progress}%` }} /></div>
      <Artwork color={currentTrack.color} size="tiny" />
      <div className="mini-player__copy">
        <strong>{currentTrack.title}</strong>
        <span>{currentTrack.artist}</span>
      </div>
      <button className="icon-button mobile-player-secondary" aria-label="Previous" onClick={onPrevious}><Icon name="previous" /></button>
      <button className="mini-player__play" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={onTogglePlay}><Icon name={isPlaying ? 'pause' : 'play'} size={21} /></button>
      <button className="icon-button" aria-label="Next" onClick={onNext}><Icon name="next" /></button>
    </div>
  )
}

function DesktopPlayer({ currentTrack, isPlaying, progress, onTogglePlay, onNext, onPrevious }) {
  return (
    <footer className="desktop-player">
      <div className="desktop-player__track">
        <Artwork color={currentTrack.color} size="small" />
        <span><strong>{currentTrack.title}</strong><small>{currentTrack.artist}</small></span>
        <button className="icon-button"><Icon name="heart" size={18} /></button>
      </div>
      <div className="desktop-player__center">
        <div className="player-controls">
          <button className="icon-button"><Icon name="shuffle" size={17} /></button>
          <button className="icon-button" onClick={onPrevious}><Icon name="previous" /></button>
          <button className="desktop-player__play" onClick={onTogglePlay}><Icon name={isPlaying ? 'pause' : 'play'} size={22} /></button>
          <button className="icon-button" onClick={onNext}><Icon name="next" /></button>
          <button className="icon-button"><Icon name="repeat" size={17} /></button>
        </div>
        <div className="player-progress-row">
          <span>1:24</span>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          <span>{currentTrack.duration}</span>
        </div>
      </div>
      <div className="desktop-player__right">
        <button className="icon-button"><Icon name="queue" /></button>
        <Icon name="volume" size={19} />
        <div className="volume-track"><span /></div>
      </div>
    </footer>
  )
}

function MobileNavigation({ activeView, onNavigate }) {
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {navItems.map((item) => (
        <button className={activeView === item.id ? 'is-active' : ''} key={item.id} onClick={() => onNavigate(item.id)}>
          <Icon name={item.icon} size={20} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

export default function App() {
  const [activeView, setActiveView] = useState('home')
  const [previousView, setPreviousView] = useState('home')
  const [selectedPlaylist, setSelectedPlaylist] = useState(null)
  const [authOpen, setAuthOpen] = useState(true)
  const [authMode, setAuthMode] = useState('welcome')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [currentTrack, setCurrentTrack] = useState(tracks[0])
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress] = useState(37)
  const queue = tracks

  const navigate = (view) => {
    setSelectedPlaylist(null)
    setActiveView(view)
    setProfileMenuOpen(false)
  }

  const openPlaylist = (playlist) => {
    setPreviousView(activeView)
    setSelectedPlaylist(playlist)
  }

  const playTrack = (track) => {
    setCurrentTrack(track)
    setIsPlaying(true)
  }

  const moveTrack = (direction) => {
    const index = tracks.findIndex((track) => track.id === currentTrack.id)
    const nextIndex = (index + direction + tracks.length) % tracks.length
    playTrack(tracks[nextIndex])
  }

  const renderView = () => {
    if (selectedPlaylist) {
      return (
        <PlaylistView
          playlist={selectedPlaylist}
          onBack={() => {
            setSelectedPlaylist(null)
            setActiveView(previousView)
          }}
          onPlayTrack={playTrack}
          onPlayAll={() => playTrack(tracks[0])}
        />
      )
    }

    if (activeView === 'home') {
      return (
        <HomeView
          onOpenPlaylist={openPlaylist}
          onPlayTrack={playTrack}
          onProfileClick={() => setProfileMenuOpen((open) => !open)}
          onSearchFocus={() => navigate('search')}
        />
      )
    }
    if (activeView === 'search') {
      return <SearchView onOpenPlaylist={openPlaylist} onPlayTrack={playTrack} />
    }
    if (activeView === 'library') {
      return <LibraryView onOpenPlaylist={openPlaylist} />
    }
    return <EmptyView activeView={activeView} />
  }

  return (
    <div className="app-shell">
      <div className="desktop-layout">
        <LeftSidebar activeView={activeView} onNavigate={navigate} onOpenPlaylist={openPlaylist} />
        <main className="desktop-panel desktop-panel--center">
          <div className="desktop-topbar">
            <div className="desktop-topbar__history">
              <button className="icon-button"><Icon name="back" /></button>
              <button className="icon-button"><Icon name="chevron" /></button>
            </div>
            <div className="desktop-topbar__actions">
              <button className="button button--secondary button--small" onClick={() => { setAuthMode('login'); setAuthOpen(true) }}>Log in</button>
              <ProfileButton onClick={() => setProfileMenuOpen((open) => !open)} />
            </div>
          </div>
          <div className="center-scroll">{renderView()}</div>
        </main>
        <RightSidebar
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          onSelectTrack={playTrack}
          onTogglePlay={() => setIsPlaying((playing) => !playing)}
          queue={queue}
        />
      </div>

      <div className="mobile-layout">
        <main className="mobile-scroll">{renderView()}</main>
        <MiniPlayer
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          onNext={() => moveTrack(1)}
          onPrevious={() => moveTrack(-1)}
          onTogglePlay={() => setIsPlaying((playing) => !playing)}
          progress={progress}
        />
        <MobileNavigation activeView={activeView} onNavigate={navigate} />
      </div>

      <DesktopPlayer
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        onNext={() => moveTrack(1)}
        onPrevious={() => moveTrack(-1)}
        onTogglePlay={() => setIsPlaying((playing) => !playing)}
        progress={progress}
      />

      {profileMenuOpen && (
        <ProfileMenu
          onClose={() => setProfileMenuOpen(false)}
          onOpenAuth={() => {
            setProfileMenuOpen(false)
            setAuthMode('welcome')
            setAuthOpen(true)
          }}
        />
      )}

      {authOpen && (
        <LoginOverlay
          mode={authMode}
          onClose={() => {
            setAuthOpen(false)
            setAuthMode('welcome')
          }}
          onModeChange={setAuthMode}
        />
      )}
    </div>
  )
}
=======
export default function App() {
  return <h1>HyperSync</h1>
}
>>>>>>> b1bf2e5949f91c5b6272bd09fb21e6ec779548e0
