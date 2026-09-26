import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  getConversation,
  getConversations,
  sendMessage,
} from "../../messageApi.js";

import {
  searchUsers,
} from "../../profileApi.js";

import {
  resolveArtworkUrl,
} from "../../artworkUrl.js";

import Avatar from
  "../profile/Avatar.jsx";

import Icon from
  "../ui/Icon.jsx";

import useQuietRefresh from
  "../../hooks/useQuietRefresh.js";


function formatMessageTime(
  value,
) {
  if (!value) {
    return "";
  }

  const date =
    new Date(
      value,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "";
  }

  return date.toLocaleString(
    [],
    {
      month:
        "short",
      day:
        "numeric",
      hour:
        "numeric",
      minute:
        "2-digit",
    },
  );
}


function sharedMusicLabel(
  kind,
) {
  if (
    kind === "track"
  ) {
    return "SONG";
  }

  if (
    kind === "album"
  ) {
    return "ALBUM";
  }

  if (
    kind === "artist"
  ) {
    return "ARTIST";
  }

  return "PLAYLIST";
}


function SharedMusicCard({
  item,
  onOpen = null,
}) {
  if (!item) {
    return null;
  }

  const artwork =
    resolveArtworkUrl(
      item.artwork_url,
    );

  const content = (
    <>
      <span className="hs-shared-music-card__art">
        {artwork ? (
          <img
            src={
              artwork
            }
            alt=""
          />
        ) : (
          <Icon
            name={
              item.kind ===
                "playlist"
                ? "playlist"
                : item.kind ===
                    "album"
                  ? "disc"
                  : "music"
            }
            size={22}
          />
        )}
      </span>

      <span className="hs-shared-music-card__copy">
        <small>
          {sharedMusicLabel(
            item.kind,
          )}
        </small>

        <strong>
          {item.title}
        </strong>

        {item.subtitle ? (
          <em>
            {item.subtitle}
          </em>
        ) : null}
      </span>
    </>
  );

  if (
    typeof onOpen ===
      "function"
  ) {
    return (
      <button
        type="button"
        className="hs-shared-music-card is-clickable"
        onClick={
          onOpen
        }
      >
        {content}
      </button>
    );
  }

  return (
    <div className="hs-shared-music-card">
      {content}
    </div>
  );
}


export default function MessagesPage({
  currentUser,
  initialUsername = "",
  onInitialUsernameHandled,
  sharedMusicToSend = null,
  onSharedMusicHandled,
  onOpenSharedMusic,
  onUnreadChange,
  onOpenProfile,
  onBackToSearch,
  resetToken = 0,
}) {
  const [
    conversations,
    setConversations,
  ] = useState([]);

  const [
    unreadCount,
    setUnreadCount,
  ] = useState(0);

  const [
    selectedUsername,
    setSelectedUsername,
  ] = useState("");

  const [
    conversation,
    setConversation,
  ] = useState(null);

  const [
    searchQuery,
    setSearchQuery,
  ] = useState("");

  const [
    searchResults,
    setSearchResults,
  ] = useState([]);

  const [
    draft,
    setDraft,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    conversationLoading,
    setConversationLoading,
  ] = useState(false);

  const [
    sending,
    setSending,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const endRef =
    useRef(null);

  const resetTokenRef =
    useRef(
      resetToken,
    );


  const loadConversations =
    useCallback(
      async ({
        quiet = false,
      } = {}) => {
        try {
          const result =
            await getConversations();

          setConversations(
            Array.isArray(
              result?.conversations,
            )
              ? result.conversations
              : [],
          );

          setUnreadCount(
            Number(
              result?.unread_count ??
              0,
            ) || 0,
          );

          onUnreadChange?.();
        } catch (requestError) {
          if (!quiet) {
            setError(
              requestError
                instanceof Error
                ? requestError.message
                : "Unable to load messages.",
            );
          }
        } finally {
          if (!quiet) {
            setLoading(false);
          }
        }
      },
      [
        onUnreadChange,
      ],
    );


  const openConversation =
    useCallback(
      async (
        username,
      ) => {
        const normalized =
          String(
            username ??
            "",
          ).trim();

        if (!normalized) {
          return;
        }

        setSelectedUsername(
          normalized,
        );

        setConversation(
          null,
        );

        setConversationLoading(
          true,
        );

        setError(
          "",
        );

        try {
          const result =
            await getConversation(
              normalized,
            );

          setConversation(
            result,
          );

          setSearchQuery(
            "",
          );

          setSearchResults(
            [],
          );

          await loadConversations();

          onUnreadChange?.();
        } catch (requestError) {
          setError(
            requestError
              instanceof Error
              ? requestError.message
              : "Unable to open conversation.",
          );
        } finally {
          setConversationLoading(
            false,
          );
        }
      },
      [
        loadConversations,
        onUnreadChange,
      ],
    );


  const closeConversation =
    useCallback(
      () => {
        setSelectedUsername(
          "",
        );

        setConversation(
          null,
        );

        setDraft(
          "",
        );

        setError(
          "",
        );

        void loadConversations();
      },
      [
        loadConversations,
      ],
    );


  useEffect(() => {
    if (
      resetTokenRef.current ===
        resetToken
    ) {
      return;
    }

    resetTokenRef.current =
      resetToken;

    closeConversation();
  }, [
    closeConversation,
    resetToken,
  ]);


  useEffect(() => {
    void loadConversations();
  }, [
    loadConversations,
  ]);


  useQuietRefresh(
    () =>
      loadConversations({
        quiet:
          true,
      }),
    {
      intervalMs:
        15_000,
    },
  );


  const refreshOpenConversation =
    useCallback(
      async () => {
        const username =
          String(
            selectedUsername ??
            "",
          ).trim();

        if (!username) {
          return;
        }

        try {
          const result =
            await getConversation(
              username,
            );

          setConversation(
            result,
          );

          await loadConversations({
            quiet:
              true,
          });

          onUnreadChange?.();
        } catch {
          /*
           * Keep the current thread visible
           * through temporary background
           * refresh failures.
           */
        }
      },
      [
        loadConversations,
        onUnreadChange,
        selectedUsername,
      ],
    );


  useQuietRefresh(
    refreshOpenConversation,
    {
      enabled:
        Boolean(
          selectedUsername,
        ),
      intervalMs:
        4_000,
    },
  );


  useEffect(() => {
    const username =
      String(
        initialUsername ??
        "",
      ).trim();

    if (!username) {
      return;
    }

    void openConversation(
      username,
    );

    onInitialUsernameHandled?.();
  }, [
    initialUsername,
    onInitialUsernameHandled,
    openConversation,
  ]);


  useEffect(() => {
    const query =
      searchQuery.trim();

    if (
      query.length <
      2
    ) {
      setSearchResults(
        [],
      );

      return undefined;
    }

    let cancelled =
      false;

    const timer =
      window.setTimeout(
        async () => {
          try {
            const results =
              await searchUsers(
                query,
              );

            if (!cancelled) {
              setSearchResults(
                (
                  Array.isArray(
                    results,
                  )
                    ? results
                    : []
                ).filter(
                  (person) =>
                    String(
                      person.username,
                    )
                      .toLocaleLowerCase()
                    !==
                    String(
                      currentUser?.username ??
                      "",
                    )
                      .toLocaleLowerCase(),
                ),
              );
            }
          } catch {
            if (!cancelled) {
              setSearchResults(
                [],
              );
            }
          }
        },
        220,
      );

    return () => {
      cancelled =
        true;

      window.clearTimeout(
        timer,
      );
    };
  }, [
    currentUser?.username,
    searchQuery,
  ]);


  useEffect(() => {
    endRef.current
      ?.scrollIntoView({
        block:
          "end",
      });
  }, [
    conversation?.messages?.length,
  ]);


  const openRecipient =
    useCallback(
      async (
        username,
      ) => {
        await openConversation(
          username,
        );
      },
      [
        openConversation,
      ],
    );


  async function submitMessage(
    event,
  ) {
    event.preventDefault();

    const body =
      draft.trim();

    if (
      (
        !body &&
        !sharedMusicToSend
      ) ||
      !selectedUsername ||
      sending
    ) {
      return;
    }

    setSending(
      true,
    );

    setError(
      "",
    );

    try {
      const sent =
        await sendMessage(
          selectedUsername,
          body,
          sharedMusicToSend,
        );

      setConversation(
        (current) => (
          current
            ? {
                ...current,
                messages: [
                  ...(
                    current.messages ??
                    []
                  ),
                  sent,
                ],
              }
            : current
        ),
      );

      setDraft(
        "",
      );

      if (
        sharedMusicToSend
      ) {
        onSharedMusicHandled?.();
      }

      await loadConversations();

      onUnreadChange?.();
    } catch (requestError) {
      setError(
        requestError
          instanceof Error
          ? requestError.message
          : "Unable to send message.",
      );
    } finally {
      setSending(
        false,
      );
    }
  }


  if (selectedUsername) {
    return (
      <div className="page-stack hs-messages-page hs-messages-page--thread">
        {error ? (
          <section className="hs-search-message hs-search-message--error">
            <Icon
              name="mail"
              size={22}
            />

            <div>
              <strong>
                MESSAGING ERROR
              </strong>

              <p>
                {error}
              </p>
            </div>
          </section>
        ) : null}

        <section className="hs-message-thread hs-message-thread--focused">
          <header className="hs-message-thread__header hs-message-thread__header--focused">
            <button
              type="button"
              className="hs-search-playlist-back hs-message-thread__back hs-message-thread__back--desktop"
              onClick={
                closeConversation
              }
            >
              <Icon
                name="chevron"
                size={15}
              />

              Back to messages
            </button>

            <button
              type="button"
              className="hs-search-playlist-back hs-message-thread__back hs-message-thread__back--mobile"
              onClick={() => {
                onBackToSearch?.();
              }}
            >
              <Icon
                name="chevron"
                size={15}
              />

              Back to search
            </button>

            {conversation ? (
              <button
                type="button"
                className="hs-message-thread__person"
                onClick={() => {
                  onOpenProfile?.(
                    conversation
                      .participant
                      .username,
                  );
                }}
              >
                <Avatar
                  src={
                    conversation
                      .participant
                      .avatar_url
                  }
                  name={
                    conversation
                      .participant
                      .display_name
                  }
                  size="small"
                />

                <span>
                  <strong>
                    {conversation
                      .participant
                      .display_name}
                  </strong>

                  <small>
                    {"@"}
                    {conversation
                      .participant
                      .username}
                  </small>
                </span>
              </button>
            ) : (
              <span className="hs-message-thread__loading-name">
                {"@"}
                {selectedUsername}
              </span>
            )}
          </header>

          {conversationLoading ? (
            <div className="hs-message-thread__standby">
              <span className="library-spinner" />

              <strong>
                Opening conversation...
              </strong>
            </div>
          ) : conversation ? (
            <>
              <div className="hs-message-thread__messages">
                {(conversation.messages ?? []).length >
                0 ? (
                  (conversation.messages ?? []).map(
                    (message) => (
                      <article
                        key={
                          message.id
                        }
                        className={
                          message.mine
                            ? "hs-message-bubble is-mine"
                            : "hs-message-bubble"
                        }
                      >
                        {message.shared_music ? (
                          <SharedMusicCard
                            item={
                              message.shared_music
                            }
                            onOpen={() => {
                              onOpenSharedMusic?.(
                                message.shared_music,
                              );
                            }}
                          />
                        ) : null}

                        {message.body ? (
                          <p>
                            {message.body}
                          </p>
                        ) : null}

                        <small>
                          {formatMessageTime(
                            message.created_at,
                          )}
                        </small>
                      </article>
                    ),
                  )
                ) : (
                  <div className="hs-message-thread__standby">
                    <Icon
                      name="mail"
                      size={28}
                    />

                    <strong>
                      Start the conversation
                    </strong>

                    <span>
                      Send the first message below.
                    </span>
                  </div>
                )}

                <div
                  ref={
                    endRef
                  }
                />
              </div>

              <form
                className="hs-message-composer"
                onSubmit={
                  submitMessage
                }
              >
                {sharedMusicToSend ? (
                  <div className="hs-message-composer-share">
                    <SharedMusicCard
                      item={
                        sharedMusicToSend
                      }
                    />

                    <button
                      type="button"
                      aria-label="Remove shared music"
                      title="Remove shared music"
                      onClick={() => {
                        onSharedMusicHandled?.();
                      }}
                    >
                      <Icon
                        name="close"
                        size={14}
                      />
                    </button>
                  </div>
                ) : null}

                <textarea
                  value={draft}
                  rows={2}
                  maxLength={2000}
                  placeholder={
                    "Message @" +
                    conversation
                      .participant
                      .username
                  }
                  onChange={(
                    event,
                  ) => {
                    setDraft(
                      event.target.value,
                    );
                  }}
                  onKeyDown={(
                    event,
                  ) => {
                    if (
                      event.key ===
                        "Enter" &&
                      !event.shiftKey
                    ) {
                      event.preventDefault();

                      event.currentTarget
                        .form
                        ?.requestSubmit();
                    }
                  }}
                />

                <button
                  type="submit"
                  disabled={
                    sending ||
                    (
                      !draft.trim() &&
                      !sharedMusicToSend
                    )
                  }
                >
                  <Icon
                    name="mail"
                    size={16}
                  />

                  {sending
                    ? "Sending..."
                    : "Send"}
                </button>
              </form>
            </>
          ) : null}
        </section>
      </div>
    );
  }


  return (
    <div className="page-stack hs-search-page hs-messages-page">
      {sharedMusicToSend ? (
        <section className="hs-message-share-picker">
          <div>
            <span>
              SHARE IN CHAT
            </span>

            <strong>
              Choose who to send this to
            </strong>
          </div>

          <SharedMusicCard
            item={
              sharedMusicToSend
            }
          />

          <button
            type="button"
            onClick={() => {
              onSharedMusicHandled?.();
            }}
          >
            Cancel
          </button>
        </section>
      ) : null}

      <section className="hs-search-console hs-messages-console">
        <div
          className="hs-search-console__grid"
          aria-hidden="true"
        />

        <div
          className="hs-search-console__ambient hs-search-console__ambient--one"
          aria-hidden="true"
        />

        <div
          className="hs-search-console__ambient hs-search-console__ambient--two"
          aria-hidden="true"
        />

        <div className="hs-search-console__heading">
          <div className="hs-search-console__intro">
            <div className="hs-search-console__eyebrow-row">
              <span className="hs-search-eyebrow">
                <i aria-hidden="true" />

                HYPERSYNCED MESSAGES
              </span>
            </div>

            <h2>
              Your conversations
            </h2>

            <p className="hs-messages-console__copy">
              Find someone by username or open one
              of your existing conversations.
            </p>
          </div>

          <span className="hs-messages-unread">
            {unreadCount}
            {" unread"}
          </span>
        </div>

        <label className="hs-search-input hs-messages-search">
          <span className="hs-search-input__icon">
            <Icon
              name="search"
              size={23}
            />
          </span>

          <input
            type="search"
            value={searchQuery}
            autoComplete="off"
            spellCheck="false"
            placeholder={
              sharedMusicToSend
                ? "Search people to share with..."
                : "Search people by name or @username..."
            }
            onChange={(
              event,
            ) => {
              setSearchQuery(
                event.target.value,
              );
            }}
          />

          <span
            className={
              searchQuery.trim().length >= 2
                ? "hs-search-scan-dot is-active"
                : "hs-search-scan-dot"
            }
            aria-hidden="true"
          />
        </label>

        <div className="hs-search-console__status">
          <span className="hs-search-status-chip hs-search-status-chip--primary">
            <i />

            PRIVATE
          </span>

          <span className="hs-search-status-chip">
            {conversations.length}
            {" CONVERSATIONS"}
          </span>

          <span className="hs-search-status-chip">
            VIEWED MESSAGES EXPIRE IN 7 DAYS
          </span>
        </div>
      </section>


      {error ? (
        <section className="hs-search-message hs-search-message--error">
          <Icon
            name="mail"
            size={22}
          />

          <div>
            <strong>
              MESSAGING ERROR
            </strong>

            <p>
              {error}
            </p>
          </div>
        </section>
      ) : null}


      {searchResults.length > 0 ? (
        <section className="hs-search-section hs-messages-search-section">
          <div className="hs-search-section__heading">
            <div>
              <span>
                PEOPLE
              </span>

              <h3>
                Start a conversation
              </h3>
            </div>

            <strong>
              {searchResults.length}
            </strong>
          </div>

          <div className="user-search-results">
            {searchResults.map(
              (person) => (
                <button
                  type="button"
                  className="user-search-card hs-user-result"
                  key={
                    person.username
                  }
                  onClick={() => {
                    void openRecipient(
                      person.username,
                    );
                  }}
                >
                  <Avatar
                    src={
                      person.avatar_url
                    }
                    name={
                      person.display_name
                    }
                    size="small"
                  />

                  <div>
                    <strong>
                      {person.display_name}
                    </strong>

                    <small>
                      {"@"}
                      {person.username}
                    </small>

                    <p>
                      {sharedMusicToSend
                        ? "Send shared music"
                        : "Open a private conversation"}
                    </p>
                  </div>

                  <Icon
                    name="mail"
                    size={17}
                  />
                </button>
              ),
            )}
          </div>
        </section>
      ) : null}


      <section className="hs-search-section hs-messages-directory">
        <div className="hs-search-section__heading">
          <div>
            <span>
              MESSAGES
            </span>

            <h3>
              Conversations
            </h3>
          </div>

          <strong>
            {conversations.length}
          </strong>
        </div>

        {loading ? (
          <div className="hs-messages-empty hs-messages-empty--directory">
            <span className="library-spinner" />

            <span>
              Loading messages...
            </span>
          </div>
        ) : conversations.length ===
          0 ? (
          <div className="hs-messages-empty hs-messages-empty--directory">
            <Icon
              name="mail"
              size={28}
            />

            <strong>
              No conversations yet
            </strong>

            <span>
              Search for a username above to start one.
            </span>
          </div>
        ) : (
          <div className="user-search-results hs-message-conversation-list">
            {conversations.map(
              (item) => (
                <button
                  type="button"
                  className="user-search-card hs-user-result hs-message-conversation-card"
                  key={
                    item.username
                  }
                  onClick={() => {
                    void openRecipient(
                      item.username,
                    );
                  }}
                >
                  <Avatar
                    src={
                      item.avatar_url
                    }
                    name={
                      item.display_name
                    }
                    size="small"
                  />

                  <div>
                    <strong>
                      {item.display_name}
                    </strong>

                    <small>
                      {"@"}
                      {item.username}
                      {item.latest_at
                        ? (
                          " • " +
                          formatMessageTime(
                            item.latest_at,
                          )
                        )
                        : ""}
                    </small>

                    <p>
                      {item.latest_body ||
                        "Open conversation"}
                    </p>
                  </div>

                  <span className="hs-message-conversation-card__action">
                    {item.unread_count > 0 ? (
                      <b>
                        {item.unread_count}
                      </b>
                    ) : (
                      <Icon
                        name="mail"
                        size={17}
                      />
                    )}
                  </span>
                </button>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
