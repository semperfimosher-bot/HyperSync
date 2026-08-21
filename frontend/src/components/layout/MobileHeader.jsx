import BrandLogo from "../ui/BrandLogo.jsx";
import Icon from "../ui/Icon.jsx";

function MobileHeader({
  title,
  onOpenAuth,
}) {
  return (
    <header className="mobile-header">
      <BrandLogo
        idPrefix="mobile-logo"
        compact
      />

      <h1>{title}</h1>

      <button
        className="icon-button"
        type="button"
        onClick={onOpenAuth}
        aria-label="Open account panel"
      >
        <Icon
          name="bell"
          size={18}
        />

        <span
          className="icon-button__dot"
          aria-hidden="true"
        />
      </button>
    </header>
  );
}

export default MobileHeader
