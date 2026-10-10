import { useEffect, useRef } from "react";
import { requestJamPanel } from "../../jamSessions.js";

export default function HomeContextMenu({ menu, onClose }) {
  const item = useRef(null);
  useEffect(() => {
    if (!menu) return;
    item.current?.focus();
    const close = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menu, onClose]);
  if (!menu) return null;
  const style = menu.mode === "desktop" ? {
    position: "fixed", maxWidth: "calc(100vw - 16px)", boxSizing: "border-box", left: Math.max(8, Math.min(menu.x || 8, window.innerWidth - 270)),
    top: Math.max(8, Math.min(menu.y || 8, window.innerHeight - 90)),
  } : { position: "fixed", left: 16, right: 16, bottom: 24, width: "auto", boxSizing: "border-box" };
  const openJam = () => {
    requestJamPanel();
    onClose();
  };

  return <div className="track-action-layer" onClick={onClose}>
    <div className="track-action-menu" role="menu" aria-label="Home actions" style={style} onClick={(event) => event.stopPropagation()}>
      <button ref={item} type="button" role="menuitem" onClick={openJam}>Jam</button>
    </div>
  </div>;
}
