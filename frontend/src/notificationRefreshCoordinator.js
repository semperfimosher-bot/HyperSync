/**
 * Coordinates notification refreshes per registered account.
 *
 * A shared promise is safe only for the account that started it. Switching
 * accounts or logging out invalidates the prior generation so late responses
 * cannot overwrite the next account's notification snapshot.
 */
export function createOwnerScopedRequestCoordinator() {
  let activeOwner = null;
  let generation = 0;
  let inFlight = null;

  function setOwner(nextOwner) {
    const normalizedOwner =
      nextOwner == null ? null : String(nextOwner);

    if (normalizedOwner === activeOwner) {
      return;
    }

    activeOwner = normalizedOwner;
    generation += 1;
    inFlight = null;
  }

  function run(owner, request) {
    const normalizedOwner =
      owner == null ? null : String(owner);

    setOwner(normalizedOwner);

    if (normalizedOwner === null) {
      return Promise.resolve({ current: false });
    }

    if (inFlight?.owner === normalizedOwner) {
      return inFlight.promise;
    }

    const requestGeneration = generation;
    const entry = {
      owner: normalizedOwner,
      generation: requestGeneration,
      promise: null,
    };

    entry.promise = Promise.resolve()
      .then(request)
      .then(
        (value) => ({
          current:
            activeOwner === normalizedOwner &&
            generation === requestGeneration,
          value,
        }),
        (error) => ({
          current:
            activeOwner === normalizedOwner &&
            generation === requestGeneration,
          error,
        }),
      )
      .finally(() => {
        if (inFlight === entry) {
          inFlight = null;
        }
      });

    inFlight = entry;
    return entry.promise;
  }

  return {
    setOwner,
    run,
  };
}
