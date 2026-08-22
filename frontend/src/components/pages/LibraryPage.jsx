import { useState } from "react";

import Icon from "../ui/Icon.jsx";

import { LIBRARY_TABS } from "../../constants.js";

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

export default LibraryPage
