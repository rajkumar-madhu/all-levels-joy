import { Link } from "react-router";
import { PageHeader } from "@/components/ui";

export function NotFoundPage() {
  return (
    <div className="grid gap-3">
      <PageHeader title="Page not found" description="The link may be old, or the record may not be visible to you." />
      <Link className="text-sm text-brand-600 underline" to="/">
        Go to the dashboard
      </Link>
    </div>
  );
}
