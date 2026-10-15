# Harden the public monitoring alert webhook

## Scan result
The automated backend scan found no issues. A manual review of the alert webhook and its access token found these gaps:

1. **Lookup filter can be manipulated.** The alert's server/instance name goes straight into the asset lookup. A crafted name, for example one containing commas or brackets, could change what the lookup matches.
2. **Duplicate check is too loose.** The duplicate check uses wildcard matching. Underscores in an alert ID act as wildcards, so a new alert could be merged into a different open incident.
3. **No flood protection.** One request can carry up to 100 alerts, and nothing limits how many incidents a single sender can open. A leaked token, or a noisy monitor, could flood the incident queue and Slack.
4. **Unchecked links.** Alert links are saved without checking the scheme, so a `javascript:` or other non-web link could end up in incident text.
5. **Setup state is visible to anyone.** The endpoint tells unauthenticated callers whether a token has been set up. It should answer "Unauthorized" either way.
6. **No length check on the token.** If a very short token were saved, the endpoint would still accept it.

## Fixes
- Accept only safe characters in instance names (letters, digits, dot, dash, colon) before the asset lookup, and match name and IP as separate exact lookups.
- Store a plain-character alert ID and match duplicates exactly, with no wildcard characters.
- Lower the limit to 25 alerts per request, and open at most 20 new incidents per 10 minutes. Over the limit, the endpoint returns "429 Too many requests" and no incident is created. Duplicates and cleared alerts don't count.
- Keep only `https://` and `http://` links. Drop anything else.
- Return 401 "Unauthorized" when the token is missing, wrong or not set up. Refuse tokens shorter than 32 characters.
- Add tests for each of these rules, and re-run the end-to-end check: a test alert creates an incident, a repeat is deduplicated, a wrong token is refused, a burst is limited.

## Technical details
- `src/lib/monitoring-alerts.ts`: `safeInstance()`, `safeLink()` and a stricter fingerprint slug (`[a-z0-9-]`); export limit constants.
- `src/routes/api/public/alerts.ts`: exact `.like` on the escaped marker, or check `description` ends with the marker; two `.eq` CI lookups instead of `.or()`; count incidents with `contact_type='monitoring'` created in the last 10 minutes before inserting; uniform 401 response.
- `tests/monitoring-alerts.test.ts`: new cases for injection characters, link schemes, the batch cap and fingerprint characters.
- No database schema changes needed.
