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
          stroke="#d6f7d3"
          strokeOpacity=".58"
        />
      </svg>

      <span className="brand__wordmark">
        HYPER<span>SYNC</span>
      </span>
    </div>
  );
}

export default BrandLogo;
