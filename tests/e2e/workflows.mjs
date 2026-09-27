import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export async function verifyWorkflows({
  browser,
  baseURL,
  actors,
  sql,
  org,
  artifacts,
  check,
  waitFor,
  runId,
}) {
  const pages = [];
  const pageErrors = [];
  const escapedRequests = [];
  const diagnostics = [];
  const ok = (result) => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  const denied = (result) =>
    assert.ok(
      result.error || result.data?.length === 0,
      "Unauthorized request must fail or return no accessible rows",
    );
  const login = async (name, route = "/incidents", mobile = false) => {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 },
    });
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
    page.on("requestfailed", (request) =>
      diagnostics.push(
        `${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`,
      ),
    );
    pages.push({ name, page });
    await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => url.pathname === "/auth");
    await page.waitForLoadState("networkidle");
    const destination = new URL(new URL(page.url()).searchParams.get("redirect"), baseURL);
    const requested = new URL(route, baseURL);
    assert.equal(destination.pathname, requested.pathname, "Sign-in preserves the requested route");
    for (const [key, value] of requested.searchParams) {
      assert.equal(destination.searchParams.get(key), value, `Sign-in preserves ${key}`);
    }
    await page.getByLabel("Work email").fill(actors[name].email);
    await page.getByLabel("Password", { exact: true }).fill(actors[name].password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname === route.split("?")[0]);
    return page;
  };
  const row = async (table, id) =>
    (await sql`select to_jsonb(t) as record from ${sql(table)} t where id=${id}`)[0]?.record;
  const incidentState = async (id, state) =>
    waitFor(async () => (await row("incidents", id))?.state === state, `incident ${state}`);
  const openIncident = async (page, id) => {
    await page.goto(`${baseURL}/incidents?record=${id}`);
    await page.getByRole("dialog").waitFor();
    await page.getByRole("heading", { name: /Activity & notes/ }).waitFor();
  };
  const createIncident = async (page, title) => {
    await page.getByRole("button", { name: "Log incident", exact: true }).click();
    await page.getByLabel("Short description", { exact: true }).fill(title);
    await page
      .getByLabel("What is happening", { exact: true })
      .fill("Local end-to-end verification of real incident intake and workflow.");
    await page.getByLabel("Impact", { exact: true }).selectOption("2");
    await page.getByLabel("Urgency", { exact: true }).selectOption("2");
    await page.getByRole("button", { name: "Log incident", exact: true }).click();
    await page.waitForURL((url) => Boolean(url.searchParams.get("record")));
    const id = new URL(page.url()).searchParams.get("record");
    await page.getByRole("dialog").waitFor();
    return id;
  };
  try {
    const requester = await login("requester");
    await requester.getByRole("heading", { name: "Incident workspace", exact: true }).waitFor();
    const incidentId = await createIncident(requester, `Requester VPN interruption ${runId}`);
    const created = await row("incidents", incidentId);
    assert.equal(created.requester_id, actors.requester.id);
    assert.equal(created.state, "new");
    assert.ok(created.sla_due_at);
    assert.equal(
      await requester.getByRole("button", { name: "Assign to me", exact: true }).count(),
      0,
    );
    await requester
      .getByLabel("Record note", { exact: true })
      .fill("Customer update visible to the requester.");
    await requester.getByRole("button", { name: "Add note", exact: true }).click();
    await requester
      .getByText("Customer update visible to the requester.", { exact: true })
      .waitFor();
    await requester.getByLabel("Choose a file to attach").setInputFiles({
      name: "e2e-evidence.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Local E2E attachment evidence"),
    });
    await requester
      .getByRole("button", { name: "Download e2e-evidence.txt", exact: true })
      .waitFor();
    check("Real requester sign-in, incident creation, public note, and Storage upload");

    const operator = await login("operator", `/incidents?record=${incidentId}`);
    await operator.getByRole("button", { name: "Assign to me", exact: true }).click();
    await operator.getByRole("button", { name: "Assigned to you", exact: true }).waitFor();
    await operator.locator("#incident-group").selectOption("20000000-0000-0000-0000-000000000002");
    await waitFor(
      async () =>
        (await row("incidents", incidentId)).group_id === "20000000-0000-0000-0000-000000000002",
      "assignment group saved",
    );
    await operator.getByRole("button", { name: "In progress", exact: true }).click();
    await incidentState(incidentId, "in_progress");
    await operator.getByRole("button", { name: "Pending", exact: true }).click();
    await incidentState(incidentId, "pending");
    assert.ok((await row("incidents", incidentId)).on_hold_reason);
    await operator.getByRole("button", { name: "In progress", exact: true }).click();
    await incidentState(incidentId, "in_progress");
    await operator
      .getByLabel("Resolution notes", { exact: true })
      .fill("VPN policy corrected and connectivity verified with the requester.");
    await operator.getByRole("button", { name: "Mark resolved", exact: true }).click();
    await incidentState(incidentId, "resolved");
    const resolutionTime = (await row("incidents", incidentId)).resolved_at;
    await operator.getByRole("button", { name: "Mark closed", exact: true }).click();
    await incidentState(incidentId, "closed");
    assert.equal((await row("incidents", incidentId)).resolved_at, resolutionTime);
    await operator.getByRole("button", { name: "Reopen incident", exact: true }).click();
    await incidentState(incidentId, "open");
    const reopened = await row("incidents", incidentId);
    assert.equal(reopened.resolved_at, null);
    assert.equal(reopened.reopen_count, 1);
    check(
      "Browser incident assignment → in progress → pending → resolved → closed → reopened with correct timestamps",
    );

    await operator.getByLabel("Internal work note", { exact: true }).check();
    await operator
      .getByLabel("Record note", { exact: true })
      .fill("Internal diagnosis for service desk only.");
    await operator.getByRole("button", { name: "Add note", exact: true }).click();
    await operator
      .getByText("Internal diagnosis for service desk only.", { exact: true })
      .waitFor();
    await requester.reload();
    await requester
      .getByText("Customer update visible to the requester.", { exact: true })
      .waitFor();
    assert.equal(
      await requester
        .getByText("Internal diagnosis for service desk only.", { exact: true })
        .count(),
      0,
    );
    const comments = ok(
      await actors.requester.client.from("record_comments").select("*").eq("record_id", incidentId),
    );
    assert.equal(comments.length, 1);
    denied(await actors.peer.client.from("incidents").select("*").eq("id", incidentId));
    denied(
      await actors.peer.client.from("record_comments").select("*").eq("record_id", incidentId),
    );
    denied(await actors.peer.client.from("attachments").select("*").eq("record_id", incidentId));
    const attachment = (
      await sql`select storage_path from attachments where record_id=${incidentId}`
    )[0];
    const download = ok(
      await actors.requester.client.storage.from("itsm-evidence").download(attachment.storage_path),
    );
    assert.equal(await download.text(), "Local E2E attachment evidence");
    assert.ok(
      (await actors.peer.client.storage.from("itsm-evidence").download(attachment.storage_path))
        .error,
    );
    denied(
      await actors.requester.client.from("audit_events").select("*").eq("record_id", incidentId),
    );
    const audit = ok(
      await actors.operator.client.from("audit_events").select("*").eq("record_id", incidentId),
    );
    assert.ok(
      audit.some(
        (event) =>
          event.after_values?.state === "resolved" && event.before_values?.state === "in_progress",
      ),
    );
    check(
      "Requester/peer RLS, internal-note privacy, actual Storage read denial, and operator audit visibility",
    );

    // Keep the first browser's record version stale while a second real browser edits it.
    await openIncident(operator, incidentId);
    const operator2 = await login("operator", `/incidents?record=${incidentId}`);
    await operator2.locator("#incident-group").selectOption("20000000-0000-0000-0000-000000000001");
    await waitFor(
      async () =>
        (await row("incidents", incidentId)).group_id === "20000000-0000-0000-0000-000000000001",
      "second browser update",
    );
    await operator.getByRole("button", { name: "In progress", exact: true }).click();
    await operator
      .getByRole("alert")
      .filter({ hasText: /changed|updated|refresh/i })
      .first()
      .waitFor();
    assert.equal((await row("incidents", incidentId)).state, "open");
    check("Stale incident edits from a second browser are rejected without overwriting data");

    await operator.goto(`${baseURL}/incidents`);
    await operator
      .getByLabel("Search incident number or title")
      .fill(`Requester VPN interruption ${runId}`);
    await operator.getByLabel("Search incident number or title").press("Enter");
    await operator.waitForURL(
      (url) => url.searchParams.get("q") === `Requester VPN interruption ${runId}`,
    );
    await waitFor(
      async () => (await operator.locator("tbody tr").count()) === 1,
      "search returns exactly one matching incident",
    );
    await operator
      .getByRole("button", { name: new RegExp(created.number) })
      .first()
      .waitFor();
    await operator.screenshot({
      path: path.join(artifacts, "desktop-incidents.png"),
      fullPage: true,
    });
    const mobile = await login("requester", "/incidents", true);
    await mobile.getByRole("heading", { name: "Incident workspace", exact: true }).waitFor();
    assert.ok(
      await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    );
    await mobile.screenshot({ path: path.join(artifacts, "mobile-incidents.png"), fullPage: true });
    await mobile.getByRole("button", { name: "Open navigation", exact: true }).click();
    await mobile.getByRole("dialog").waitFor();
    await mobile.screenshot({
      path: path.join(artifacts, "mobile-navigation.png"),
      fullPage: true,
    });
    await mobile.keyboard.press("Escape");
    check("Actual desktop search and mobile 390px queue/navigation without page overflow");

    await requester.goto(`${baseURL}/requests`);
    await requester.getByRole("button", { name: "New request", exact: true }).click();
    await requester
      .getByLabel("Catalog item", { exact: true })
      .selectOption("40000000-0000-0000-0000-000000000001");
    const requestTitle = `Approved laptop ${runId}`;
    await requester.getByLabel("What do you need", { exact: true }).fill(requestTitle);
    await requester
      .getByLabel("Details", { exact: true })
      .fill("A managed laptop for local approval workflow validation.");
    await requester.getByRole("button", { name: "Submit request", exact: true }).click();
    await requester.waitForURL((url) => Boolean(url.searchParams.get("record")));
    const requestId = new URL(requester.url()).searchParams.get("record");
    assert.equal((await row("service_requests", requestId)).approval_status, "requested");
    const approvals = await sql`select * from approvals where record_id=${requestId}`;
    assert.equal(approvals.length, 2);
    await requester.getByText(/Awaiting approval from every assigned approver/).waitFor();
    const approver1 = await login("approver1", "/approvals");
    const approvalCard1 = approver1
      .getByRole("listitem")
      .filter({ has: approver1.getByRole("heading", { name: requestTitle, exact: true }) });
    await approvalCard1.getByRole("button", { name: "Approve", exact: true }).click();
    await waitFor(
      async () =>
        (await row("approvals", approvals.find((a) => a.approver_id === actors.approver1.id).id))
          .status === "approved",
      "first approval",
    );
    assert.equal((await row("service_requests", requestId)).state, "pending");
    const approver2 = await login("approver2", "/approvals");
    const approvalCard2 = approver2
      .getByRole("listitem")
      .filter({ has: approver2.getByRole("heading", { name: requestTitle, exact: true }) });
    await approvalCard2.getByRole("button", { name: "Approve", exact: true }).click();
    await waitFor(
      async () => (await row("service_requests", requestId)).state === "open",
      "all approvals complete",
    );
    assert.equal((await row("service_requests", requestId)).approval_status, "approved");
    assert.ok(
      (
        await actors.approver2.client.rpc("itsm_decide_approval", {
          _approval_id: approvals.find((a) => a.approver_id === actors.approver2.id).id,
          _decision: "approved",
          _notes: "duplicate",
        })
      ).error,
    );
    await operator.goto(`${baseURL}/requests?record=${requestId}`);
    await operator.getByRole("button", { name: "In progress", exact: true }).click();
    await waitFor(
      async () => (await row("service_requests", requestId)).state === "in_progress",
      "request fulfillment started",
    );
    check(
      "Browser request creation, two independent approvers, ALL approval gating, duplicate denial, and fulfillment",
    );

    const rejected = ok(
      await actors.requester.client.rpc("itsm_create_service_request", {
        _org_id: org,
        _catalog_item_id: "40000000-0000-0000-0000-000000000001",
        _title: `Reject laptop ${runId}`,
        _description: "Rejection workflow validation.",
      }),
    );
    const rejectApprovals = await sql`select * from approvals where record_id=${rejected.id}`;
    await approver1.goto(`${baseURL}/approvals`);
    const rejectionCard = approver1.getByRole("listitem").filter({
      has: approver1.getByRole("heading", { name: `Reject laptop ${runId}`, exact: true }),
    });
    await rejectionCard
      .getByRole("textbox")
      .fill("Budget unavailable; submit again after budget approval.");
    await rejectionCard.getByRole("button", { name: "Reject", exact: true }).click();
    await waitFor(
      async () => (await row("service_requests", rejected.id)).approval_status === "rejected",
      "rejected parent",
    );
    assert.equal((await row("service_requests", rejected.id)).state, "cancelled");
    const otherApproval = rejectApprovals.find((a) => a.approver_id === actors.approver2.id);
    assert.equal((await row("approvals", otherApproval.id)).status, "cancelled");
    assert.ok(
      (
        await actors.approver2.client.rpc("itsm_decide_approval", {
          _approval_id: otherApproval.id,
          _decision: "approved",
          _notes: "late",
        })
      ).error,
    );
    check(
      "Browser rejection cancels parent and outstanding approvals; later approval cannot revive it",
    );

    await operator.goto(`${baseURL}/changes`);
    await operator.getByRole("button", { name: "Raise change", exact: true }).click();
    const changeTitle = `Controlled VPN change ${runId}`;
    await operator.getByLabel("Change title", { exact: true }).fill(changeTitle);
    for (const label of [
      "Reason for change",
      "Business justification",
      "Impact assessment",
      "Implementation plan",
      "Test plan",
      "Rollback plan",
      "Validation plan",
      "Rollback trigger",
      "Communication plan",
    ]) {
      await operator
        .getByLabel(label, { exact: true })
        .fill(`${label}: verified local test procedure and evidence.`);
    }
    await operator.getByLabel("Change type", { exact: true }).selectOption("normal");
    await operator
      .getByLabel("Window start", { exact: true })
      .fill(new Date(Date.now() - 300000).toISOString().slice(0, 16));
    await operator
      .getByLabel("Window end", { exact: true })
      .fill(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
    await operator.getByRole("button", { name: "Raise change", exact: true }).click();
    await operator.waitForURL((url) => Boolean(url.searchParams.get("record")));
    const changeId = new URL(operator.url()).searchParams.get("record");
    assert.equal((await row("changes", changeId)).state, "pending");
    assert.equal(
      await operator.getByRole("button", { name: "Start implementation", exact: true }).count(),
      0,
    );
    for (const page of [approver1, approver2]) {
      await page.goto(`${baseURL}/approvals`);
      const card = page
        .getByRole("listitem")
        .filter({ has: page.getByRole("heading", { name: changeTitle, exact: true }) });
      await card.getByRole("button", { name: "Approve", exact: true }).click();
      await card.waitFor({ state: "detached" });
      if (page === approver1) assert.equal((await row("changes", changeId)).state, "pending");
    }
    await waitFor(async () => (await row("changes", changeId)).state === "open", "change approved");
    await operator.goto(`${baseURL}/changes?record=${changeId}`);
    await operator.getByRole("button", { name: "Start implementation", exact: true }).click();
    await waitFor(
      async () => (await row("changes", changeId)).state === "in_progress",
      "change implementation",
    );
    await operator
      .getByPlaceholder("Validation results", { exact: true })
      .fill("Health checks, connectivity tests, and rollback readiness verified.");
    await operator
      .getByPlaceholder("Post-implementation review", { exact: true })
      .fill("Change delivered successfully and customer service restored.");
    await operator.getByRole("button", { name: "Record delivery", exact: true }).click();
    await waitFor(
      async () => (await row("changes", changeId)).state === "resolved",
      "change delivery",
    );
    await operator.getByRole("button", { name: "Close change", exact: true }).click();
    await waitFor(
      async () => (await row("changes", changeId)).state === "closed",
      "change closure",
    );
    const closedChange = await row("changes", changeId);
    assert.ok(closedChange.actual_start_at && closedChange.delivered_at && closedChange.closed_at);
    await operator.screenshot({
      path: path.join(artifacts, "change-delivery.png"),
      fullPage: true,
    });
    check(
      "Browser normal-change creation → two CAB approvals → implementation → delivery evidence → closure",
    );

    for (const name of ["outsider", "inactive"]) {
      const page = await login(name);
      await page
        .getByRole("heading", { name: "Workspace access unavailable", exact: true })
        .waitFor();
      assert.ok(
        (await actors[name].client.rpc("bootstrap_workspace", { _display_name: "Unauthorized" }))
          .error,
      );
      denied(await actors[name].client.from("incidents").select("id"));
    }
    assert.equal(
      (await sql`select is_active from memberships where user_id=${actors.inactive.id}`)[0]
        .is_active,
      false,
    );
    assert.equal(
      (await sql`select count(*)::int as n from memberships where user_id=${actors.outsider.id}`)[0]
        .n,
      0,
    );
    const requesterRoles =
      await sql`select role from user_roles where user_id=${actors.requester.id}`;
    assert.deepEqual(
      requesterRoles.map((r) => r.role),
      ["requester"],
    );
    check(
      "Uninvited and deactivated accounts fail closed in browser and API; no self-enrollment or privilege grants",
    );
    assert.deepEqual(escapedRequests, [], "No browser request may reach a hosted Supabase");
    assert.deepEqual(pageErrors, [], "No uncaught browser runtime exceptions");
    assert.deepEqual(
      diagnostics.filter((message) => /hydration|Minified React error #418/i.test(message)),
      [],
      "Signed-out redirects and authenticated navigation must not cause hydration errors",
    );
    check("Protected-route sign-in preserves destinations without hydration errors");
    check("No uncaught browser exceptions and no hosted database traffic");
  } catch (error) {
    await writeFile(
      path.join(artifacts, "browser-errors.json"),
      JSON.stringify({ pageErrors, escapedRequests, diagnostics }, null, 2),
    );
    for (const { name, page } of pages) {
      await page
        .screenshot({ path: path.join(artifacts, `failure-${name}.png`), fullPage: true })
        .catch(() => {});
      await writeFile(
        path.join(artifacts, `failure-${name}.txt`),
        (await page.locator("body").innerText()).slice(0, 20000),
      ).catch(() => {});
    }
    throw error;
  }
}
