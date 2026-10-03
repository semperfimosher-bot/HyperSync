import {
  useCallback,
  useEffect,
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


export default function useMessageNotifications({
  currentUser,
  onRequireSignIn,
  onStatusMessage,
}) {
  const [
    messageNotifications,
    setMessageNotifications,
  ] = useState(
    () =>
      emptyNotificationSnapshot(),
  );

  const [
    notificationDetail,
    setNotificationDetail,
  ] = useState(null);

  const [
    pushBusy,
    setPushBusy,
  ] = useState(false);

  const [
    pushEnabled,
    setPushEnabled,
  ] = useState(false);


  const resetMessageNotifications =
    useCallback(
      () => {
        setMessageNotifications(
          emptyNotificationSnapshot(),
        );

        setNotificationDetail(
          null,
        );

        setPushEnabled(
          false,
        );
      },
      [],
    );


  const refreshMessageNotifications =
    useCallback(
      async () => {
        if (
          currentUser?.account_type !==
            "registered" ||
          globalThis.navigator
            ?.onLine ===
            false
        ) {
          setMessageNotifications(
            emptyNotificationSnapshot(),
          );

          return;
        }

        try {
          const result =
            await getMessageNotifications();

          setMessageNotifications({
            unread_count:
              Number(
                result
                  ?.unread_count ??
                  0,
              ) || 0,
            notifications:
              Array.isArray(
                result
                  ?.notifications,
              )
                ? result.notifications
                : [],
          });
        } catch {
          // Keep the current snapshot during a
          // temporary network or API failure.
        }
      },
      [
        currentUser
          ?.account_type,
        currentUser?.id,
      ],
    );


  const consumeNotification =
    useCallback(
      async (
        notification,
      ) => {
        if (!notification) {
          return;
        }

        setMessageNotifications(
          (current) =>
            removeNotificationFromSnapshot(
              current,
              notification,
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
        refreshMessageNotifications,
      ],
    );


  const openNotificationDetail =
    useCallback(
      (
        notification,
      ) => {
        if (!notification) {
          return;
        }

        setNotificationDetail(
          notification,
        );

        void consumeNotification(
          notification,
        );
      },
      [
        consumeNotification,
      ],
    );


  const closeNotificationDetail =
    useCallback(
      () => {
        setNotificationDetail(
          null,
        );
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
        currentUser
          ?.account_type,
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
          setPushEnabled(
            Boolean(
              result?.enabled,
            ),
          );
        },
      )
      .catch(
        () => {
          setPushEnabled(
            false,
          );
        },
      );

    const interval =
      window.setInterval(
        () => {
          void refreshMessageNotifications();
        },
        30_000,
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
