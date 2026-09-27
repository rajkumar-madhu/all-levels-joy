// Keep component-fixture clicks isolated from real auth, mutations, and Supabase.
const unavailable = async () => {
  throw new Error("Backend actions are unavailable in this UI fixture.");
};
export const getWorkspace = unavailable;
export const bootstrapWorkspace = unavailable;
export const markNotificationsRead = unavailable;
export const searchRecords = unavailable;
export const getReferenceData = unavailable;
export const getRecordActivity = unavailable;
export const getIncidentMetrics = unavailable;
export const getProblemBoard = unavailable;
export const getCommandCenter = unavailable;
export const supabase = { auth: { signOut: unavailable } };
