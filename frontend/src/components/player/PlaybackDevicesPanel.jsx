import Icon from
  "../ui/Icon.jsx";


function PlaybackDevicesPanel({
  devices = [],
  currentDeviceId,
  controlledDeviceId,
  onSelectDevice,
  onTransferToDevice,
}) {
  const sortedDevices =
    [...devices].sort(
      (left, right) => {
        if (
          left.is_active !==
          right.is_active
        ) {
          return left.is_active
            ? -1
            : 1;
        }

        if (
          left.is_online !==
          right.is_online
        ) {
          return left.is_online
            ? -1
            : 1;
        }

        return String(
          left.name,
        ).localeCompare(
          String(
            right.name,
          ),
        );
      },
    );

  const selected =
    sortedDevices.find(
      (device) =>
        device.device_id ===
        controlledDeviceId,
    ) ??
    null;

  return (
    <div
      className="playback-devices-panel"
      role="region"
      aria-label="Playback devices"
    >
      <div className="playback-devices-panel__heading">
        <span>
          HYPERSYNC CONNECT
        </span>

        <strong>
          Control another device
        </strong>

        <small>
          Devices signed in to this account appear here.
        </small>
      </div>

      <div className="playback-devices-panel__list">
        {sortedDevices.length ===
        0 ? (
          <div className="playback-device-empty">
            <Icon
              name="devices"
              size={20}
            />

            <span>
              No other active devices yet.
            </span>
          </div>
        ) : (
          sortedDevices.map(
            (device) => {
              const isCurrent =
                device.device_id ===
                currentDeviceId;

              const isSelected =
                device.device_id ===
                controlledDeviceId;

              return (
                <div
                  className={[
                    "playback-device-row",
                    isSelected
                      ? "is-selected"
                      : "",
                    device.is_active
                      ? "is-active"
                      : "",
                    !device.is_online
                      ? "is-offline"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={
                    device.device_id
                  }
                >
                  <button
                    type="button"
                    className="playback-device-row__main"
                    disabled={
                      !device.is_online
                    }
                    onClick={() => {
                      onSelectDevice?.(
                        device.device_id,
                      );
                    }}
                  >
                    <Icon
                      name={
                        device.device_type ===
                          "mobile"
                          ? "phone"
                          : "devices"
                      }
                      size={18}
                    />

                    <span>
                      <strong>
                        {device.name}
                      </strong>

                      <small>
                        {isCurrent
                          ? "This device"
                          : device.is_online
                            ? "Online"
                            : "Offline"}

                        {device.is_active
                          ? " • Playing here"
                          : ""}
                      </small>
                    </span>

                    {isSelected ? (
                      <Icon
                        name="check"
                        size={15}
                      />
                    ) : null}
                  </button>

                  {device.is_online &&
                  !device.is_active ? (
                    <button
                      type="button"
                      className="playback-device-row__transfer"
                      onClick={() => {
                        onSelectDevice?.(
                          device.device_id,
                        );

                        onTransferToDevice?.(
                          device.device_id,
                        );
                      }}
                    >
                      Play here
                    </button>
                  ) : null}
                </div>
              );
            },
          )
        )}
      </div>

      {selected ? (
        <div className="playback-devices-panel__target">
          <i
            className={
              selected.is_online
                ? "is-online"
                : ""
            }
          />

          <span>
            Controls target:
            {" "}
            <strong>
              {selected.name}
            </strong>
          </span>
        </div>
      ) : null}
    </div>
  );
}


export default PlaybackDevicesPanel;
