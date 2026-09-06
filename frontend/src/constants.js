export const NAV_ITEMS = [
  { id: "home", label: "Home", icon: "home" },
  { id: "search", label: "Search", icon: "search" },
  { id: "library", label: "Library", icon: "library" },
  { id: "profile", label: "Profile", icon: "profile" },
];

export const ADMIN_NAV_ITEMS = [
  {
    id: "admin",
    label: "Dashboard",
    icon: "shield",
  },
  {
    id: "admin-bot",
    label: "Bot Control",
    icon: "chart",
  },
  {
    id: "admin-uploads",
    label: "Uploads",
    icon: "plus",
  },
  {
    id: "admin-catalog",
    label: "Media Catalog",
    icon: "music",
  },
];

export const LIBRARY_TABS = [
  "Playlists",
  "Artists",
  "Albums",
  "Songs",
];

export const SEARCH_CATEGORIES = [
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

export const SEARCH_SUGGESTIONS = [
  "Pop",
  "Rock",
  "Chill",
  "Rap",
  "Ambient",
  "Electronic",
];

export const PAGE_TITLES = {
  home: "Home",
  search: "Search",
  library: "My Library",
  profile: "Profile",

  admin: "Admin Dashboard",
  "admin-bot": "Bot Control",
  "admin-uploads": "Uploads",
  "admin-catalog": "Media Catalog",
};

export const SEARCH_QUICK_COMMANDS = [
  {
    id: "most-played",
    label: "Most Played",
    query: "my most played",
    filter: "tracks",
    focus: false,
  },
  {
    id: "recently-played",
    label: "Recently Played",
    query: "recent songs",
    filter: "tracks",
    focus: false,
  },
  {
    id: "top-artists",
    label: "Top Artists",
    query: "top artists",
    filter: "artists",
    focus: false,
  },
  {
    id: "top-albums",
    label: "Top Albums",
    query: "top albums",
    filter: "albums",
    focus: false,
  },
  {
    id: "find-people",
    label: "Find People",
    query: "",
    filter: "people",
    focus: true,
  },
  {
    id: "new-releases",
    label: "New Releases",
    query: "new releases",
    filter: "tracks",
    focus: false,
  },
];
