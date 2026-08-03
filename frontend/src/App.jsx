import { useMemo, useState } from "react";

const NAV_ITEMS = [
  { id: "home", label: "Home", icon: "home" },
  { id: "search", label: "Search", icon: "search" },
  { id: "library", label: "Library", icon: "library" },
  { id: "profile", label: "Profile", icon: "profile" },
];

const LIBRARY_TABS = [
  "Playlists",
  "Artists",
  "Albums",
  "Songs",
];

const SEARCH_CATEGORIES = [
  {
    id: "trending",
    label: "Trending",
    icon: "chart",
  },
  {
    id: "new",
    label: "New Releases",
    icon: "disc",
  },
  {
    id: "playlists",
    label: "Playlists",
    icon: "playlist",
  },
  {
    id: "genres",
    label: "Genres",
    icon: "mountains",
  },
];

const SEARCH_SUGGESTIONS = [
  "Synthwave",
  "Retrowave",
  "Chillwave",
  "Cyberpunk",
  "Ambient",
  "Electronic",
];

const PAGE_TITLES = {
  home: "Home",
  search: "Search",
  library: "My Library",
  profile: "Profile",
};

function Icon({ name, size = 22 }) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  const paths = {
    home: (
      <>
        <path d="M3.5 10.5 12 3l8.5 7.5" />
        <path d="M5.5 9.5V21h13V9.5" />
        <path d="M9.5 21v-6h5v6" />
      </>
    ),

    search: (
      <>
        <circle
          cx="10.5"
          cy="10.5"
          r="6.4"
        />

        <path d="m15.5 15.5 5 5" />
      </>
    ),

    library: (
      <>
        <path d="M4 4v16" />
        <path d="M9 4v16" />
        <path d="m14 5 5-1 2 15-5 1z" />
      </>
    ),

    profile: (
      <>
        <circle
          cx="12"
          cy="8"
          r="3.6"
        />

        <path
          d={
            "M4.5 21c.9-4.2 3.4-6.3 " +
            "7.5-6.3s6.6 2.1 7.5 6.3"
          }
        />
      </>
    ),

    bell: (
      <>
        <path
          d={
            "M6.5 9a5.5 5.5 0 0 1 11 0" +
            "c0 6 2.5 6.5 2.5 6.5H4S6.5 15 6.5 9"
          }
        />

        <path d="M10 19a2.2 2.2 0 0 0 4 0" />
      </>
    ),

    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),

    lock: (
      <>
        <rect
          x="5"
          y="10"
          width="14"
          height="10"
          rx="2"
        />

        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),

    more: (
      <>
        <circle
          cx="12"
          cy="5"
          r="1"
          fill="currentColor"
          stroke="none"
        />

        <circle
          cx="12"
          cy="12"
          r="1"
          fill="currentColor"
          stroke="none"
        />

        <circle
          cx="12"
          cy="19"
          r="1"
          fill="currentColor"
          stroke="none"
        />
      </>
    ),

    play: (
      <path
        d="m9 7 8 5-8 5z"
        fill="currentColor"
        stroke="none"
      />
    ),

    pause: (
      <>
        <path d="M9 7v10" />
        <path d="M15 7v10" />
      </>
    ),

    previous: (
      <>
        <path d="M7 6v12" />
        <path d="m18 7-8 5 8 5z" />
      </>
    ),

    next: (
      <>
        <path d="M17 6v12" />
        <path d="m6 7 8 5-8 5z" />
      </>
    ),

    heart: (
      <path
        d={
          "M20.8 5.8c-2.2-2.3-5.8-1.9-7.6.7" +
          "L12 8l-1.2-1.5c-1.8-2.6-5.4-3-7.6-.7" +
          "-2.2 2.4-2 6.2.4 8.4L12 21l8.4-6.8" +
          "c2.4-2.2 2.6-6 .4-8.4Z"
        }
      />
    ),

    music: (
      <>
        <path d="M9 18V5l10-2v13" />
        <circle
          cx="6"
          cy="18"
          r="3"
        />

        <circle
          cx="16"
          cy="16"
          r="3"
        />
      </>
    ),

    people: (
      <>
        <circle
          cx="9"
          cy="8"
          r="3"
        />

        <circle
          cx="17"
          cy="9"
          r="2.5"
        />

        <path
          d={
            "M3.5 20c.7-4 2.5-6 5.5-6" +
            "s4.8 2 5.5 6"
          }
        />

        <path d="M14.5 15c3.2-.2 5.2 1.5 6 5" />
      </>
    ),

    headphones: (
      <>
        <path d="M4 13v-2a8 8 0 0 1 16 0v2" />
        <path d="M4 13h3v7H5a1 1 0 0 1-1-1z" />
        <path d="M20 13h-3v7h2a1 1 0 0 0 1-1z" />
      </>
    ),

    chart: (
      <>
        <path d="M4 19V9" />
        <path d="M10 19V5" />
        <path d="M16 19v-7" />
        <path d="M22 19V3" />
      </>
    ),

    disc: (
      <>
        <circle
          cx="12"
          cy="12"
          r="8"
        />

        <circle
          cx="12"
          cy="12"
          r="2.3"
        />
      </>
    ),

    playlist: (
      <>
        <path d="M4 6h11" />
        <path d="M4 11h11" />
        <path d="M4 16h7" />
        <path d="M18 5v11" />

        <circle
          cx="15.5"
          cy="17.5"
          r="2.5"
        />
      </>
    ),

    mountains: (
      <>
        <path d="m3 19 6-9 4 5 3-4 5 8z" />
        <path d="m7 13 2-3 2 3" />
      </>
    ),

    eye: (
      <>
        <path
          d={
            "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6" +
            "-3.5 6-9.5 6-9.5-6-9.5-6Z"
          }
        />

        <circle
          cx="12"
          cy="12"
          r="2.5"
        />
      </>
    ),

    eyeOff: (
      <>
        <path d="m3 3 18 18" />

        <path
          d={
            "M10.6 6.1A9.6 9.6 0 0 1 12 6" +
            "c6 0 9.5 6 9.5 6a17 17 0 0 1-2.2 2.8"
          }
        />

        <path
          d={
            "M6.2 6.2C3.8 8 2.5 12 2.5 12" +
            "s3.5 6 9.5 6a9 9 0 0 0 3.1-.5"
          }
        />
      </>
    ),

    mail: (
      <>
        <rect
          x="3"
          y="5"
          width="18"
          height="14"
          rx="2"
        />

        <path d="m4 7 8 6 8-6" />
      </>
    ),

    chevron: (
      <path d="m9 6 6 6-6 6" />
    ),

    sun: (
      <>
        <circle
          cx="12"
          cy="12"
          r="3.5"
        />

        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.9 4.9 1.4 1.4" />
        <path d="m17.7 17.7 1.4 1.4" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m4.9 19.1 1.4-1.4" />
        <path d="m17.7 6.3 1.4-1.4" />
      </>
    ),

    volume: (
      <>
        <path d="M4 10v4h4l5 4V6l-5 4z" />
        <path d="M17 9a4 4 0 0 1 0 6" />
      </>
    ),

    shield: (
      <>
        <path
          d={
            "M12 3 5 6v5c0 4.6 2.8 8 7 10" +
            " 4.2-2 7-5.4 7-10V6z"
          }
        />

        <path d="m9.5 12 1.7 1.7 3.5-4" />
      </>
    ),

    logout: (
      <>
        <path d="M10 5H5v14h5" />
        <path d="M13 8l4 4-4 4" />
        <path d="M17 12H9" />
      </>
    ),

    edit: (
      <>
        <path
          d={
            "m4 20 4.2-1 10.6-10.6" +
            "a2 2 0 0 0-2.8-2.8L5.4 16.2z"
          }
        />

        <path d="m14.5 7.1 2.8 2.8" />
      </>
    ),

    link: (
      <>
        <path
          d={
            "M10 13a5 5 0 0 0 7.1 0l2-2" +
            "a5 5 0 0 0-7.1-7.1l-1.1 1.1"
          }
        />

        <path
          d={
            "M14 11a5 5 0 0 0-7.1 0l-2 2" +
            "A5 5 0 0 0 12 20.1l1.1-1.1"
          }
        />
      </>
    ),

    check: (
      <path d="m5 12 4 4L19 6" />
    ),

    close: (
      <>
        <path d="m6 6 12 12" />
        <path d="m18 6-12 12" />
      </>
    ),
  };

  return (
    <svg {...props}>
      {paths[name] ?? null}
    </svg>
  );
}

function BrandLogo({
  idPrefix = "brand",
  compact = false,
}) {
  return (
    <div
      className={
        `brand ${compact ? "brand--compact" : ""}`
      }
      aria-label="HyperSync"
    >
      <svg
        className="brand__symbol"
        viewBox="0 0 76 88"
        role="img"
        aria-label="HyperSync logo"
      >
        <defs>
          <linearGradient
            id={`${idPrefix}-metal-left`}
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop
              offset="0"
              stopColor="#252d34"
            />

            <stop
              offset="0.34"
              stopColor="#f2f6f8"
            />

            <stop
              offset="0.63"
              stopColor="#7f8991"
            />

            <stop
              offset="1"
              stopColor="#1b2228"
            />
          </linearGradient>

          <linearGradient
            id={`${idPrefix}-metal-right`}
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop
              offset="0"
              stopColor="#11171c"
            />

            <stop
              offset="0.38"
              stopColor="#d9e1e5"
            />

            <stop
              offset="0.68"
              stopColor="#6e7880"
            />

            <stop
              offset="1"
              stopColor="#f4f7f9"
            />
          </linearGradient>

          <linearGradient
            id={`${idPrefix}-bolt`}
            x1="0"
            y1="0"
            x2="1"
            y2="1"
          >
            <stop
              offset="0"
              stopColor="#c8fbff"
            />

            <stop
              offset="0.25"
              stopColor="#22ddff"
            />

            <stop
              offset="0.58"
              stopColor="#008cef"
            />

            <stop
              offset="1"
              stopColor="#003a8d"
            />
          </linearGradient>

          <filter
            id={`${idPrefix}-glow`}
            x="-80%"
            y="-80%"
            width="260%"
            height="260%"
          >
            <feGaussianBlur
              stdDeviation="3"
              result="blur"
            />

            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d="M5 8h18v26h20L30 51h-7v29H5z"
          fill={`url(#${idPrefix}-metal-left)`}
          stroke="#f5f8fa"
          strokeOpacity=".42"
        />

        <path
          d="M71 8H53v25H33l13 17h7v30h18z"
          fill={`url(#${idPrefix}-metal-right)`}
          stroke="#f5f8fa"
          strokeOpacity=".38"
        />

        <path
          d="M51 1 17 47h17L20 87l42-52H45z"
          fill={`url(#${idPrefix}-bolt)`}
          filter={`url(#${idPrefix}-glow)`}
        />

        <path
          d="M49 5 22 43h17L26 78l31-39H40z"
          fill="none"
          stroke="#d9fbff"
          strokeOpacity=".58"
        />
      </svg>

      <span className="brand__wordmark">
        HYPER<span>SYNC</span>
      </span>
    </div>
  );
}

function HexBackdrop({
  idPrefix = "hypersync-background",
}) {
  const tileGradientId =
    `${idPrefix}-tile-gradient`;

  const gridPatternId =
    `${idPrefix}-grid-pattern`;

  const textureFilterId =
    `${idPrefix}-texture-filter`;

  const glowFilterId =
    `${idPrefix}-edge-glow`;

  const strongGlowFilterId =
    `${idPrefix}-strong-edge-glow`;

  const vignetteId =
    `${idPrefix}-vignette`;

  const blueAreaGlowId =
    `${idPrefix}-blue-area-glow`;

  const cyanAreaGlowId =
    `${idPrefix}-cyan-area-glow`;

  return (
    <svg
      className="hex-backdrop"
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={tileGradientId}
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop
            offset="0"
            stopColor="#17222c"
          />

          <stop
            offset="0.42"
            stopColor="#111b24"
          />

          <stop
            offset="0.72"
            stopColor="#0c151d"
          />

          <stop
            offset="1"
            stopColor="#081017"
          />
        </linearGradient>

        <radialGradient
          id={blueAreaGlowId}
          cx="50%"
          cy="50%"
          r="50%"
        >
          <stop
            offset="0"
            stopColor="#008cff"
            stopOpacity="0.3"
          />

          <stop
            offset="0.38"
            stopColor="#006fd4"
            stopOpacity="0.11"
          />

          <stop
            offset="1"
            stopColor="#00111d"
            stopOpacity="0"
          />
        </radialGradient>

        <radialGradient
          id={cyanAreaGlowId}
          cx="50%"
          cy="50%"
          r="50%"
        >
          <stop
            offset="0"
            stopColor="#20efff"
            stopOpacity="0.22"
          />

          <stop
            offset="0.42"
            stopColor="#00a8d8"
            stopOpacity="0.08"
          />

          <stop
            offset="1"
            stopColor="#001018"
            stopOpacity="0"
          />
        </radialGradient>

        <radialGradient
          id={vignetteId}
          cx="50%"
          cy="45%"
          r="72%"
        >
          <stop
            offset="0"
            stopColor="#07121a"
            stopOpacity="0"
          />

          <stop
            offset="0.62"
            stopColor="#02070b"
            stopOpacity="0.16"
          />

          <stop
            offset="1"
            stopColor="#010408"
            stopOpacity="0.86"
          />
        </radialGradient>

        <pattern
          id={gridPatternId}
          width="252"
          height="146"
          patternUnits="userSpaceOnUse"
        >
          <g>
            <path
              d={
                "M42 2H126L168 73 " +
                "126 144H42L0 73Z"
              }
              fill={`url(#${tileGradientId})`}
              stroke="#1d3446"
              strokeWidth="2"
            />

            <path
              d={
                "M168 -71H252L294 0 " +
                "252 71H168L126 0Z"
              }
              fill={`url(#${tileGradientId})`}
              stroke="#1b3244"
              strokeWidth="2"
            />

            <path
              d={
                "M168 75H252L294 146 " +
                "252 217H168L126 146Z"
              }
              fill={`url(#${tileGradientId})`}
              stroke="#1b3244"
              strokeWidth="2"
            />

            <path
              d="M42 2H126"
              fill="none"
              stroke="rgba(132,177,207,0.16)"
              strokeWidth="1"
            />

            <path
              d="M0 73 42 144"
              fill="none"
              stroke="rgba(0,0,0,0.65)"
              strokeWidth="3"
            />

            <path
              d="M168 73 126 144"
              fill="none"
              stroke="rgba(0,0,0,0.55)"
              strokeWidth="3"
            />
          </g>
        </pattern>

        <filter
          id={textureFilterId}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.018 0.034"
            numOctaves="4"
            seed="19"
            result="noise"
          />

          <feColorMatrix
            in="noise"
            type="matrix"
            values={
              "0.20 0 0 0 0.02 " +
              "0 0.28 0 0 0.04 " +
              "0 0 0.38 0 0.06 " +
              "0 0 0 0.34 0"
            }
            result="coloredNoise"
          />

          <feBlend
            in="SourceGraphic"
            in2="coloredNoise"
            mode="soft-light"
          />
        </filter>

        <filter
          id={glowFilterId}
          x="-100%"
          y="-100%"
          width="300%"
          height="300%"
        >
          <feGaussianBlur
            stdDeviation="3.4"
            result="blur"
          />

          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter
          id={strongGlowFilterId}
          x="-150%"
          y="-150%"
          width="400%"
          height="400%"
        >
          <feGaussianBlur
            stdDeviation="7"
            result="wideBlur"
          />

          <feGaussianBlur
            in="SourceGraphic"
            stdDeviation="2.2"
            result="tightBlur"
          />

          <feMerge>
            <feMergeNode in="wideBlur" />
            <feMergeNode in="tightBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect
        width="1600"
        height="1000"
        fill="#04090e"
      />

      <rect
        width="1600"
        height="1000"
        fill={`url(#${gridPatternId})`}
        filter={`url(#${textureFilterId})`}
      />

      <g opacity="0.72">
        <ellipse
          cx="240"
          cy="240"
          rx="300"
          ry="260"
          fill={`url(#${blueAreaGlowId})`}
        />

        <ellipse
          cx="1210"
          cy="240"
          rx="350"
          ry="280"
          fill={`url(#${blueAreaGlowId})`}
        />

        <ellipse
          cx="900"
          cy="690"
          rx="390"
          ry="300"
          fill={`url(#${blueAreaGlowId})`}
        />

        <ellipse
          cx="450"
          cy="610"
          rx="210"
          ry="180"
          fill={`url(#${cyanAreaGlowId})`}
        />

        <ellipse
          cx="1250"
          cy="630"
          rx="230"
          ry="190"
          fill={`url(#${cyanAreaGlowId})`}
        />
      </g>

      <g
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${glowFilterId})`}
      >
        <g
          stroke="#008cff"
          strokeWidth="3"
          opacity="0.72"
        >
          <path d="M0 177H62" />
          <path d="M62 177 105 248" />
          <path d="M105 248H188" />

          <path d="M212 67H295" />
          <path d="M295 67 337 138" />

          <path d="M379 283H463" />
          <path d="M463 283 505 354" />

          <path d="M548 67H631" />
          <path d="M631 67 673 138" />

          <path d="M758 229H842" />
          <path d="M842 229 884 300" />

          <path d="M967 121H1051" />
          <path d="M1051 121 1093 192" />

          <path d="M1177 229H1261" />
          <path d="M1261 229 1303 300" />

          <path d="M1387 67H1471" />
          <path d="M1471 67 1513 138" />

          <path d="M128 393H211" />
          <path d="M211 393 253 464" />

          <path d="M379 501H463" />
          <path d="M463 501 505 572" />

          <path d="M630 447H714" />
          <path d="M714 447 756 518" />

          <path d="M841 393H925" />
          <path d="M925 393 967 464" />

          <path d="M1051 555H1135" />
          <path d="M1135 555 1177 626" />

          <path d="M1302 447H1386" />
          <path d="M1386 447 1428 518" />

          <path d="M43 718H127" />
          <path d="M127 718 169 789" />

          <path d="M337 664H421" />
          <path d="M421 664 463 735" />

          <path d="M630 772H714" />
          <path d="M714 772 756 843" />

          <path d="M967 718H1051" />
          <path d="M1051 718 1093 789" />

          <path d="M1261 772H1345" />
          <path d="M1345 772 1387 843" />

          <path d="M1471 610H1555" />
        </g>

        <g
          stroke="#22efff"
          strokeWidth="2.4"
          opacity="0.62"
        >
          <path d="M253 175H337" />
          <path d="M505 229 547 158" />
          <path d="M715 121H799" />
          <path d="M1093 338H1177" />
          <path d="M1345 284H1429" />
          <path d="M211 610H295" />
          <path d="M505 718H589" />
          <path d="M756 572H840" />
          <path d="M1177 664H1261" />
          <path d="M1428 880H1512" />
        </g>
      </g>

      <g
        filter={`url(#${strongGlowFilterId})`}
      >
        <circle
          cx="212"
          cy="176"
          r="4"
          fill="#66f3ff"
        />

        <circle
          cx="463"
          cy="283"
          r="4"
          fill="#14caff"
        />

        <circle
          cx="631"
          cy="67"
          r="4"
          fill="#42ecff"
        />

        <circle
          cx="842"
          cy="229"
          r="4"
          fill="#23bfff"
        />

        <circle
          cx="1093"
          cy="192"
          r="4"
          fill="#36dfff"
        />

        <circle
          cx="1261"
          cy="229"
          r="4"
          fill="#25baff"
        />

        <circle
          cx="463"
          cy="501"
          r="4"
          fill="#37dcff"
        />

        <circle
          cx="925"
          cy="393"
          r="4"
          fill="#15b5ff"
        />

        <circle
          cx="1135"
          cy="555"
          r="4"
          fill="#58f7ff"
        />

        <circle
          cx="714"
          cy="772"
          r="4"
          fill="#20caff"
        />

        <circle
          cx="1051"
          cy="718"
          r="4"
          fill="#29c7ff"
        />

        <circle
          cx="1387"
          cy="843"
          r="4"
          fill="#1cabff"
        />
      </g>

      <rect
        width="1600"
        height="1000"
        fill={`url(#${vignetteId})`}
      />

      <rect
        width="1600"
        height="1000"
        fill="rgba(1,5,9,0.18)"
      />
    </svg>
  );
}

function CoverPlaceholder({
  variant = 1,
  label = "Awaiting catalog",
}) {
  return (
    <div
      className={
        `cover-placeholder ` +
        `cover-placeholder--${variant}`
      }
      role="img"
      aria-label={label}
    >
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
      >
        <defs>
          <radialGradient
            id={`cover-glow-${variant}`}
          >
            <stop
              offset="0"
              stopColor="#45e7ff"
              stopOpacity=".85"
            />

            <stop
              offset=".35"
              stopColor="#087bf1"
              stopOpacity=".34"
            />

            <stop
              offset="1"
              stopColor="#02050a"
              stopOpacity="0"
            />
          </radialGradient>
        </defs>

        <circle
          cx="50"
          cy="50"
          r="42"
          fill={`url(#cover-glow-${variant})`}
        />

        <path
          d={
            "M8 64c18-22 34-28 47-17 " +
            "11 10 20 8 37-12"
          }
          fill="none"
          stroke="rgba(123,229,255,.75)"
          strokeWidth="2"
        />

        <circle
          cx="50"
          cy="50"
          r="16"
          fill="none"
          stroke="rgba(255,255,255,.35)"
        />

        <circle
          cx="50"
          cy="50"
          r="4"
          fill="#07121b"
          stroke="#20d6ff"
        />
      </svg>
    </div>
  );
}

function MobileHeader({
  title,
  onOpenAuth,
}) {
  return (
    <header className="mobile-header">
      <BrandLogo
        idPrefix="mobile-logo"
        compact
      />

      <h1>{title}</h1>

      <button
        className="icon-button"
        type="button"
        onClick={onOpenAuth}
        aria-label="Open account panel"
      >
        <Icon
          name="bell"
          size={18}
        />

        <span
          className="icon-button__dot"
          aria-hidden="true"
        />
      </button>
    </header>
  );
}

function DesktopSidebar({
  activePage,
  onNavigate,
  onOpenAuth,
}) {
  return (
    <aside className="desktop-sidebar">
      <BrandLogo idPrefix="desktop-logo" />

      <nav
        className="desktop-nav"
        aria-label="Desktop navigation"
      >
        <span className="desktop-nav__label">
          Menu
        </span>

        {NAV_ITEMS.map((item) => (
          <button
            className={
              activePage === item.id
                ? "desktop-nav__item is-active"
                : "desktop-nav__item"
            }
            type="button"
            key={item.id}
            onClick={() => onNavigate(item.id)}
          >
            <Icon
              name={item.icon}
              size={20}
            />

            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="desktop-sidebar__spacer" />

      <button
        className="desktop-account"
        type="button"
        onClick={onOpenAuth}
      >
        <span className="avatar avatar--small">
          G
        </span>

        <span>
          <strong>Guest mode</strong>
          <small>Sign in to save music</small>
        </span>

        <Icon
          name="chevron"
          size={16}
        />
      </button>
    </aside>
  );
}

function DesktopTopbar({
  activePage,
  searchQuery,
  onSearchChange,
  onOpenAuth,
}) {
  return (
    <header className="desktop-topbar">
      <div className="desktop-topbar__title">
        <span>HyperSync</span>
        <h1>{PAGE_TITLES[activePage]}</h1>
      </div>

      <label className="desktop-search">
        <Icon
          name="search"
          size={18}
        />

        <input
          type="search"
          value={searchQuery}
          placeholder="Search songs, artists, or albums"
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
        />
      </label>

      <button
        className="desktop-profile-button"
        type="button"
        onClick={onOpenAuth}
      >
        <span className="avatar avatar--tiny">
          G
        </span>

        <span>Guest</span>

        <Icon
          name="chevron"
          size={15}
        />
      </button>
    </header>
  );
}

function DesktopRightRail() {
  return (
    <aside className="desktop-right-rail">
      <div className="right-rail-heading">
        <span>Now playing</span>
        <h2>No track selected</h2>
      </div>

      <div className="right-rail-art">
        <CoverPlaceholder
          variant={2}
          label="No track artwork"
        />
      </div>

      <div className="right-rail-empty">
        <Icon
          name="music"
          size={28}
        />

        <strong>Playback is waiting</strong>

        <p>
          Real track information will appear here
          after the catalog and streaming endpoints
          are connected.
        </p>
      </div>

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
          Choose a real track after catalog
          integration.
        </small>
      </div>
    </aside>
  );
}

function SectionHeading({
  title,
  actionLabel,
  onAction,
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>

      {actionLabel ? (
        <button
          type="button"
          onClick={onAction}
        >
          {actionLabel}

          <Icon
            name="chevron"
            size={14}
          />
        </button>
      ) : null}
    </div>
  );
}

function HomePage({ onNavigate }) {
  return (
    <div className="page-stack home-page">
      <section>
        <SectionHeading
          title="Recently Played"
          actionLabel="View all"
          onAction={() => {
            onNavigate("library");
          }}
        />

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
            <strong>No listening history yet</strong>

            <p>
              Once real playback is connected,
              recently played music will appear
              in this section.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function SearchPage({
  query,
  onQueryChange,
}) {
  const normalizedQuery = query.trim();

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

        <div className="search-empty-panel">
          <Icon
            name="search"
            size={30}
          />

          <strong>
            {normalizedQuery
              ? "Catalog search is not connected yet"
              : "Suggestions are waiting for your catalog"}
          </strong>

          <p>
            {normalizedQuery
              ? (
                "Your query is stored in the interface, " +
                "but HyperSync will not invent results " +
                "before the real catalog API is available."
              )
              : (
                "Real suggestions will be calculated from " +
                "catalog and listening data after those " +
                "services are connected."
              )}
          </p>
        </div>
      </section>
    </div>
  );
}

function LibraryPage({ onOpenAuth }) {
  const [activeTab, setActiveTab] =
    useState("Playlists");

  const emptyIcon =
    activeTab === "Playlists"
      ? "playlist"
      : activeTab === "Artists"
        ? "people"
        : activeTab === "Albums"
          ? "disc"
          : "music";

  return (
    <div className="page-stack library-page">
      <div
        className="library-tabs"
        role="tablist"
        aria-label="Library sections"
      >
        {LIBRARY_TABS.map((tab) => (
          <button
            className={
              activeTab === tab
                ? "is-active"
                : ""
            }
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            key={tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <button
        className="create-playlist-button"
        type="button"
        onClick={onOpenAuth}
      >
        <span>
          <Icon
            name="plus"
            size={19}
          />
        </span>

        <strong>Create Playlist</strong>

        <Icon
          name="lock"
          size={16}
        />
      </button>

      <section className="library-list-panel">
        <div className="library-empty-symbol">
          <Icon
            name={emptyIcon}
            size={34}
          />
        </div>

        <h2>
          No {activeTab.toLowerCase()} saved yet
        </h2>

        <p>
          Guest mode can browse and listen, but
          saving library items requires an account
          and the real library API.
        </p>

        <button
          className="primary-button"
          type="button"
          onClick={onOpenAuth}
        >
          Open account options
        </button>
      </section>
    </div>
  );
}

function ProfileStat({
  icon,
  value,
  label,
}) {
  return (
    <div className="profile-stat">
      <span>
        <Icon
          name={icon}
          size={18}
        />
      </span>

      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  onClick,
  disabled = false,
}) {
  return (
    <button
      className="settings-row"
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      <Icon
        name={icon}
        size={17}
      />

      <span>{label}</span>

      {value ? <small>{value}</small> : null}

      <Icon
        name="chevron"
        size={15}
      />
    </button>
  );
}

function ProfilePage({
  onOpenAuth,
  compactMode,
  onToggleCompact,
  statusMessage,
  onStatusMessage,
}) {
  return (
    <div className="page-stack profile-page">
      <section className="profile-identity">
        <div className="profile-avatar-wrap">
          <div className="profile-avatar">
            <svg
              viewBox="0 0 100 100"
              role="img"
              aria-label="Guest profile avatar"
            >
              <defs>
                <radialGradient id="guest-avatar-glow">
                  <stop
                    offset="0"
                    stopColor="#184d70"
                  />

                  <stop
                    offset="1"
                    stopColor="#061018"
                  />
                </radialGradient>
              </defs>

              <circle
                cx="50"
                cy="50"
                r="49"
                fill="url(#guest-avatar-glow)"
              />

              <circle
                cx="50"
                cy="36"
                r="17"
                fill="none"
                stroke="#a9d8e8"
                strokeWidth="4"
              />

              <path
                d={
                  "M20 88c4-24 14-35 30-35" +
                  "s26 11 30 35"
                }
                fill="none"
                stroke="#a9d8e8"
                strokeWidth="4"
              />
            </svg>
          </div>

          <button
            type="button"
            onClick={onOpenAuth}
            aria-label="Open account options"
          >
            <Icon
              name="edit"
              size={13}
            />
          </button>
        </div>

        <div className="profile-identity__copy">
          <h2>Guest</h2>

          <p>
            Music synced to your style.
          </p>

          <button
            type="button"
            onClick={onOpenAuth}
          >
            Account required
          </button>
        </div>
      </section>

      <section className="profile-stats bevel-panel">
        <ProfileStat
          icon="music"
          value="—"
          label="Playlists"
        />

        <ProfileStat
          icon="people"
          value="—"
          label="Followers"
        />

        <ProfileStat
          icon="profile"
          value="—"
          label="Following"
        />

        <ProfileStat
          icon="headphones"
          value="—"
          label="Hours Listened"
        />
      </section>

      <section>
        <SectionHeading title="Recently Played" />

        <div className="profile-card-grid">
          {[1, 2, 3, 4].map((variant) => (
            <article
              className="profile-media-card"
              key={variant}
            >
              <CoverPlaceholder
                variant={variant}
              />

              <strong>Empty slot</strong>
              <small>No listening data</small>
            </article>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title="Favorite Genres" />

        <div className="genre-empty-panel">
          <div
            className="genre-bars"
            aria-hidden="true"
          >
            {[72, 58, 44, 36, 28, 20].map(
              (width, index) => (
                <span
                  key={width}
                  style={{
                    "--bar-width": `${width}%`,
                    "--bar-delay":
                      `${index * 70}ms`,
                  }}
                />
              ),
            )}
          </div>

          <div>
            <strong>
              No genre profile yet
            </strong>

            <p>
              Your real listening history will
              determine these results.
            </p>
          </div>
        </div>
      </section>

      <section>
        <SectionHeading title="Settings" />

        <div
          className={
            "settings-panel " +
            "settings-panel--settings"
          }
        >
          <SettingsRow
            icon="sun"
            label="Appearance"
            value={
              compactMode
                ? "Compact"
                : "Comfortable"
            }
            onClick={onToggleCompact}
          />

          <SettingsRow
            icon="volume"
            label="Audio Quality"
            value="Not connected"
            onClick={() => {
              onStatusMessage(
                "Audio quality settings will " +
                "activate with real playback.",
              );
            }}
          />

          <SettingsRow
            icon="bell"
            label="Notifications"
            value="Not connected"
            onClick={() => {
              onStatusMessage(
                "Notifications are not connected yet.",
              );
            }}
          />

          <SettingsRow
            icon="shield"
            label="Privacy"
            value="Pending"
            onClick={() => {
              onStatusMessage(
                "Privacy controls will be added " +
                "before account launch.",
              );
            }}
          />
        </div>
      </section>

      <section>
        <SectionHeading title="Account" />

        <div
          className={
            "settings-panel " +
            "settings-panel--account"
          }
        >
          <SettingsRow
            icon="profile"
            label="Sign in or create account"
            onClick={onOpenAuth}
          />

          <SettingsRow
            icon="link"
            label="Linked Accounts"
            value="Unavailable"
            onClick={() => {
              onStatusMessage(
                "Linked accounts are not " +
                "implemented yet.",
              );
            }}
          />

          <SettingsRow
            icon="logout"
            label="Log Out"
            value="Guest"
            disabled
          />
        </div>
      </section>

      {statusMessage ? (
        <p
          className="inline-status"
          role="status"
        >
          {statusMessage}
        </p>
      ) : null}
    </div>
  );
}

function MainPage({
  activePage,
  onNavigate,
  onOpenAuth,
  query,
  onQueryChange,
  compactMode,
  onToggleCompact,
  statusMessage,
  onStatusMessage,
}) {
  if (activePage === "search") {
    return (
      <SearchPage
        query={query}
        onQueryChange={onQueryChange}
      />
    );
  }

  if (activePage === "library") {
    return (
      <LibraryPage onOpenAuth={onOpenAuth} />
    );
  }

  if (activePage === "profile") {
    return (
      <ProfilePage
        onOpenAuth={onOpenAuth}
        compactMode={compactMode}
        onToggleCompact={onToggleCompact}
        statusMessage={statusMessage}
        onStatusMessage={onStatusMessage}
      />
    );
  }

  return (
  <HomePage onNavigate={onNavigate} />
 );
}

function MobileBottomNav({
  activePage,
  onNavigate,
}) {
  return (
    <nav
      className="mobile-bottom-nav"
      aria-label="Mobile navigation"
    >
      {NAV_ITEMS.map((item) => (
        <button
          className={
            activePage === item.id
              ? "is-active"
              : ""
          }
          type="button"
          key={item.id}
          onClick={() => {
            onNavigate(item.id);
          }}
          aria-current={
            activePage === item.id
              ? "page"
              : undefined
          }
        >
          <Icon
            name={item.icon}
            size={20}
          />

          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function PlayerBar() {
  return (
    <section
      className="player-bar"
      aria-label="Player status"
    >
      <div className="player-bar__track">
        <CoverPlaceholder
          variant={1}
          label="No track artwork"
        />

        <span>
          <strong>Nothing playing</strong>

          <small>
            Select a real track after catalog
            integration
          </small>
        </span>
      </div>

      <button
        className="player-like"
        type="button"
        disabled
        aria-label="Like unavailable"
      >
        <Icon
          name="heart"
          size={19}
        />
      </button>

      <div className="desktop-player-controls">
        <button
          type="button"
          disabled
          aria-label="Previous unavailable"
        >
          <Icon
            name="previous"
            size={17}
          />
        </button>

        <button
          className={
            "desktop-player-controls__main"
          }
          type="button"
          disabled
          aria-label="Play unavailable"
        >
          <Icon
            name="play"
            size={21}
          />
        </button>

        <button
          type="button"
          disabled
          aria-label="Next unavailable"
        >
          <Icon
            name="next"
            size={17}
          />
        </button>
      </div>

      <div
        className="desktop-progress"
        aria-hidden="true"
      >
        <span>0:00</span>
        <i />
        <span>0:00</span>
      </div>

      <button
        className="mobile-player-control"
        type="button"
        disabled
        aria-label="Playback unavailable"
      >
        <Icon
          name="play"
          size={19}
        />
      </button>
    </section>
  );
}

function AuthOverlay({
  open,
  mode,
  onModeChange,
  onClose,
  onGuest,
}) {
  const [showPassword, setShowPassword] =
    useState(false);

  const [rememberMe, setRememberMe] =
    useState(true);

  const [message, setMessage] =
    useState("");

  if (!open) {
    return null;
  }

  const isCreate = mode === "create";

  function submit(event) {
    event.preventDefault();

    setMessage(
      isCreate
        ? (
          "Registration is not connected " +
          "to the backend yet."
        )
        : (
          "Sign-in is not connected " +
          "to the backend yet."
        ),
    );
  }

  return (
    <div
      className="auth-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
    >
      <HexBackdrop idPrefix="main-app-background" />

      <div className="auth-panel bevel-panel">
        <button
          className="auth-close"
          type="button"
          onClick={onClose}
          aria-label="Close account screen"
        >
          <Icon
            name="close"
            size={20}
          />
        </button>

        <BrandLogo idPrefix="auth-logo" />

        <div className="auth-heading">
          <h2 id="auth-title">
            {isCreate
              ? "Create your HyperSync account"
              : "Welcome to HyperSync"}
          </h2>

          <p>
            {isCreate
              ? (
                "Account creation will be connected " +
                "to the real authentication API."
              )
              : (
                "Sync your world. Stream your sound. " +
                "Feel the music."
              )}
          </p>
        </div>

        <form
          className="auth-form"
          onSubmit={submit}
        >
          <label>
            <Icon
              name="mail"
              size={22}
            />

            <input
              type="text"
              name="username"
              autoComplete="username"
              placeholder="Username"
              required
            />
          </label>

          {isCreate ? (
            <label>
              <Icon
                name="mail"
                size={22}
              />

              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="Email address"
                required
              />
            </label>
          ) : null}

          <label>
            <Icon
              name="lock"
              size={22}
            />

            <input
              type={
                showPassword
                  ? "text"
                  : "password"
              }
              name="password"
              autoComplete={
                isCreate
                  ? "new-password"
                  : "current-password"
              }
              placeholder="Password"
              required
            />

            <button
              type="button"
              onClick={() => {
                setShowPassword(
                  (value) => !value,
                );
              }}
              aria-label={
                showPassword
                  ? "Hide password"
                  : "Show password"
              }
            >
              <Icon
                name={
                  showPassword
                    ? "eyeOff"
                    : "eye"
                }
                size={22}
              />
            </button>
          </label>

          {!isCreate ? (
            <div className="auth-options">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => {
                    setRememberMe(
                      event.target.checked,
                    );
                  }}
                />

                <span>
                  <Icon
                    name="check"
                    size={15}
                  />
                </span>

                Remember me
              </label>

              <button
                type="button"
                onClick={() => {
                  setMessage(
                    "Password recovery is not " +
                    "implemented yet.",
                  );
                }}
              >
                Forgot password?
              </button>
            </div>
          ) : null}

          <button
            className="auth-submit"
            type="submit"
          >
            {isCreate
              ? "CREATE ACCOUNT"
              : "SIGN IN"}
          </button>
        </form>

        <div className="auth-divider">
          <span>OR</span>
        </div>

        <button
          className="auth-secondary"
          type="button"
          onClick={() => {
            onModeChange(
              isCreate
                ? "signin"
                : "create",
            );
          }}
        >
          {isCreate
            ? "BACK TO SIGN IN"
            : "CREATE ACCOUNT"}
        </button>

        <button
          className="auth-guest"
          type="button"
          onClick={onGuest}
        >
          or use without account
        </button>

        {message ? (
          <p
            className="auth-message"
            role="status"
          >
            {message}
          </p>
        ) : null}

        <p className="auth-legal">
          Terms of Service and Privacy Policy
          pages will be linked before launch.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [activePage, setActivePage] =
    useState("home");

  const [searchQuery, setSearchQuery] =
    useState("");

  const [authOpen, setAuthOpen] =
    useState(true);

  const [authMode, setAuthMode] =
    useState("signin");

  const [compactMode, setCompactMode] =
    useState(false);

  const [statusMessage, setStatusMessage] =
    useState("");

  const pageTitle =
    PAGE_TITLES[activePage] ??
    "HyperSync";

  const appClassName = useMemo(
    () => (
      `app-shell ${
        compactMode
          ? "is-compact"
          : ""
      }`
    ),
    [compactMode],
  );

  function navigate(page) {
    setActivePage(page);
    setStatusMessage("");
  }

  function updateSearch(value) {
    setSearchQuery(value);

    if (activePage !== "search") {
      setActivePage("search");
    }
  }

  function openAuth(mode = "signin") {
    setAuthMode(mode);
    setAuthOpen(true);
  }

  return (
    <div className={appClassName}>
      <HexBackdrop idPrefix="auth-overlay-background" />

      <DesktopSidebar
        activePage={activePage}
        onNavigate={navigate}
        onOpenAuth={() => {
          openAuth("signin");
        }}
      />

      <section className="main-workspace">
        <MobileHeader
          title={pageTitle}
          onOpenAuth={() => {
            openAuth("signin");
          }}
        />

        <DesktopTopbar
          activePage={activePage}
          searchQuery={searchQuery}
          onSearchChange={updateSearch}
          onOpenAuth={() => {
            openAuth("signin");
          }}
        />

        <main className="main-content">
          <MainPage
            activePage={activePage}
            onNavigate={navigate}
            onOpenAuth={() => {
              openAuth("signin");
            }}
            query={searchQuery}
            onQueryChange={updateSearch}
            compactMode={compactMode}
            onToggleCompact={() => {
              setCompactMode(
                (value) => !value,
              );
            }}
            statusMessage={statusMessage}
            onStatusMessage={setStatusMessage}
          />
        </main>
      </section>

      <DesktopRightRail />

      <PlayerBar />

      <MobileBottomNav
        activePage={activePage}
        onNavigate={navigate}
      />

      <AuthOverlay
        open={authOpen}
        mode={authMode}
        onModeChange={setAuthMode}
        onClose={() => {
          setAuthOpen(false);
        }}
        onGuest={() => {
          setAuthOpen(false);
        }}
      />
    </div>
  );
}
