import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      // This branch can run before a client-only route has hydrated. Load the
      // sign-in document so its HTML matches its initial route, and keep the
      // requested record/queue as the destination after authentication.
      throw redirect({
        to: "/auth",
        search: { redirect: location.href, mode: "signin" },
        reloadDocument: true,
      });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
