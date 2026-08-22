import Icon from "./Icon.jsx";


export default function SectionHeading({
  title,
  actionLabel,
  onAction,
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>

      {actionLabel ? (
        <button
          type="button"
          onClick={onAction}
        >
          {actionLabel}

          <Icon
            name="chevron"
            size={14}
          />
        </button>
      ) : null}
    </div>
  );
}
