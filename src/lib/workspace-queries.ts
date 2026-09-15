import { queryOptions } from "@tanstack/react-query";
import { getWorkspace, getReferenceData, getRecordActivity } from "@/lib/itsm.functions";

export const workspaceQuery = () =>
  queryOptions({
    queryKey: ["workspace"],
    queryFn: () => getWorkspace(),
    staleTime: 15_000,
  });

export const referenceQuery = () =>
  queryOptions({
    queryKey: ["reference"],
    queryFn: () => getReferenceData(),
    staleTime: 60_000,
  });

export const activityQuery = (recordType: string, recordId: string) =>
  queryOptions({
    queryKey: ["activity", recordType, recordId],
    queryFn: () => getRecordActivity({ data: { recordType, recordId } }),
  });

export type Workspace = Awaited<ReturnType<typeof getWorkspace>>;
export type ReferenceData = Awaited<ReturnType<typeof getReferenceData>>;
