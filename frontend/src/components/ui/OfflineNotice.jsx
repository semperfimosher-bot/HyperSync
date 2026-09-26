import Icon from "./Icon.jsx";


export default function OfflineNotice({
  title = "Go back online to see this",
  description = "This information is synced from HyperSynced and needs an internet connection.",
  compact = false,
}) {
  return (
    <div
      className={
        compact
          ? "hs-offline-notice hs-offline-notice--compact"
          : "hs-offline-notice"
      }
      role="status"
    >
      <span className="hs-offline-notice__icon">
        <Icon
          name="devices"
          size={20}
        />
      </span>

      <div>
        <strong>
          {title}
        </strong>

        <p>
          {description}
        </p>
      </div>
    </div>
  );
}
