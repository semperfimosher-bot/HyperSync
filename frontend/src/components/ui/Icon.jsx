import { memo } from "react";

const Icon = memo(function Icon({
  name,
  size = 22,
}) {
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
});

export default Icon;
