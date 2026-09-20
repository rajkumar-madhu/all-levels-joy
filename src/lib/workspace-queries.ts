import { queryOptions } from "@tanstack/react-query";
import {
  getWorkspace,
  getReferenceData,
  getRecordActivity,
  getIncidentMetrics,
} from "@/lib/itsm.functions";
import { getProblemBoard, getCommandCenter } from "@/lib/problem.functions";

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

export const incidentMetricsQuery = () =>
  queryOptions({
    queryKey: ["incident-metrics"],
    queryFn: () => getIncidentMetrics(),
    staleTime: 30_000,
  });

export type IncidentMetrics = Awaited<ReturnType<typeof getIncidentMetrics>>;

export const problemBoardQuery = () =>
  queryOptions({
    queryKey: ["problem-board"],
    queryFn: () => getProblemBoard(),
    staleTime: 15_000,
  });

export const commandCenterQuery = () =>
  queryOptions({
    queryKey: ["command-center"],
    queryFn: () => getCommandCenter(),
    staleTime: 10_000,
  });

export type ProblemBoard = Awaited<ReturnType<typeof getProblemBoard>>;
export type CommandCenter = Awaited<ReturnType<typeof getCommandCenter>>;
