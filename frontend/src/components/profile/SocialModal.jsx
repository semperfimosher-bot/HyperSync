import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  acceptFollowRequest,
  declineFollowRequest,
  getFollowers,
  getFollowing,
  getFollowRequests,
} from "../../profileApi.js";

import Avatar from "./Avatar.jsx";
import Icon from "../ui/Icon.jsx";


function memberFor(value) {
  if (!value) {
    return "New member";
  }

  const then =
    new Date(value);

  const days =
    Math.max(
      0,
      Math.floor(
        (Date.now() - then.getTime()) /
          86400000,
      ),
    );

  if (days < 30) {
    return `Member for ${
      Math.max(days, 1)
    } day${days === 1 ? "" : "s"}`;
  }

  if (days < 365) {
    const months =
      Math.max(
        1,
        Math.floor(days / 30),
      );

    return `Member for ${months} month${
      months === 1 ? "" : "s"
    }`;
  }

  const years =
    Math.floor(days / 365);

  return `Member for ${years} year${
    years === 1 ? "" : "s"
  }`;
}


export default function SocialModal({
  mode,
  username,
  onClose,
  onChanged,
  onOpenProfile,
}) {
  const [items, setItems] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const load = useCallback(
    async () => {
      setLoading(true);
      setError("");

      try {
        let data = [];

        if (mode === "requests") {
          data =
            await getFollowRequests();

        } else if (
          mode === "followers"
        ) {
          data =
            await getFollowers(
              username,
            );

        } else {
          data =
            await getFollowing(
              username,
            );
        }

        setItems(data || []);

      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load people.",
        );

      } finally {
        setLoading(false);
      }
    },
    [
      mode,
      username,
    ],
  );


  useEffect(() => {
    void load();
  }, [load]);


  async function accept(
    targetUsername,
  ) {
    try {
      await acceptFollowRequest(
        targetUsername,
      );

      await load();

      onChanged?.();

    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to accept request.",
      );
    }
  }


  async function decline(
    targetUsername,
  ) {
    try {
      await declineFollowRequest(
        targetUsername,
      );

      await load();

      onChanged?.();

    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to decline request.",
      );
    }
  }


  const title =
    mode === "requests"
      ? "Follow Requests"
      : mode === "followers"
        ? "Followers"
        : "Following";


  return (
    <div className="hs-modal-backdrop">
      <section
        className="hs-social-modal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <span className="hs-eyebrow">
              HYPERSYNC SOCIAL
            </span>

            <h2>{title}</h2>
          </div>

          <button
            className="hs-icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon
              name="close"
              size={19}
            />
          </button>
        </header>


        <div className="hs-social-list">
          {loading ? (
            <div className="hs-social-empty">
              Loading...
            </div>

          ) : error ? (
            <div className="hs-social-empty">
              {error}
            </div>

          ) : items.length === 0 ? (
            <div className="hs-social-empty">
              <Icon
                name="people"
                size={28}
              />

              <strong>
                Nothing here yet
              </strong>

              <p>
                New connections will
                appear here.
              </p>
            </div>

          ) : (
            items.map((item) => (
              <article
                className="hs-social-person"
                key={item.username}
              >
                <button
                  className="hs-social-person__identity"
                  type="button"
                  onClick={() => {
                    onClose();

                    onOpenProfile?.(
                      item.username,
                    );
                  }}
                >
                  <Avatar
                    src={item.avatar_url}
                    name={
                      item.display_name
                    }
                    size="small"
                  />

                  <span>
                    <strong>
                      {item.display_name}
                    </strong>

                    <small>
                      @{item.username}
                    </small>

                    <em>
                      {memberFor(
                        item.member_since,
                      )}
                    </em>
                  </span>
                </button>

                {mode === "requests" ? (
                  <div className="hs-request-actions">
                    <button
                      className="hs-primary-button"
                      type="button"
                      onClick={() => {
                        void accept(
                          item.username,
                        );
                      }}
                    >
                      Accept
                    </button>

                    <button
                      className="hs-secondary-button"
                      type="button"
                      onClick={() => {
                        void decline(
                          item.username,
                        );
                      }}
                    >
                      Decline
                    </button>
                  </div>
                ) : (
                  <span className="hs-follower-count">
                    {item.followers_count}
                    {" "}
                    followers
                  </span>
                )}
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
