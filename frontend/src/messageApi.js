import {
  apiRequest,
} from "./api/client.js";


export async function getConversations() {
  return apiRequest(
    "/messages/conversations",
  );
}


export async function getConversation(
  username,
) {
  return apiRequest(
    "/messages/conversations/" +
      encodeURIComponent(
        username,
      ),
  );
}


export async function sendMessage(
  username,
  body,
  sharedMusic = null,
) {
  return apiRequest(
    "/messages/conversations/" +
      encodeURIComponent(
        username,
      ),
    {
      method:
        "POST",
      body:
        JSON.stringify({
          body:
            body ?? "",
          shared_music:
            sharedMusic,
        }),
    },
  );
}


export async function deleteMessage(
  messageId,
) {
  return apiRequest(
    "/messages/messages/" +
      encodeURIComponent(
        messageId,
      ),
    {
      method:
        "DELETE",
    },
  );
}


export async function getMessageNotifications() {
  return apiRequest(
    "/messages/notifications",
  );
}


export async function markMessageNotificationRead(
  messageId,
) {
  return apiRequest(
    "/messages/notifications/messages/" +
      encodeURIComponent(
        messageId,
      ) +
      "/read",
    {
      method:
        "POST",
    },
  );
}


export async function markAdminNotificationRead(
  notificationId,
) {
  return apiRequest(
    "/messages/admin-notifications/" +
      encodeURIComponent(
        notificationId,
      ) +
      "/read",
    {
      method:
        "POST",
    },
  );
}


export async function getPushConfig() {
  return apiRequest(
    "/messages/push/config",
  );
}


export async function savePushSubscription(
  subscription,
) {
  return apiRequest(
    "/messages/push/subscriptions",
    {
      method:
        "POST",
      body:
        JSON.stringify(
          subscription,
        ),
    },
  );
}


export async function deletePushSubscription(
  endpoint,
) {
  return apiRequest(
    "/messages/push/subscriptions",
    {
      method:
        "DELETE",
      body:
        JSON.stringify({
          endpoint,
        }),
    },
  );
}
