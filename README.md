# Ukebaco WebMCP

The [WebMCP](https://github.com/webmachinelearning/webmcp) layer of **[Ukebaco](https://ukeba.co)**,
extracted so it can be read and reused. Four tools, registered by the dashboard, that let an AI agent
running in the same browser tab create file-request pages, watch what arrives and close them again.

Ukebaco is a commercial product and **its main repository is private**. This repository is a minimal
copy of the agent-facing code only — no server routes, no billing, no infrastructure. It is published
under the MIT license. The running product is at **<https://ukeba.co>**.

## What Ukebaco does, in one paragraph

You publish one link. Anyone can upload files through it without signing in to anything. The files
land in *your* Google Drive™, sorted into a folder tree you defined, renamed from the answers the
sender typed, and recorded as a row in a Google Sheets™ ledger. It is how a small business collects
monthly invoices from subcontractors, or documents from new hires, without a shared inbox full of
`scan001.pdf`.

## The four tools

| Tool | What it does | Annotation |
|---|---|---|
| `create_link` | Creates the public upload page: which questions to ask, the folder tree, the file-naming rule, deadline, PIN, allowed extensions. Returns the URL to share. | — |
| `list_links` | The owner's links with status, destination folder and ledger URL. | `readOnlyHint` |
| `search_submissions` | Who sent what, when, and the Drive URL of each file. Matches company name, folder path, receipt number, file name. | `readOnlyHint`, `untrustedContentHint` |
| `set_link_active` | Stops or resumes a link. The URL survives; submissions are refused. | — |

`create_link` is the one worth looking at. Setting up a good file request is a form with about fifteen
decisions in it, which is exactly the shape of task people abandon halfway. Described in one sentence
to an agent it becomes a single tool call: folder templates, file-name templates and field types are
inferred from natural language and normalised before they reach the API.

## Design notes

**No new credential is introduced.** `execute` runs inside the owner's already-signed-in tab, so
`fetch` carries the existing session cookie and the server identifies the user with the same
`getSession()` it already used for the UI. There is no token to issue, store, rotate, revoke or leak.
Sign out and the tools go with the tab. If the owner is not signed in, the dashboard redirects to the
login page and no tools are ever registered.

**The server does not get more permissive because an agent is asking.** Plan limits and paid features
(PIN, deadline, email verification) are enforced by the same API route as the UI. When the plan does
not allow something it returns 402, and the tool relays that sentence verbatim to the agent. There is
deliberately no agent-shaped path through the paywall.

**Everything a submitter typed is `untrustedContentHint`.** Submitters are third parties: the company
name, the note in a text field and the file name are strings a stranger wrote. They are data to be
shown, never instructions to be followed. `search_submissions` says so in its result text as well as
in its annotation.

**Calls carry `X-Ukebaco-Client: webmcp`,** so link creation records which route it came from. When an
agent creates a link, the audit trail says so.

**Some things stay human on purpose.** Choosing an *existing* Drive folder stays in the Google Picker,
which an agent cannot drive. The OAuth scope is `drive.file` only, so the app sees the folders it
created and the ones the owner personally handed it. No tool pretends otherwise.

## Files

```
src/lib/webmcp-tools.ts        Tool definitions, JSON Schemas, and normalisation of
                               whatever the agent sends. No I/O — this is the tested part.
src/lib/webmcp-tools.test.ts   Unit tests for that layer.
src/lib/link-fields.ts         Shared field-definition normalisation (used by the UI too).
src/components/WebMcpTools.tsx Registration and fetch. Feature-detects document.modelContext
                               and the older navigator.modelContext, unregisters on unmount,
                               and leaves the dashboard working if registration fails.
src/lib/types.ts               Minimal type shims for the pieces that live elsewhere
                               in the product (Firestore shapes, translated strings).
```

The split is the point: the interesting logic is pure and unit-tested, and the component holds nothing
but registration and `fetch`.

## Using it

The product mounts one component on the dashboard, which is a page that already requires sign-in:

```tsx
<WebMcpTools baseUrl="https://ukeba.co" retentionDays={90} labels={labels.webmcp} />
```

`retentionDays` is how long submission records are kept, and it goes into the `search_submissions`
description so the agent knows the search window and can point at the ledger spreadsheet for older
records.

The tools call four endpoints that are not in this repository: `GET/POST /api/links`,
`PATCH /api/links/{id}`, `POST /api/folders` and `GET /api/submissions`.

## Tests

```
npm install
npm run check
```

## A note on the comments

The inline comments are in Japanese, because this is a verbatim copy of code from a product built in
Japanese. Nothing has been edited for presentation. The tool names, descriptions and JSON Schemas —
everything an agent reads — are in English, since the model sees the same definitions whatever
language the owner uses.

## License

MIT. See [LICENSE](LICENSE).

Google Drive and Google Sheets are trademarks of Google LLC. Ukebaco is not affiliated with,
endorsed by, or sponsored by Google.
