import { memo } from "react";

const GRID_PATH =
  "M0 45H1213 " +
  "M0 90H1213 " +
  "M0 135H1213 " +
  "M0 180H1213 " +
  "M0 225H1213 " +
  "M0 270H1213 " +
  "M0 315H1213 " +
  "M0 360H1213 " +
  "M0 405H1213 " +
  "M60 0V453 " +
  "M120 0V453 " +
  "M180 0V453 " +
  "M240 0V453 " +
  "M300 0V453 " +
  "M360 0V453 " +
  "M420 0V453 " +
  "M480 0V453 " +
  "M540 0V453 " +
  "M600 0V453 " +
  "M660 0V453 " +
  "M720 0V453 " +
  "M780 0V453 " +
  "M840 0V453 " +
  "M900 0V453 " +
  "M960 0V453 " +
  "M1020 0V453 " +
  "M1080 0V453 " +
  "M1140 0V453 " +
  "M1200 0V453";

const PRIMARY_TRACES = [
  "M82 35H242C288 35 303 96 356 96H486",
  "M72 47H233C279 47 294 108 347 108H486",
  "M500 35H690C731 35 744 89 786 89H1001",
  "M500 48H681C722 48 735 102 777 102H991",
  "M0 157H478C538 157 558 188 621 188H1057",
  "M0 170H468C528 170 548 201 611 201H1057",
  "M182 194H310C348 194 364 225 402 225H633",
  "M182 207H301C339 207 355 238 393 238H623",
  "M583 218H704C749 218 758 246 800 246H968",
  "M592 230H696C739 230 748 258 790 258H958",
  "M0 294H299C339 294 354 326 395 326H608",
  "M0 307H290C330 307 345 339 386 339H598",
  "M0 355H270C309 355 325 325 363 325H446",
  "M0 389H278C321 389 339 337 390 337H661",
];

const SECONDARY_TRACES = [
  "M0 121H194C234 121 253 145 295 145H475",
  "M0 132H185C225 132 244 156 286 156H466",
  "M155 270H321C362 270 378 302 421 302H652",
  "M151 281H312C353 281 369 313 412 313H643",
  "M344 78H512C549 78 565 109 605 109H790",
  "M737 286H848C885 286 899 263 936 263H1054",
  "M58 409H268C306 409 326 377 365 377H530",
  "M717 152H814C851 152 864 177 901 177H1127",
];

const NODES = [
  { x: 1002, y: 95 },
  { x: 1058, y: 194 },
  { x: 968, y: 246 },
];

function HexBackdrop() {
  return (
    <svg
      className="hex-backdrop circuit-backdrop"
      viewBox="0 0 1213 453"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="circuit-backdrop__grid"
        d={GRID_PATH}
      />

      <g className="circuit-backdrop__soft-glow">
        {SECONDARY_TRACES.map((trace) => (
          <path
            key={`soft-glow-${trace}`}
            d={trace}
          />
        ))}
      </g>

      <g className="circuit-backdrop__soft-lines">
        {SECONDARY_TRACES.map((trace) => (
          <path
            key={`soft-line-${trace}`}
            d={trace}
          />
        ))}
      </g>

      <g className="circuit-backdrop__main-glow">
        {PRIMARY_TRACES.map((trace) => (
          <path
            key={`main-glow-${trace}`}
            d={trace}
          />
        ))}
      </g>

      <g className="circuit-backdrop__main-lines">
        {PRIMARY_TRACES.map((trace) => (
          <path
            key={`main-line-${trace}`}
            d={trace}
          />
        ))}
      </g>

      <g className="circuit-backdrop__highlights">
        <path d="M500 35H690C731 35 744 89 786 89H1001" />
        <path d="M0 157H478C538 157 558 188 621 188H1057" />
        <path d="M583 218H704C749 218 758 246 800 246H968" />
        <path d="M0 294H299C339 294 354 326 395 326H608" />
      </g>

      <g className="circuit-backdrop__streaks">
        <path d="M0 164H611" />
        <path d="M88 229H704" />
        <path d="M0 318H515" />
        <path d="M356 109H893" />
      </g>

      <g className="circuit-backdrop__nodes">
        {NODES.map(({ x, y }) => (
          <g key={`${x}-${y}`}>
            <circle
              className="circuit-backdrop__node-halo"
              cx={x}
              cy={y}
              r="25"
            />

            <circle
              className="circuit-backdrop__node-ring"
              cx={x}
              cy={y}
              r="13"
            />

            <circle
              className="circuit-backdrop__node-core"
              cx={x}
              cy={y}
              r="5"
            />
          </g>
        ))}
      </g>
    </svg>
  );
}

export default memo(HexBackdrop);
