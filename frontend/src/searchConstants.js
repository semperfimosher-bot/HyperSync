export const EMPTY_RESULTS = {
  query: "",
  interpreted_query: "",
  intent: "general",
  sort_mode: "smart",
  processing_ms: 0,

  counts: {
  tracks: 0,
  artists: 0,
  collaborations: 0,
  albums: 0,
  people: 0,
  playlists: 0,
},

  tracks: [],
  artists: [],
  collaborations: [],
  albums: [],
  people: [],
  playlists: [],
};


export const FILTERS = [
  ["all", "All"],
  ["albums", "Albums"],
  ["artists", "Artists"],
  [
    "collaborations",
    "Collaborations",
  ],
  ["people", "People"],
  ["playlists", "Playlists"],
  ["tracks", "Tracks"],
];
