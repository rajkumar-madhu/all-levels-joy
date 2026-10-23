export async function requireSecurityStaff(
  check: () => PromiseLike<{ data: boolean | null; error: unknown }>,
) {
  const result = await check();
  if (result.error || result.data !== true) {
    throw new Error("The Security workspace is available to workspace staff only.");
  }
}
