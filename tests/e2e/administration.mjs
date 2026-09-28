import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export async function verifyAdministration({
  browser,
  baseURL,
  actors,
  sql,
  org,
  artifacts,
  check,
  waitFor,
  runId,
  authAdmin,
  authURL,
  anonKey,
}) {
  assert.equal(new URL(authURL).hostname, "127.0.0.1", "Admin E2E only uses local Auth");
  const pages = [];
  const contexts = [];
  const pageErrors = [];
  const escapedRequests = [];
  const diagnostics = [];
  const ok = (result) => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  const denied = (result, message) => assert.ok(result.error, message);
  const membership = async (id) =>
    (await sql`select * from memberships where user_id=${id} and organization_id=${org}`)[0];
  const roles = async (id) =>
    (
      await sql`select role from user_roles where user_id=${id} and organization_id=${org} order by role::text`
    ).map((row) => row.role);
  const createActor = async (name, email = `${name}-${runId}@itsm-e2e.invalid`) => {
    const password = `${randomBytes(18).toString("base64url")}Aa1!`;
    const displayName = `E2E ${name} ${runId}`;
    const created = ok(
      await authAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      }),
    );
    const client = createClient(authURL, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    ok(await client.auth.signInWithPassword({ email, password }));
    return { id: created.user.id, email, password, displayName, client };
  };
  const login = async (
    actor,
    destination = "/administration",
    mobile = false,
    label = actor.displayName || actor.email,
  ) => {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 },
    });
    contexts.push(context);
    await context.route("**/*", async (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host.endsWith("supabase.co")) {
        escapedRequests.push(host);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.push(message.text());
    });
    pages.push({ label, page });
    await page.goto(`${baseURL}${destination}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => url.pathname === "/auth");
    await page.waitForLoadState("networkidle");
    const redirect = new URL(new URL(page.url()).searchParams.get("redirect"), baseURL);
    const requested = new URL(destination, baseURL);
    assert.equal(redirect.pathname, requested.pathname);
    assert.equal(
      redirect.searchParams.get("invitation"),
      requested.searchParams.get("invitation"),
      "Sign-in preserves invitation identity",
    );
    await page.getByLabel("Work email", { exact: true }).fill(actor.email);
    await page.getByLabel("Password", { exact: true }).fill(actor.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname === requested.pathname);
    return page;
  };
  const membersTab = async (page) => {
    await page.getByRole("tab", { name: /^Members/ }).click();
    await page.getByRole("heading", { name: "Workspace members", exact: true }).waitFor();
  };
  const editMember = async (page, actor) => {
    await membersTab(page);
    await page.getByLabel("Search members", { exact: true }).fill(actor.email);
    await page
      .getByRole("button", { name: `Manage access for ${actor.displayName}`, exact: true })
      .click();
    return page.getByRole("dialog", { name: "Manage member access", exact: true });
  };
  const confirmAccess = async (page) => {
    await page.getByRole("button", { name: "Review access changes", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Confirm access changes",
      exact: true,
    });
    await confirmation.getByRole("button", { name: "Confirm access changes", exact: true }).click();
    return confirmation;
  };
  const cancelAccess = async (page) => {
    await page.getByRole("button", { name: "Back to editing", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Manage member access", exact: true })
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
  };
  const createInvitation = async (page, email, operatorRole = false) => {
    await page.getByRole("tab", { name: "Invitations", exact: true }).click();
    await page.getByRole("button", { name: "Invite member", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Invite a workspace member", exact: true });
    await dialog.getByLabel("Work email", { exact: true }).fill(email);
    if (operatorRole) await dialog.getByRole("checkbox", { name: /^Service desk/ }).check();
    await dialog.getByRole("button", { name: "Create invitation", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    const link = await page.getByLabel("Invitation link", { exact: true }).inputValue();
    assert.equal(new URL(link).origin, baseURL);
    await page
      .getByText("Share this link with the invited person. An email has not been sent.", {
        exact: true,
      })
      .waitFor();
    return new URL(link).searchParams.get("invitation");
  };
  try {
    // Adding an active administrator earlier would change the core approval suite's
    // intended approver counts. This module therefore runs after those workflows.
    const owner = await createActor("administrator");
    await sql`insert into profiles(id,display_name) values(${owner.id},${owner.displayName})`;
    await sql`insert into memberships(organization_id,user_id,is_active) values(${org},${owner.id},true)`;
    for (const role of ["requester", "admin"])
      await sql`insert into user_roles(organization_id,user_id,role) values(${org},${owner.id},${role})`;
    assert.equal(
      (
        await sql`select count(*)::int n from user_roles r join memberships m on m.organization_id=r.organization_id and m.user_id=r.user_id where r.organization_id=${org} and r.role='admin' and m.is_active`
      )[0].n,
      1,
    );

    const requester = await login(actors.requester, "/administration", false, "requester-denied");
    await requester
      .getByRole("heading", { name: "Administrator access required", exact: true })
      .waitFor();
    assert.equal(
      await requester.getByRole("link", { name: "Administration", exact: true }).count(),
      0,
    );
    denied(
      await actors.requester.client.rpc("itsm_admin_overview", { _org_id: org }),
      "Requester cannot read administration overview",
    );
    denied(
      await actors.requester.client.rpc("itsm_admin_invite", {
        _org_id: org,
        _email: `forged-${runId}@itsm-e2e.invalid`,
        _roles: ["admin"],
      }),
      "Requester cannot grant admin roles through an invitation",
    );
    check("Administration is hidden and denied for non-admins in both browser and direct RPC");

    const adminPage = await login(owner, "/administration", false, "administrator");
    await adminPage.getByRole("heading", { name: "Workspace members", exact: true }).waitFor();
    await adminPage.getByRole("link", { name: "Administration", exact: true }).waitFor();
    await adminPage.getByText("Administrator · +1 role", { exact: true }).waitFor();
    const selfDialog = await editMember(adminPage, owner);
    await selfDialog.getByRole("checkbox", { name: /^Administrator/ }).uncheck();
    const selfConfirmation = await confirmAccess(adminPage);
    await selfConfirmation
      .getByRole("alert")
      .filter({
        hasText:
          /last active administrator|last administrator|at least one active (workspace )?administrator/i,
      })
      .waitFor();
    assert.ok((await roles(owner.id)).includes("admin"));
    assert.equal((await membership(owner.id)).is_active, true);
    await cancelAccess(adminPage);
    check("Last active administrator cannot remove their own administrative access");

    const invitedEmail = `invited-${runId}@itsm-e2e.invalid`;
    assert.equal(
      (await sql`select count(*)::int n from auth.users where email=${invitedEmail}`)[0].n,
      0,
    );
    const invitationId = await createInvitation(adminPage, invitedEmail, true);
    // This connection predates migrations, so its custom enum-array parser may
    // not exist yet. Decode through the built-in text array type deterministically.
    const issued = (
      await sql`select *, roles::text[] as roles from workspace_invitations where id=${invitationId}`
    )[0];
    assert.equal(issued.email, invitedEmail);
    assert.deepEqual([...issued.roles].sort(), ["requester", "service_desk"]);
    assert.ok(
      Math.abs((new Date(issued.expires_at) - new Date(issued.created_at)) / 86400000 - 7) < 0.001,
    );
    const wrongEmail = await login(
      actors.peer,
      `/accept-invitation?invitation=${invitationId}`,
      false,
      "wrong-invited-email",
    );
    await wrongEmail
      .getByRole("heading", { name: "Unable to open this invitation", exact: true })
      .waitFor();
    denied(
      await actors.peer.client.rpc("itsm_accept_invitation", { _invitation_id: invitationId }),
      "Wrong email must not accept invitation",
    );
    assert.equal(
      (await sql`select status from workspace_invitations where id=${invitationId}`)[0].status,
      "pending",
    );

    const invited = await createActor("invited", invitedEmail);
    assert.equal(await membership(invited.id), undefined);
    const invitedPage = await login(
      invited,
      `/accept-invitation?invitation=${invitationId}`,
      false,
      "invited-acceptance",
    );
    await invitedPage.getByRole("heading", { name: "Workspace invitation", exact: true }).waitFor();
    await invitedPage.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await invitedPage.waitForURL((url) => url.pathname === "/dashboard");
    await waitFor(
      async () => (await membership(invited.id))?.is_active === true,
      "invited membership created",
    );
    await waitFor(
      async () => (await sql`select id from profiles where id=${invited.id}`).length === 1,
      "accepted member profile bootstrapped",
    );
    invited.displayName = (
      await sql`select display_name from profiles where id=${invited.id}`
    )[0].display_name;
    assert.deepEqual(await roles(invited.id), ["requester", "service_desk"]);
    const accepted = (await sql`select * from workspace_invitations where id=${invitationId}`)[0];
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.accepted_by, invited.id);
    assert.ok(accepted.accepted_at);
    assert.ok(
      (
        await sql`select id from audit_events where record_type='workspace_invitation' and record_id=${invitationId} and actor_id=${invited.id} and after_values->>'status'='accepted'`
      ).length,
    );
    denied(
      await invited.client.rpc("itsm_accept_invitation", { _invitation_id: invitationId }),
      "Invitation replay must fail",
    );
    assert.equal(
      (
        await sql`select count(*)::int n from memberships where organization_id=${org} and user_id=${invited.id}`
      )[0].n,
      1,
    );
    check(
      "Invitation created before Auth account exists; verified invited user accepts via preserved sign-in link with exact roles and audit evidence; wrong email and replay denied",
    );

    await adminPage.reload();
    const staleDialog = await editMember(adminPage, invited);
    const originalVersion = (await membership(invited.id)).version;
    const secondAdmin = await login(owner, "/administration", false, "administrator-second-tab");
    const currentDialog = await editMember(secondAdmin, invited);
    await currentDialog.getByRole("checkbox", { name: /^Engineer/ }).check();
    const currentConfirmation = await confirmAccess(secondAdmin);
    await currentConfirmation.waitFor({ state: "detached" });
    await currentDialog.waitFor({ state: "detached" });
    assert.equal((await membership(invited.id)).version, originalVersion + 1);
    await staleDialog.getByRole("checkbox", { name: /^Manager/ }).check();
    const staleConfirmation = await confirmAccess(adminPage);
    await staleConfirmation
      .getByRole("alert")
      .filter({ hasText: /changed|refresh/i })
      .waitFor();
    assert.deepEqual(await roles(invited.id), ["fulfiller", "requester", "service_desk"]);
    await cancelAccess(adminPage);
    const recoveredDialog = await editMember(adminPage, invited);
    assert.equal(
      await recoveredDialog.getByRole("checkbox", { name: /^Engineer/ }).isChecked(),
      true,
      "Reopening a rejected stale edit loads the roles saved by the other administrator",
    );
    assert.equal(
      await recoveredDialog.getByRole("checkbox", { name: /^Manager/ }).isChecked(),
      false,
      "The rejected role change is not silently reapplied",
    );
    await recoveredDialog.getByRole("checkbox", { name: /^Manager/ }).check();
    const recoveredConfirmation = await confirmAccess(adminPage);
    await recoveredConfirmation.waitFor({ state: "detached" });
    await recoveredDialog.waitFor({ state: "detached" });
    assert.equal((await membership(invited.id)).version, originalVersion + 2);
    assert.deepEqual(await roles(invited.id), [
      "fulfiller",
      "manager",
      "requester",
      "service_desk",
    ]);
    check(
      "Stale member edits preserve concurrent changes; cancel and reopen loads current roles and permits an explicit retry without reloading",
    );

    await adminPage.reload();
    const deactivateDialog = await editMember(adminPage, invited);
    await deactivateDialog.getByRole("checkbox", { name: /^Active workspace access/ }).uncheck();
    const deactivateConfirmation = await confirmAccess(adminPage);
    await deactivateConfirmation.waitFor({ state: "detached" });
    await deactivateDialog.waitFor({ state: "detached" });
    assert.equal((await membership(invited.id)).is_active, false);
    await invitedPage.goto(`${baseURL}/incidents`);
    await invitedPage.reload();
    await invitedPage
      .getByRole("heading", { name: "Workspace access unavailable", exact: true })
      .waitFor();
    denied(
      await invited.client.rpc("bootstrap_workspace", { _display_name: invited.displayName }),
      "Deactivated invited account cannot bootstrap",
    );
    const reactivateDialog = await editMember(adminPage, invited);
    await reactivateDialog.getByRole("checkbox", { name: /^Active workspace access/ }).check();
    const reactivateConfirmation = await confirmAccess(adminPage);
    await reactivateConfirmation.waitFor({ state: "detached" });
    await reactivateDialog.waitFor({ state: "detached" });
    assert.equal((await membership(invited.id)).is_active, true);
    await invitedPage.reload();
    await invitedPage.getByRole("heading", { name: "Incident workspace", exact: true }).waitFor();
    check(
      "Administrator deactivation immediately blocks workspace access; explicit reactivation restores access",
    );

    const groupName = `E2E Network Support ${runId}`;
    await adminPage.getByRole("tab", { name: "Assignment groups", exact: true }).click();
    await adminPage.getByRole("button", { name: "Create group", exact: true }).click();
    let groupDialog = adminPage.getByRole("dialog", {
      name: "Create assignment group",
      exact: true,
    });
    await groupDialog.getByLabel("Group name", { exact: true }).fill(groupName);
    await groupDialog
      .getByLabel("Description", { exact: true })
      .fill("Local E2E service team and membership verification.");
    await groupDialog.getByLabel("Find an active member", { exact: true }).fill(invited.email);
    await groupDialog.getByRole("checkbox", { name: new RegExp(invited.displayName) }).check();
    await groupDialog.getByRole("button", { name: "Create group", exact: true }).click();
    await groupDialog.waitFor({ state: "detached" });
    const group = (
      await sql`select * from groups where organization_id=${org} and name=${groupName}`
    )[0];
    assert.ok(group?.is_active);
    assert.deepEqual(
      (await sql`select user_id from group_members where group_id=${group.id}`).map(
        (member) => member.user_id,
      ),
      [invited.id],
    );
    await adminPage.getByRole("button", { name: `Edit group ${groupName}`, exact: true }).click();
    groupDialog = adminPage.getByRole("dialog", { name: "Edit assignment group", exact: true });
    const updatedDescription = "Updated by another administrator while the group editor was open.";
    ok(
      await owner.client.rpc("itsm_admin_save_group", {
        _org_id: org,
        _group_id: group.id,
        _name: groupName,
        _description: updatedDescription,
        _is_active: true,
        _member_ids: [invited.id],
        _expected_version: group.version,
      }),
    );
    await groupDialog.getByRole("checkbox", { name: /^Active assignment group/ }).uncheck();
    await groupDialog.getByRole("button", { name: "Save group", exact: true }).click();
    await groupDialog
      .getByRole("alert")
      .filter({ hasText: /changed|refresh/i })
      .waitFor();
    await groupDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await adminPage.getByRole("button", { name: `Edit group ${groupName}`, exact: true }).click();
    assert.equal(
      await groupDialog.getByLabel("Description", { exact: true }).inputValue(),
      updatedDescription,
    );
    assert.equal(
      await groupDialog.getByRole("checkbox", { name: /^Active assignment group/ }).isChecked(),
      true,
    );
    await groupDialog.getByRole("checkbox", { name: /^Active assignment group/ }).uncheck();
    await groupDialog.getByRole("button", { name: "Save group", exact: true }).click();
    await groupDialog.waitFor({ state: "detached" });
    assert.equal(
      (await sql`select is_active from groups where id=${group.id}`)[0].is_active,
      false,
    );
    await waitFor(
      async () =>
        (await adminPage.getByRole("heading", { name: groupName, exact: true }).count()) === 0,
      "archived group hidden by default",
    );
    await adminPage.getByRole("checkbox", { name: "Include archived groups", exact: true }).check();
    await adminPage.getByRole("heading", { name: groupName, exact: true }).waitFor();
    const incident = (
      await sql`select id from incidents where organization_id=${org} order by created_at desc limit 1`
    )[0];
    await invitedPage.goto(`${baseURL}/incidents?record=${incident.id}`);
    await invitedPage.locator("#incident-group").waitFor();
    assert.equal(
      await invitedPage.locator(`#incident-group option[value="${group.id}"]`).isDisabled(),
      true,
      "Archived group cannot be selected for a new assignment",
    );
    await invitedPage.keyboard.press("Escape");
    check(
      "Assignment groups recover from stale edits, preserve concurrent changes and membership, and block new assignments after archival",
    );

    await adminPage.getByRole("tab", { name: "Workspace settings", exact: true }).click();
    await adminPage.getByRole("button", { name: "Edit workspace settings", exact: true }).click();
    const settings = adminPage.getByRole("dialog", {
      name: "Edit workspace settings",
      exact: true,
    });
    const updatedName = `E2E Service Workspace ${runId}`;
    const currentSettings = (await sql`select * from organizations where id=${org}`)[0];
    const concurrentName = `E2E Concurrent Workspace ${runId}`;
    ok(
      await owner.client.rpc("itsm_admin_update_workspace", {
        _org_id: org,
        _name: concurrentName,
        _timezone: "Europe/London",
        _expected_version: currentSettings.admin_version,
      }),
    );
    await settings.getByLabel("Workspace name", { exact: true }).fill(updatedName);
    await settings.getByRole("button", { name: "Save settings", exact: true }).click();
    await settings
      .getByRole("alert")
      .filter({ hasText: /changed|refresh/i })
      .waitFor();
    await settings.getByRole("button", { name: "Cancel", exact: true }).click();
    await adminPage.getByRole("button", { name: "Edit workspace settings", exact: true }).click();
    assert.equal(
      await settings.getByLabel("Workspace name", { exact: true }).inputValue(),
      concurrentName,
    );
    assert.equal(
      await settings.getByLabel("Default timezone", { exact: true }).inputValue(),
      "Europe/London",
    );
    await settings.getByLabel("Workspace name", { exact: true }).fill(updatedName);
    await settings.getByLabel("Default timezone", { exact: true }).fill("Asia/Kolkata");
    await settings.getByRole("button", { name: "Save settings", exact: true }).click();
    await settings.waitFor({ state: "detached" });
    const organization = (await sql`select name,timezone from organizations where id=${org}`)[0];
    assert.deepEqual(organization, { name: updatedName, timezone: "Asia/Kolkata" });
    await adminPage.getByRole("heading", { name: updatedName, exact: true }).waitFor();
    check(
      "Workspace settings recover from version conflicts and save the reviewed name and timezone without reloading",
    );

    const revokedEmail = `revoked-${runId}@itsm-e2e.invalid`;
    const revokedId = await createInvitation(adminPage, revokedEmail);
    await adminPage
      .getByRole("button", { name: `Revoke invitation for ${revokedEmail}`, exact: true })
      .click();
    const revokeDialog = adminPage.getByRole("alertdialog", {
      name: "Revoke invitation?",
      exact: true,
    });
    await revokeDialog.getByRole("button", { name: "Revoke invitation", exact: true }).click();
    await revokeDialog.waitFor({ state: "detached" });
    assert.equal(
      (await sql`select status from workspace_invitations where id=${revokedId}`)[0].status,
      "revoked",
    );
    const revokedActor = await createActor("revoked", revokedEmail);
    denied(
      await revokedActor.client.rpc("itsm_accept_invitation", { _invitation_id: revokedId }),
      "Revoked invitation cannot create a membership",
    );
    assert.equal(await membership(revokedActor.id), undefined);
    check("Invitation revocation requires confirmation and prevents later access grants");

    await membersTab(adminPage);
    await adminPage.getByLabel("Search members", { exact: true }).fill(invited.email);
    await adminPage.getByRole("heading", { name: invited.displayName, exact: true }).waitFor();
    await adminPage.screenshot({
      path: path.join(artifacts, "administration-desktop-members.png"),
      fullPage: true,
    });
    const mobile = await login(owner, "/administration", true, "administrator-mobile");
    await mobile.getByRole("heading", { name: "Workspace members", exact: true }).waitFor();
    assert.ok(
      await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      "390px members view has no document overflow",
    );
    await mobile.getByLabel("Search members", { exact: true }).fill(invited.email);
    await mobile.getByRole("heading", { name: invited.displayName, exact: true }).waitFor();
    await mobile.screenshot({
      path: path.join(artifacts, "administration-mobile-members.png"),
      fullPage: true,
    });
    await mobile.getByRole("tab", { name: "Invitations", exact: true }).click();
    await mobile.getByRole("heading", { name: "Workspace invitations", exact: true }).waitFor();
    assert.ok(
      await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      "390px invitations view has no document overflow",
    );
    await mobile.screenshot({
      path: path.join(artifacts, "administration-mobile-invitations.png"),
      fullPage: true,
    });
    await mobile.getByRole("button", { name: "Open navigation", exact: true }).click();
    await mobile
      .getByRole("dialog")
      .getByRole("link", { name: "Administration", exact: true })
      .waitFor();
    await mobile.screenshot({
      path: path.join(artifacts, "administration-mobile-navigation.png"),
      fullPage: true,
    });
    check(
      "Administration desktop and 390px mobile layouts, invitation list, and admin navigation render without document overflow",
    );
    assert.deepEqual(escapedRequests, [], "Administration tests cannot reach hosted Supabase");
    assert.deepEqual(pageErrors, [], "Administration has no uncaught browser exceptions");
    assert.deepEqual(
      diagnostics.filter((message) => /hydration|Minified React error #418/i.test(message)),
      [],
      "Administration navigation must not cause hydration errors",
    );
    check("Administration has no uncaught runtime/hydration errors and no hosted database traffic");
  } catch (error) {
    await writeFile(
      path.join(artifacts, "administration-browser-errors.json"),
      JSON.stringify({ pageErrors, escapedRequests, diagnostics }, null, 2),
    );
    for (const [index, { page }] of pages.entries()) {
      await page
        .screenshot({
          path: path.join(artifacts, `administration-failure-${index}.png`),
          fullPage: true,
        })
        .catch(() => {});
      await writeFile(
        path.join(artifacts, `administration-failure-${index}.txt`),
        (await page.locator("body").innerText()).slice(0, 20000),
      ).catch(() => {});
    }
    throw error;
  } finally {
    for (const context of contexts) await context.close();
  }
}
