import {
  useEffect,
  useState,
} from "react";


export default function useOnlineStatus() {
  const [
    online,
    setOnline,
  ] = useState(
    () =>
      typeof navigator ===
        "undefined"
        ? true
        : navigator.onLine,
  );

  useEffect(() => {
    const sync = () => {
      setOnline(
        navigator.onLine,
      );
    };

    window.addEventListener(
      "online",
      sync,
    );

    window.addEventListener(
      "offline",
      sync,
    );

    return () => {
      window.removeEventListener(
        "online",
        sync,
      );

      window.removeEventListener(
        "offline",
        sync,
      );
    };
  }, []);

  return online;
}
