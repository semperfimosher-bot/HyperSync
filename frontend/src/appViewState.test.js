import test from "node:test";

import assert from
  "node:assert/strict";

import {
  normalizeAppViewState,
} from "./appViewState.js";


test(
  "defaults invalid state to home",
  () => {
    assert.deepEqual(
      normalizeAppViewState(
        {
          active_page:
            "not-a-page",
        },
        "user",
      ),
      {
        activePage: "home",
        searchQuery: "",
        profileUsername: "",
      },
    );
  },
);


test(
  "restores search context",
  () => {
    assert.deepEqual(
      normalizeAppViewState(
        {
          active_page:
            "search",
          search_query:
            "Eminem",
          profile_username:
            null,
        },
        "user",
      ),
      {
        activePage:
          "search",
        searchQuery:
          "Eminem",
        profileUsername:
          "",
      },
    );
  },
);


test(
  "restores a public profile",
  () => {
    assert.deepEqual(
      normalizeAppViewState(
        {
          active_page:
            "public-profile",
          search_query:
            "",
          profile_username:
            "Jack",
        },
        "user",
      ),
      {
        activePage:
          "public-profile",
        searchQuery:
          "",
        profileUsername:
          "Jack",
      },
    );
  },
);


test(
  "blocks admin state for normal users",
  () => {
    assert.equal(
      normalizeAppViewState(
        {
          active_page:
            "admin",
        },
        "user",
      ).activePage,
      "home",
    );
  },
);


test(
  "allows admin state for admins",
  () => {
    assert.equal(
      normalizeAppViewState(
        {
          active_page:
            "admin",
        },
        "admin",
      ).activePage,
      "admin",
    );
  },
);
