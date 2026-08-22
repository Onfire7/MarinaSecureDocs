import { promptInstall, useCanInstall } from "../lib/pwaInstall";

/**
 * Renders nothing until the browser has actually offered an install prompt —
 * so it stays out of the way on browsers that can't install (Firefox, iOS
 * Safari), and disappears once the app is installed. Deploys are the team's
 * only distribution channel, so this is the whole "get the app" path.
 */
export function InstallAppButton({ className = "btn btn-sm" }: { className?: string }) {
  const canInstall = useCanInstall();
  if (!canInstall) return null;
  return (
    <button type="button" className={className} onClick={() => void promptInstall()}>
      Install app
    </button>
  );
}
