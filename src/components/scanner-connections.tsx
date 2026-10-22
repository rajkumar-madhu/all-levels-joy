import { useQuery } from "@tanstack/react-query";
import { Copy, RefreshCw, Download, Radar } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getScannerConnection } from "@/lib/security.functions";
import { formatDateTime } from "@/lib/itsm-shared";

type ScannerFinding = {
  scanner_name: string | null;
  source: string;
  last_seen_at: string;
  state: string;
};
const endpoint = "https://all-levels-joy.lovable.app/api/public/security-findings";

export function ScannerConnections({
  findings,
  onRefresh,
}: {
  findings: ScannerFinding[];
  onRefresh: () => Promise<void>;
}) {
  const connection = useQuery({
    queryKey: ["scanner-connection"],
    queryFn: () => getScannerConnection(),
  });
  const scanners = new Map<string, { count: number; lastSeen: string }>();
  for (const f of findings) {
    if (f.source !== "scanner" || !f.scanner_name) continue;
    const previous = scanners.get(f.scanner_name);
    scanners.set(f.scanner_name, {
      count: (previous?.count ?? 0) + 1,
      lastSeen: previous && previous.lastSeen > f.last_seen_at ? previous.lastSeen : f.last_seen_at,
    });
  }
  const download = () => {
    const example = {
      findings: [
        {
          scanner: "your-scanner",
          reference: "CVE-or-control-ID",
          asset: "hostname-or-asset-key",
          title: "Finding title",
          description: "Scanner evidence and affected version",
          severity: "high",
          impactAssessment: "Impact assessment",
          fixPlan: "Recommended remediation",
          testPlan: "Validation checks",
          rollbackPlan: "Restore the previous version",
          rollbackTrigger: "Validation fails",
        },
      ],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(example, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "scanner-payload-example.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="mt-4 border-y border-border py-4" aria-label="Scanner connections">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Radar className="size-4" />
          Scanner connections
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void onRefresh();
            void connection.refetch();
          }}
        >
          <RefreshCw className="mr-2 size-4" />
          Refresh
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground" role="status">
        {connection.isPending
          ? "Checking connection…"
          : connection.isError
            ? "Connection status unavailable"
            : connection.data?.configured
              ? "Signing secret configured"
              : "Awaiting scanner signing secret"}
      </p>
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
        <code className="min-w-0 break-all text-xs text-muted-foreground">POST {endpoint}</code>
        <Button
          size="icon"
          variant="ghost"
          title="Copy scanner endpoint"
          aria-label="Copy scanner endpoint"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(endpoint);
              toast.success("Scanner endpoint copied.");
            } catch {
              toast.error("Could not copy the endpoint.");
            }
          }}
        >
          <Copy className="size-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={download}>
          <Download className="mr-2 size-4" />
          Payload example
        </Button>
      </div>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-medium">Signature header</dt>
          <dd className="mt-1 break-all text-muted-foreground">
            x-argus-signature: sha256=&lt;hex HMAC-SHA256 of the exact JSON body&gt;
          </dd>
        </div>
        <div>
          <dt className="font-medium">Optional workspace references</dt>
          <dd className="mt-1 text-muted-foreground">serviceId, ownerId, affectedCiIds (UUIDs)</dd>
        </div>
      </dl>
      {scanners.size ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="pb-2">Scanner</th>
                <th className="pb-2">Findings</th>
                <th className="pb-2">Last received</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(scanners, ([name, s]) => (
                <tr key={name} className="border-b border-border">
                  <td className="py-2">{name}</td>
                  <td>{s.count}</td>
                  <td className="whitespace-nowrap">{formatDateTime(s.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No scanner findings received.</p>
      )}
    </section>
  );
}
