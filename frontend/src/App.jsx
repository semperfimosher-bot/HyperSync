import { useState } from "react";

const navigationItems = [
  {
    id: "home",
    label: "Home",
    icon: "home",
  },
  {
    id: "search",
    label: "Search",
    icon: "search",
  },
  {
    id: "library",
    label: "Library",
    icon: "library",
  },
  {
    id: "account",
    label: "Account",
    icon: "account",
  },
];

const homeActions = [
  {
    id: "browse",
    title: "Browse music",
    description:
      "Open the catalog area without showing made-up tracks.",
    icon: "music",
  },
  {
    id: "search",
    title: "Search HyperSync",
    description:
      "Enter a real search query while the catalog API is still being built.",
    icon: "search",
  },
  {
    id: "library",
    title: "Your library",
    description:
      "This area will contain saved tracks and playlists after account features exist.",
    icon: "library",
  },
  {
    id: "account",
    title: "Account access",
    description:
      "Login and registration will connect here after the authentication API is ready.",
    icon: "account",
  },
];

function Icon({ name, size = 24 }) {
  const sharedProps = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  if (name === "home") {
    return (
      <svg {...sharedProps}>
        <path d="M3 10.8 12 3l9 7.8" />
        <path d="M5.5 9.5V21h13V9.5" />
        <path d="M9.5 21v-6h5v6" />
      </svg>
    );
  }

  if (name === "search") {
    return (
      <svg {...sharedProps}>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </svg>
    );
  }

  if (name === "library") {
    return (
      <svg {...sharedProps}>
        <path d="M4 4v16" />
        <path d="M9 4v16" />
        <path d="m14 5 5-1 2 15-5 1z" />
      </svg>
    );
  }

  if (name === "account") {
    return (
      <svg {...sharedProps}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 21c.8-4.2 3.3-6.3 7.5-6.3s6.7 2.1 7.5 6.3" />
      </svg>
    );
  }

  if (name === "music") {
    return (
      <svg {...sharedProps}>
        <path d="M9 18V5l10-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="16" cy="16" r="3" />
      </svg>
    );
  }

  if (name === "menu") {
    return (
      <svg {...sharedProps}>
        <path d="M5 7h14" />
        <path d="M5 12h14" />
        <path d="M5 17h14" />
      </svg>
    );
  }

  if (name === "close") {
    return (
      <svg {...sharedProps}>
        <path d="m6 6 12 12" />
        <path d="m18 6-12 12" />
      </svg>
    );
  }

  if (name === "play") {
    return (
      <svg {...sharedProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="m10 8 6 4-6 4z" />
      </svg>
    );
  }

  if (name === "lock") {
    return (
      <svg {...sharedProps}>
        <rect
          x="5"
          y="10"
          width="14"
          height="11"
          rx="2"
        />

        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        <path d="M12 14v3" />
      </svg>
    );
  }

  if (name === "arrow") {
    return (
      <svg {...sharedProps}>
        <path d="M5 12h14" />
        <path d="m14 7 5 5-5 5" />
      </svg>
    );
  }

  return null;
}

function HyperSyncLogo() {
  return (
    <div
      className="brand"
      aria-label="HyperSync"
    >
      <svg
        className="brand__mark"
        viewBox="0 0 78 88"
        role="img"
        aria-label="HyperSync lightning H logo"
      >
        <defs>
          <linearGradient
            id="metal-left"
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop
              offset="0"
              stopColor="#394149"
            />

            <stop
              offset="0.35"
              stopColor="#eef4f7"
            />

            <stop
              offset="0.62"
              stopColor="#929da5"
            />

            <stop
              offset="1"
              stopColor="#2e353b"
            />
          </linearGradient>

          <linearGradient
            id="metal-right"
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop
              offset="0"
              stopColor="#252c32"
            />

            <stop
              offset="0.38"
              stopColor="#cfd7dc"
            />

            <stop
              offset="0.7"
              stopColor="#77828a"
            />

            <stop
              offset="1"
              stopColor="#e6edf0"
            />
          </linearGradient>

          <linearGradient
            id="electric-blue"
            x1="0"
            y1="0"
            x2="1"
            y2="1"
          >
            <stop
              offset="0"
              stopColor="#baf7ff"
            />

            <stop
              offset="0.28"
              stopColor="#1bdcff"
            />

            <stop
              offset="0.62"
              stopColor="#0089e8"
            />

            <stop
              offset="1"
              stopColor="#004a9d"
            />
          </linearGradient>

          <filter
            id="blue-glow-filter"
            x="-70%"
            y="-70%"
            width="240%"
            height="240%"
          >
            <feGaussianBlur
              stdDeviation="3.2"
              result="blur"
            />

            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d="M5 8h18v26h20l-13 17h-7v29H5z"
          fill="url(#metal-left)"
          stroke="#f5f8fa"
          strokeOpacity="0.46"
        />

        <path
          d="M73 8H55v25H35l13 17h7v30h18z"
          fill="url(#metal-right)"
          stroke="#f5f8fa"
          strokeOpacity="0.42"
        />

        <path
          d="M52 1 18 47h17L21 87l42-51H46z"
          fill="url(#electric-blue)"
          filter="url(#blue-glow-filter)"
        />

        <path
          d="M51 4 23 43h17L27 78l31-39H41z"
          fill="none"
          stroke="#d6fbff"
          strokeOpacity="0.62"
          strokeWidth="1.2"
        />
      </svg>

      <span className="brand__wordmark">
        HYPER<span>SYNC</span>
      </span>
    </div>
  );
}

function QuickNavigation({
  activeView,
  onNavigate,
}) {
  return (
    <nav
      className="quick-nav"
      aria-label="Quick navigation"
    >
      {navigationItems.map((item) => (
        <button
          className={
            activeView === item.id
              ? "quick-nav__item is-active"
              : "quick-nav__item"
          }
          type="button"
          key={item.id}
          onClick={() => onNavigate(item.id)}
          aria-current={
            activeView === item.id
              ? "page"
              : undefined
          }
        >
          <span className="quick-nav__icon">
            <Icon
              name={item.icon}
              size={27}
            />
          </span>

          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function HomeView({ onNavigate }) {
  return (
    <section
      className="view-section"
      aria-labelledby="home-heading"
    >
      <div className="section-heading">
        <span>Get started</span>

        <h2 id="home-heading">
          Explore HyperSync
        </h2>
      </div>

      <div className="action-list">
        {homeActions.map((action) => (
          <button
            className="action-card"
            type="button"
            key={action.id}
            onClick={() => onNavigate(action.id)}
          >
            <span className="action-card__icon">
              <Icon
                name={action.icon}
                size={26}
              />
            </span>

            <span className="action-card__copy">
              <strong>{action.title}</strong>
              <small>{action.description}</small>
            </span>

            <span className="action-card__arrow">
              <Icon
                name="arrow"
                size={18}
              />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function BrowseView() {
  return (
    <section
      className="view-section"
      aria-labelledby="browse-heading"
    >
      <div className="section-heading">
        <span>Catalog</span>

        <h2 id="browse-heading">
          Browse music
        </h2>
      </div>

      <EmptyState
        icon="music"
        title="The catalog is not connected yet"
        description="No tracks, albums, or artists are being invented. Real catalog content will appear here after its database models and API endpoints are built."
      />
    </section>
  );
}

function SearchView() {
  const [query, setQuery] = useState("");

  return (
    <section
      className="view-section"
      aria-labelledby="search-heading"
    >
      <div className="section-heading">
        <span>Find music</span>

        <h2 id="search-heading">
          Search
        </h2>
      </div>

      <label className="search-field">
        <Icon
          name="search"
          size={20}
        />

        <input
          type="search"
          value={query}
          placeholder="Search tracks, albums, and artists"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </label>

      <EmptyState
        icon="search"
        title="Search is waiting for the catalog API"
        description={
          query
            ? `Your query “${query}” is entered, but HyperSync will not show made-up results.`
            : "Enter a query to test the interface. Results will come from the real catalog API later."
        }
      />
    </section>
  );
}

function LibraryView() {
  return (
    <section
      className="view-section"
      aria-labelledby="library-heading"
    >
      <div className="section-heading">
        <span>Your collection</span>

        <h2 id="library-heading">
          Library
        </h2>
      </div>

      <EmptyState
        icon="library"
        title="Your library is empty"
        description="Saved tracks and playlists will appear here after authentication and library endpoints are connected."
      />
    </section>
  );
}

function AccountView() {
  return (
    <section
      className="view-section"
      aria-labelledby="account-heading"
    >
      <div className="section-heading">
        <span>Identity</span>

        <h2 id="account-heading">
          Account
        </h2>
      </div>

      <EmptyState
        icon="lock"
        title="Authentication is not connected yet"
        description="Login and registration controls will be added only when the real auth API can receive them securely."
      />
    </section>
  );
}

function EmptyState({
  icon,
  title,
  description,
}) {
  return (
    <article className="empty-state">
      <span className="empty-state__icon">
        <Icon
          name={icon}
          size={31}
        />
      </span>

      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}

function MainView({
  activeView,
  onNavigate,
}) {
  if (activeView === "browse") {
    return <BrowseView />;
  }

  if (activeView === "search") {
    return <SearchView />;
  }

  if (activeView === "library") {
    return <LibraryView />;
  }

  if (activeView === "account") {
    return <AccountView />;
  }

  return (
    <HomeView onNavigate={onNavigate} />
  );
}

function PlayerPlaceholder() {
  return (
    <section
      className="player-placeholder"
      aria-label="Player status"
    >
      <span className="player-placeholder__art">
        <Icon
          name="music"
          size={23}
        />
      </span>

      <span className="player-placeholder__copy">
        <small>Player inactive</small>
        <strong>No track selected</strong>
      </span>

      <button
        type="button"
        disabled
        aria-label="Playback is not connected"
      >
        <Icon
          name="play"
          size={22}
        />
      </button>
    </section>
  );
}

function BottomNavigation({
  activeView,
  onNavigate,
}) {
  return (
    <nav
      className="bottom-nav"
      aria-label="Main navigation"
    >
      {navigationItems.map((item) => (
        <button
          className={
            activeView === item.id
              ? "bottom-nav__item is-active"
              : "bottom-nav__item"
          }
          type="button"
          key={item.id}
          onClick={() => onNavigate(item.id)}
          aria-current={
            activeView === item.id
              ? "page"
              : undefined
          }
        >
          <Icon
            name={item.icon}
            size={21}
          />

          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default function App() {
  const [activeView, setActiveView] =
    useState("home");

  const [menuOpen, setMenuOpen] =
    useState(false);

  function navigate(view) {
    setActiveView(view);
    setMenuOpen(false);
  }

  return (
    <div className="page-frame">
      <div className="mobile-app">
        <div
          className="hex-field"
          aria-hidden="true"
        />

        <span
          className="glow-hex glow-hex--one"
          aria-hidden="true"
        />

        <span
          className="glow-hex glow-hex--two"
          aria-hidden="true"
        />

        <header className="app-header">
          <div className="app-header__top">
            <HyperSyncLogo />

            <button
              className="menu-button"
              type="button"
              aria-label={
                menuOpen
                  ? "Close menu"
                  : "Open menu"
              }
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen(
                  (currentValue) => !currentValue,
                );
              }}
            >
              <Icon
                name={
                  menuOpen
                    ? "close"
                    : "menu"
                }
                size={22}
              />
            </button>
          </div>

          {menuOpen ? (
            <aside className="app-menu">
              <strong>HyperSync</strong>
              <span>Interface milestone</span>

              <small>
                No account or playback data is being
                simulated.
              </small>
            </aside>
          ) : null}

          <div className="intro">
            <span>
              Your sound, synchronized
            </span>

            <h1>Welcome to HyperSync</h1>

            <p>
              A mobile-first music interface ready
              for real catalog, account, and
              playback connections.
            </p>
          </div>

          <QuickNavigation
            activeView={activeView}
            onNavigate={navigate}
          />
        </header>

        <main className="app-content">
          <MainView
            activeView={activeView}
            onNavigate={navigate}
          />
        </main>

        <PlayerPlaceholder />

        <BottomNavigation
          activeView={activeView}
          onNavigate={navigate}
        />
      </div>
    </div>
  );
}
