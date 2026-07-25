import { useEffect, useState } from "react";

// Matches the shell's mobile breakpoint (see styles/app.css — @media max-width: 899px).
export function useIsMobile(): boolean {
  const query = "(max-width: 899px)";
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}
