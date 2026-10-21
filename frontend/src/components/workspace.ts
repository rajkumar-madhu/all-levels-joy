import { useActiveWorkspace } from "@/api/hooks";
import type { Workspace } from "@/api/types";

/** The active workspace. Pages render only inside RequireWorkspace, which guarantees there is one. */
export function useWorkspace(): Workspace {
  const workspace = useActiveWorkspace();
  if (!workspace) throw new Error("useWorkspace used outside RequireWorkspace");
  return workspace;
}
