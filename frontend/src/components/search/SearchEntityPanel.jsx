export default function SearchEntityPanel({
  eyebrow,
  title,
  count,
  modifier,
  children,
}) {
  return (
    <section
      className={
        "hs-search-section " +
        "hs-search-discovery-panel " +
        modifier
      }
    >
      <div className="hs-search-section__heading">
        <div>
          <span>{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <strong>{count}</strong>
      </div>
      <div className="hs-search-entity-grid">
        {children}
      </div>
    </section>
  );
}
