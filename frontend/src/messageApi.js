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
          body,
        }),
    },
  );
}


export async function getMessageNotifications() {
  return apiRequest(
    "/messages/notifications",
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
