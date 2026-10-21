import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type Status = "loading" | "signed-out" | "signed-in";

type SessionState = {
  status: Status;
  accessToken: string | null;
  email: string | null;
  /** Workspace the user is working in; remembered per browser. */
  activeOrgId: string | null;
  setSignedIn: (token: string, email: string | null) => void;
  setSignedOut: () => void;
  setActiveOrg: (orgId: string) => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      status: "loading",
      accessToken: null,
      email: null,
      activeOrgId: null,
      setSignedIn: (accessToken, email) => set({ status: "signed-in", accessToken, email }),
      setSignedOut: () => set({ status: "signed-out", accessToken: null, email: null }),
      setActiveOrg: (activeOrgId) => set({ activeOrgId }),
    }),
    {
      name: "itsm-session",
      storage: createJSONStorage(() => localStorage),
      // Tokens stay in memory (oidc-client-ts keeps its own session copy); only the workspace choice persists.
      partialize: (state) => ({ activeOrgId: state.activeOrgId }),
    },
  ),
);
