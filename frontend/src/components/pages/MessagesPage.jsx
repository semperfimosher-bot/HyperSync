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

import Avatar from
  "../profile/Avatar.jsx";

import Icon from
  "../ui/Icon.jsx";


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


export default function MessagesPage({
  currentUser,
  initialUsername = "",
  onInitialUsernameHandled,
  onUnreadChange,
  onOpenProfile,
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
  ] = useState(
    "",
  );

  const [
    conversation,
    setConversation,
  ] = useState(
    null,
  );

  const [
    searchQuery,
    setSearchQuery,
  ] = useState(
    "",
  );

  const [
    searchResults,
    setSearchResults,
  ] = useState([]);

  const [
    draft,
    setDraft,
  ] = useState(
    "",
  );

  const [
    loading,
    setLoading,
  ] = useState(
    true,
  );

  const [
    conversationLoading,
    setConversationLoading,
  ] = useState(
    false,
  );

  const [
    sending,
    setSending,
  ] = useState(
    false,
  );

  const [
    error,
    setError,
  ] = useState(
    "",
  );

  const endRef =
    useRef(
      null,
    );


  const loadConversations =
    useCallback(
      async () => {
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
          setError(
            requestError
              instanceof Error
              ? requestError.message
              : "Unable to load messages.",
          );
        } finally {
          setLoading(
            false,
          );
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


  useEffect(() => {
    void loadConversations();

    const interval =
      window.setInterval(
        () => {
          void loadConversations();
        },
        10_000,
      );

    return () => {
      window.clearInterval(
        interval,
      );
    };
  }, [
    loadConversations,
  ]);


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


  async function submitMessage(
    event,
  ) {
    event.preventDefault();

    const body =
      draft.trim();

    if (
      !body ||
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


  return (
    <div className="page-stack hs-messages-page">

      <section className="hs-search-console hs-messages-console">
        <div
          className="hs-search-console__grid"
          aria-hidden="true"
        />

        <div className="hs-search-console__heading">
          <div className="hs-search-console__intro">
            <div className="hs-search-console__eyebrow-row">
              <span className="hs-search-eyebrow">
                <i aria-hidden="true" />
                PRIVATE MESSAGING
              </span>
            </div>

            <h2>
              Messages
            </h2>

            <p className="hs-messages-console__copy">
              Messages stay stored until seven days
              after the recipient views them.
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
              size={17}
            />
          </span>

          <input
            type="search"
            value={searchQuery}
            autoComplete="off"
            placeholder="Search a username to start a message..."
            onChange={(
              event,
            ) => {
              setSearchQuery(
                event.target.value,
              );
            }}
          />
        </label>

        {searchResults.length > 0 ? (
          <div className="hs-messages-search-results">
            {searchResults.map(
              (person) => (
                <button
                  type="button"
                  key={
                    person.username
                  }
                  onClick={() => {
                    void openConversation(
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

                  <span>
                    <strong>
                      {person.display_name}
                    </strong>

                    <small>
                      {"@"}
                      {person.username}
                    </small>
                  </span>

                  <Icon
                    name="mail"
                    size={17}
                  />
                </button>
              ),
            )}
          </div>
        ) : null}
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


      <section className="hs-messages-shell">

        <aside className="hs-messages-list">
          <div className="hs-messages-list__heading">
            <span>
              CONVERSATIONS
            </span>

            <strong>
              {conversations.length}
            </strong>
          </div>

          {loading ? (
            <div className="hs-messages-empty">
              <span className="library-spinner" />
              <span>
                Loading messages...
              </span>
            </div>
          ) : conversations.length ===
            0 ? (
            <div className="hs-messages-empty">
              <Icon
                name="mail"
                size={24}
              />

              <strong>
                No conversations yet
              </strong>

              <span>
                Search for a username above to start one.
              </span>
            </div>
          ) : (
            conversations.map(
              (item) => (
                <button
                  type="button"
                  className={
                    selectedUsername ===
                    item.username
                      ? "hs-message-conversation is-active"
                      : "hs-message-conversation"
                  }
                  key={
                    item.username
                  }
                  onClick={() => {
                    void openConversation(
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

                  <span className="hs-message-conversation__copy">
                    <span>
                      <strong>
                        {item.display_name}
                      </strong>

                      <small>
                        {formatMessageTime(
                          item.latest_at,
                        )}
                      </small>
                    </span>

                    <em>
                      {item.latest_body}
                    </em>
                  </span>

                  {item.unread_count > 0 ? (
                    <b>
                      {item.unread_count}
                    </b>
                  ) : null}
                </button>
              ),
            )
          )}
        </aside>


        <div className="hs-message-thread">

          {!selectedUsername ? (
            <div className="hs-message-thread__standby">
              <Icon
                name="mail"
                size={34}
              />

              <strong>
                Select a conversation
              </strong>

              <span>
                Or search for someone by username.
              </span>
            </div>
          ) : conversationLoading ? (
            <div className="hs-message-thread__standby">
              <span className="library-spinner" />
              <strong>
                Opening conversation...
              </strong>
            </div>
          ) : conversation ? (
            <>
              <header className="hs-message-thread__header">
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
              </header>

              <div className="hs-message-thread__messages">
                {(conversation.messages ?? []).map(
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
                      <p>
                        {message.body}
                      </p>

                      <small>
                        {formatMessageTime(
                          message.created_at,
                        )}
                      </small>
                    </article>
                  ),
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
                    !draft.trim()
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

        </div>

      </section>

    </div>
  );
}
