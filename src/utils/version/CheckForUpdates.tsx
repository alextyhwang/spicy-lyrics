import { toast } from "sonner";
import { PerformanceForkReleases } from "../../../project/config.ts";

/** The standalone fork is updated explicitly from a reviewed GitHub release. */
export async function CheckForUpdates(force = false) {
  if (force) window.open(PerformanceForkReleases, "_blank", "noopener,noreferrer");
}

export function triggerSpicyLyricsFakeUpdate(options: { updateTo: string }) {
  toast(`Performance fork preview: ${options.updateTo}`, {
    description: "Install reviewed updates from the fork's GitHub releases.",
    action: { label: "Releases", onClick: () => window.open(PerformanceForkReleases, "_blank", "noopener,noreferrer") },
  });
}
