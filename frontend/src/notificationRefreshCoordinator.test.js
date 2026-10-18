import assert from "node:assert/strict";
import test from "node:test";

import {
  createOwnerScopedRequestCoordinator,
} from "./notificationRefreshCoordinator.js";


function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}


test(
  "deduplicates concurrent refreshes for the same account",
  async () => {
    const coordinator = createOwnerScopedRequestCoordinator();
    const pending = deferred();
    let calls = 0;

    const first = coordinator.run("account-a", () => {
      calls += 1;
      return pending.promise;
    });
    const second = coordinator.run("account-a", () => {
      calls += 1;
      return Promise.resolve("unexpected second request");
    });

    assert.strictEqual(first, second);
    await Promise.resolve();
    assert.equal(calls, 1);

    pending.resolve({ unread_count: 2 });
    assert.deepEqual(await first, {
      current: true,
      value: { unread_count: 2 },
    });
  },
);


test(
  "does not reuse an old account request or accept its late result after switch",
  async () => {
    const coordinator = createOwnerScopedRequestCoordinator();
    const accountA = deferred();
    const accountB = deferred();

    const requestA = coordinator.run(
      "account-a",
      () => accountA.promise,
    );
    await Promise.resolve();

    const requestB = coordinator.run(
      "account-b",
      () => accountB.promise,
    );
    await Promise.resolve();

    accountA.resolve({ notifications: ["private-to-a"] });
    assert.deepEqual(await requestA, {
      current: false,
      value: { notifications: ["private-to-a"] },
    });

    accountB.resolve({ notifications: ["private-to-b"] });
    assert.deepEqual(await requestB, {
      current: true,
      value: { notifications: ["private-to-b"] },
    });
  },
);


test(
  "logout invalidates an in-flight notification refresh",
  async () => {
    const coordinator = createOwnerScopedRequestCoordinator();
    const pending = deferred();

    const request = coordinator.run(
      "account-a",
      () => pending.promise,
    );
    await Promise.resolve();

    coordinator.setOwner(null);
    pending.resolve({ notifications: ["private-to-a"] });

    assert.deepEqual(await request, {
      current: false,
      value: { notifications: ["private-to-a"] },
    });
  },
);


test(
  "reports current request errors without treating stale errors as current",
  async () => {
    const coordinator = createOwnerScopedRequestCoordinator();
    const pending = deferred();
    const request = coordinator.run("account-a", () => pending.promise);
    await Promise.resolve();

    const failure = new Error("temporary failure");
    pending.reject(failure);

    const result = await request;
    assert.equal(result.current, true);
    assert.strictEqual(result.error, failure);
  },
);


test(
  "a stale callback cannot reclaim ownership after the active account changes",
  async () => {
    const coordinator = createOwnerScopedRequestCoordinator();
    let activeOwner = "account-a";
    const staleRequest = deferred();

    const first = coordinator.run(
      "account-a",
      () => staleRequest.promise,
      () => activeOwner === "account-a",
    );
    await Promise.resolve();

    activeOwner = "account-b";

    const staleCallback = await coordinator.run(
      "account-a",
      () => {
        throw new Error("stale callback must not start a request");
      },
      () => activeOwner === "account-a",
    );
    assert.deepEqual(staleCallback, { current: false });

    coordinator.setOwner("account-b");
    staleRequest.resolve({ notifications: ["account-a"] });

    assert.deepEqual(await first, {
      current: false,
      value: { notifications: ["account-a"] },
    });
  },
);
