# Argus Service Desk workspace design system

This implementation extends the existing React, Tailwind, and Radix components. It establishes shared application chrome and operational information hierarchy. Visual polish does not certify tenant isolation, workflow controls, or production readiness.

## Brand and semantic tokens

Tokens live in `src/styles.css` and are exposed through the existing Tailwind theme. Prefer semantic classes (`bg-card`, `text-muted-foreground`, `border-border`) over repeating raw colors in feature components.

| Token              | Light theme | Purpose                                                  |
| ------------------ | ----------- | -------------------------------------------------------- |
| `background`       | `#f5f6f8`   | Pale neutral workspace around white content surfaces     |
| `foreground`       | `#0e1116`   | Primary text and Argus Service Desk ink                              |
| `card`, `popover`  | `#ffffff`   | Tables, detail panels, forms, menus                      |
| `primary`, `ring`  | `#2b4cff`   | Main actions, selected controls, keyboard focus          |
| `brand`            | `#ff5b2e`   | Restrained coral brand mark, never an operational status |
| `success`          | `#0f7a55`   | Confirmed successful or met states                       |
| `destructive`      | `#c03638`   | Errors, breaches, destructive actions                    |
| `warning`          | `#946200`   | Attention required; pair with a readable text label      |
| `muted-foreground` | `#626b7c`   | Supporting text and field descriptions                   |
| `border`           | `#dde1e9`   | Content dividers and surface boundaries                  |
| `input`            | `#ced4df`   | Form-control borders                                     |
| `sidebar`          | `#0e1116`   | Persistent navigation                                    |
| `sidebar-accent`   | `#1e263b`   | Current navigation item                                  |
| `sidebar-ring`     | `#9cabff`   | Sidebar focus and active indicator                       |

The existing `.dark` selector has matching semantic tokens, including lighter blue, green, amber, and red foregrounds. The application does not add a new theme preference control in this slice. Brand paper `#f4f1ea` is reserved for editorial surfaces; the operational workspace uses a cool pale neutral to keep tables and controls distinct.

Color never carries status alone. State badges retain text; unread notifications have screen-reader text; active links expose `aria-current="page"` and a vertical indicator.

Warning badges use a pale warning background and dark amber text. The `warning-foreground` token supports the existing pale warning callouts; it is not white text for a solid amber surface.

The incident workbench uses a compact table on desktop and readable incident cards below 768px. Mobile cards retain the priority, state, owner, group, SLA outcome and target time. Queue tabs scroll horizontally inside their own region, while controls wrap without horizontal page overflow.

## Typography, spacing, and surfaces

- Preserve IBM Plex Sans for readable operational content and IBM Plex Mono for identifiers. System fonts remain fallbacks.
- Page titles are 24px on small screens and 28px on larger screens, weight 600, with restrained negative letter spacing.
- Descriptions use 14px text and generous line height. Navigation uses 13px text. Uppercase section labels are 10–11px and carry only secondary hierarchy.
- The base radius is 10px. Existing component variants derive their corner sizes from this token.
- Use white cards, light borders, and modest shadows for depth. Avoid decorative gradients, inflated KPI typography, or ornament around dense operational data.
- Main content has 16px horizontal padding on mobile, 24px at the small breakpoint, and 32px on desktop. Header height is at least 64px.
- Page actions wrap on narrow screens. Tables and detail panels must use local overflow or responsive stacking rather than widening the entire page.

## Application shell

`AppShell` retains its public `workspace` and `children` props.

| Area                     | Behavior                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Desktop navigation       | 256px width, sticky and viewport-height at 1024px and above; navigation scrolls independently                                  |
| Overview                 | Dashboard, incident insights, support assistant                                                                                |
| Service operations       | Incidents, service requests, problems, major incident command                                                                  |
| Governance and knowledge | Changes, approvals, knowledge, assets and CMDB, audit trail                                                                    |
| Active route             | Exact path or a child route; filled surface, blue indicator, icon emphasis, and `aria-current`                                 |
| Workspace identity       | Organization name returned by the workspace query; no fabricated environment or health indicator                               |
| Profile area             | Actual display name and role labels, profile link, explicit sign-out action                                                    |
| Mobile navigation        | Existing Radix `Sheet` with dialog title/description, overlay, focus trap, Escape/close button, and focus restoration          |
| Desktop resize           | An open mobile drawer closes when the viewport crosses the desktop breakpoint                                                  |
| Global search            | Existing search component and API preserved                                                                                    |
| Notifications            | Actual recent notifications in a Radix popover; unread count describes the loaded recent records, not an unbounded inbox total |

The notification bell opens the list. It does not silently mark messages as read. A separate **Mark all read** action performs the existing mutation, disables while pending, and exposes a failure message. The server returns up to 20 recent notifications, so the list and its accessible unread count are described as recent. No sample records or decorative alert counts are added.

Navigation visibility is a presentation rule. Backend authorization and row-level security remain authoritative.

## Loading, errors, and session behavior

`useWorkspace()` continues to return the React Query result. Bootstrap is deduplicated within the current query cache; a successful bootstrap stays fresh for that signed-in cache. A failed bootstrap rejects the workspace query rather than silently enabling subsequent reads. Callers can show `workspace.isError`, display the returned error, and use `workspace.refetch()` to retry. Signing out clears the query cache after successful authentication sign-out.

`WorkspaceLoading` exposes `role="status"`, polite live announcements, and `aria-busy`. Decorative skeletons are hidden from assistive technology. Empty-state copy should describe the current filter or unavailable data accurately; a failed request must not be rendered as a zero count or an empty successful result.

Server data-source failures must be thrown by the server functions to reach these client error states. This shared UI contract does not independently verify backend responses.

## Accessibility and interaction states

- The first keyboard target is **Skip to main content**, linked to the focusable `main` landmark.
- Focus uses a visible 2px outline; the dark sidebar uses a lighter focus token.
- Buttons and links use text labels or explicit accessible names. Decorative icons are hidden from assistive technology.
- Navigation items have at least a 40px row height. The mobile menu trigger uses the existing icon-button component.
- Hover is a subtle surface change. Active navigation retains the same label and position.
- Pending actions are disabled and use progress text. Sign-out failures leave the user in the workspace and display an error.
- System reduced-motion preferences disable nonessential animation and scrolling motion, including skeleton pulses.
- Existing Radix dialog and popover behavior supplies keyboard interaction and focus management; no manual overlay/focus-trap implementation is introduced.

## Verification boundary

Focused lint, TypeScript, and production-build results must be reported from the integrated checkout. Browser checks should cover desktop and mobile, long organization/profile names, drawer Escape and focus return, notification empty/unread/error states, and keyboard skip navigation. A fixture preview demonstrates layout and interaction only; it does not demonstrate signed-in backend operation or production authorization.
