import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  getMessageNotifications,
  markAdminAccountNotificationRead,
  markAdminNotificationRead,
  markMessageNotificationRead,
} from "../messageApi.js";

import {
  enablePushNotifications,
  syncExistingPushSubscription,
} from "../pushNotifications.js";

import {
  emptyNotificationSnapshot,
  removeNotificationFromSnapshot,
} from "../messageNotifications.js";

import {
  getOwnedNotificationSnapshot,
  getOwnedValue,
  updateOwnedNotificationSnapshot,
} from "../ownedNotificationState.js";

import {
  createOwnerScopedRequestCoordinator,
} from "../notificationRefreshCoordinator.js";


export default function useMessageNotifications({
  currentUser,
  onRequireSignIn,
  onStatusMessage,
}) {
  const currentNotificationOwnerId =
    currentUser?.account_type === "registered" &&
    currentUser?.id != null
      ? String(currentUser.id)
      : null;

  const [
    ownedNotificationState,
    setOwnedNotificationState,
  ] = useState(
    () => ({
      ownerId: null,
      snapshot: emptyNotificationSnapshot(),
    }),
  );

  // Derive visible data during render so an account switch never flashes
  // the previous account's notification snapshot while the new fetch is pending.
  const messageNotifications = getOwnedNotificationSnapshot(
    ownedNotificationState,
    currentNotificationOwnerId,
  );

  const [
    notificationDetailState,
    setNotificationDetailState,
  ] = useState(null);

  const notificationDetail = getOwnedValue(
    notificationDetailState,
    currentNotificationOwnerId,
  );

  const [
    pushBusy,
    setPushBusy,
  ] = useState(false);

  const [
    pushEnabled,
    setPushEnabled,
  ] = useState(false);

  // The ref identifies the current render's owner even inside older async callbacks.
  const activeNotificationOwnerRef = useRef(null);
  activeNotificationOwnerRef.current = currentNotificationOwnerId;

  // Share refreshes only within one account and discard results from prior sessions.
  const notificationRefreshCoordinatorRef = useRef(null);
  if (!notificationRefreshCoordinatorRef.current) {
    notificationRefreshCoordinatorRef.current =
      createOwnerScopedRequestCoordinator();
  }


  const resetMessageNotifications =
    useCallback(
      () => {
        notificationRefreshCoordinatorRef.current.setOwner(null);
        setOwnedNotificationState({
          ownerId: null,
          snapshot: emptyNotificationSnapshot(),
        });

        setNotificationDetailState(null);

        setPushEnabled(
          false,
        );
      },
      [],
    );


  const refreshMessageNotifications =
    useCallback(
      async () => {
        const ownerId =
          currentUser?.account_type === "registered" &&
          currentUser?.id != null
            ? String(currentUser.id)
            : null;

        if (
          ownerId === null ||
          globalThis.navigator?.onLine === false
        ) {
          if (ownerId === null) {
            notificationRefreshCoordinatorRef.current.setOwner(null);
            setOwnedNotificationState({
              ownerId: null,
              snapshot: emptyNotificationSnapshot(),
            });
          }

          return;
        }

        const outcome =
          await notificationRefreshCoordinatorRef.current.run(
            ownerId,
            getMessageNotifications,
            () => activeNotificationOwnerRef.current === ownerId,
          );

        // A request that finishes after logout/account switch must not mutate
        // the notification state belonging to the new session.
        if (!outcome?.current || outcome.error) {
          return;
        }

        const result = outcome.value;
        setOwnedNotificationState({
          ownerId,
          snapshot: {
            unread_count:
              Number(result?.unread_count ?? 0) || 0,
            notifications:
              Array.isArray(result?.notifications)
                ? result.notifications
                : [],
          },
        });
      },
      [
        currentUser?.account_type,
        currentUser?.id,
      ],
    );

  const consumeNotification =
    useCallback(
      async (
        notification,
      ) => {
        const ownerId = currentNotificationOwnerId;
        if (!notification || ownerId === null) {
          return;
        }

        setOwnedNotificationState((current) =>
          updateOwnedNotificationSnapshot(
            current,
            ownerId,
            (snapshot) =>
              removeNotificationFromSnapshot(
                snapshot,
                notification,
              ),
          ),
        );

        try {
          if (
            notification.type ===
              "admin_activity"
          ) {
            await markAdminNotificationRead(
              notification
                .notification_id,
            );
          } else if (
            notification.type ===
              "admin_account_notification"
          ) {
            await markAdminAccountNotificationRead(
              notification
                .notification_id,
            );
          } else {
            await markMessageNotificationRead(
              notification
                .message_id,
            );
          }
        } catch {
          // Refresh restores the item if the
          // server-side dismissal failed.
        } finally {
          await refreshMessageNotifications();
        }
      },
      [
        currentNotificationOwnerId,
        refreshMessageNotifications,
      ],
    );


  const openNotificationDetail =
    useCallback(
      (
        notification,
      ) => {
        const ownerId = currentNotificationOwnerId;
        if (!notification || ownerId === null) {
          return;
        }

        setNotificationDetailState({
          ownerId,
          value: notification,
        });

        void consumeNotification(
          notification,
        );
      },
      [
        currentNotificationOwnerId,
        consumeNotification,
      ],
    );


  const closeNotificationDetail =
    useCallback(
      () => {
        setNotificationDetailState(null);
      },
      [],
    );


  const deleteNotification =
    useCallback(
      (
        notification,
      ) => {
        if (!notification) {
          return;
        }

        void consumeNotification(
          notification,
        );
      },
      [
        consumeNotification,
      ],
    );


  const handleEnablePush =
    useCallback(
      async () => {
        if (
          currentUser?.account_type !==
            "registered"
        ) {
          onRequireSignIn?.();
          return;
        }

        setPushBusy(
          true,
        );

        try {
          const result =
            await enablePushNotifications();

          if (
            activeNotificationOwnerRef.current !==
              currentNotificationOwnerId
          ) {
            return;
          }

          if (
            !result?.supported
          ) {
            setPushEnabled(
              false,
            );

            onStatusMessage?.(
              "Push notifications are not supported by this browser.",
            );

            return;
          }

          if (
            result?.configured ===
              false
          ) {
            setPushEnabled(
              false,
            );

            onStatusMessage?.(
              "Push notifications need VAPID keys configured on the server.",
            );

            return;
          }

          if (
            !result?.enabled
          ) {
            setPushEnabled(
              false,
            );

            onStatusMessage?.(
              result?.permission ===
                "denied"
                ? "Push notifications are blocked in this browser's site settings."
                : "Push notification permission was not granted.",
            );

            return;
          }

          setPushEnabled(
            true,
          );

          onStatusMessage?.(
            "Push notifications enabled.",
          );
        } catch (error) {
          setPushEnabled(
            false,
          );

          onStatusMessage?.(
            error instanceof Error
              ? error.message
              : "Unable to enable push notifications.",
          );
        } finally {
          setPushBusy(
            false,
          );
        }
      },
      [
        currentNotificationOwnerId,
        currentUser?.account_type,
        onRequireSignIn,
        onStatusMessage,
      ],
    );


  useEffect(() => {
    if (
      currentUser?.account_type !==
        "registered"
    ) {
      resetMessageNotifications();
      return undefined;
    }

    void refreshMessageNotifications();

    void syncExistingPushSubscription()
      .then(
        (result) => {
          if (
            activeNotificationOwnerRef.current !==
              currentNotificationOwnerId
          ) {
            return;
          }

          setPushEnabled(
            Boolean(
              result?.enabled,
            ),
          );
        },
      )
      .catch(
        () => {
          if (
            activeNotificationOwnerRef.current ===
              currentNotificationOwnerId
          ) {
            setPushEnabled(false);
          }
        },
      );

    // Poll only while this tab is visible. Focus/visibility events below
    // refresh immediately when the user returns, without background churn.
    const interval =
      window.setInterval(
        () => {
          if (
            document.visibilityState ===
              "visible"
          ) {
            void refreshMessageNotifications();
          }
        },
        60_000,
      );

    const handleFocus =
      () => {
        void refreshMessageNotifications();
      };

    const handleVisibility =
      () => {
        if (
          document.visibilityState ===
            "visible"
        ) {
          void refreshMessageNotifications();
        }
      };

    window.addEventListener(
      "focus",
      handleFocus,
    );

    document.addEventListener(
      "visibilitychange",
      handleVisibility,
    );

    return () => {
      window.clearInterval(
        interval,
      );

      window.removeEventListener(
        "focus",
        handleFocus,
      );

      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );

      notificationRefreshCoordinatorRef.current.setOwner(null);
    };
  }, [
    currentUser
      ?.account_type,
    currentUser?.id,
    refreshMessageNotifications,
    resetMessageNotifications,
  ]);


  return {
    messageNotifications,
    notificationDetail,
    pushBusy,
    pushEnabled,
    refreshMessageNotifications,
    openNotificationDetail,
    closeNotificationDetail,
    deleteNotification,
    handleEnablePush,
    resetMessageNotifications,
  };
}
