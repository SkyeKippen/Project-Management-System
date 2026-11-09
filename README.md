# Project Management System

A small self-hosted phase board, organised as **Project → Major Phases → Stages → Cards**:

- **Major phases** are tabs across the top of the board (add, rename, delete). Drag a tab to reorder it (or use ‹ ›). The selected tab is remembered per project.
- **Stages** are rows stacked top to bottom inside a major phase (add, rename, delete). Drag a stage by its ⠿ handle to reorder it (or use ↑ ↓), or drop it onto another tab to move it, with its cards, to that major phase.
- **Cards** (tasks) flow left to right within a stage and wrap onto new lines. Drag them within a stage, between stages, or onto another major phase's tab, which moves the card to that phase's first stage (tabs are outlined while dragging). To move a card to any stage of any major phase, use its **⋯** button or right-click it for **Move to…**, or pick the **Major phase** and **Stage** in its dialog.
- **Orphaned cards**: deleting a stage or major phase asks for confirmation, with a "Delete cards" checkbox. Unticked (the default), its cards move to the *Orphaned cards* tab at the right of the tab bar, labelled with where they came from. From there, drag a card onto a major phase tab or open it and pick a stage.

### Done stages and archiving

Tick **Done stage** on any stage (one or more per major phase; stages named "Done" start ticked). Each major phase tab shows its progress: cards in done stages, plus archived cards, as a share of all its cards. Archive a card from its dialog, or everything showing in a done stage with **Archive all**. Archived cards leave the board and appear under the **Archived** tab, where opening one lets you unarchive it back to its stage.

### Bugs

Every project has a permanent **🐞 Bugs** major phase. It can't be deleted or renamed, but it can be reordered like any tab, and new major phases are added before it.

- Its rows are **bug types** instead of stages: Crash, Gameplay, UI / Visual, Performance and Other to start with. Add, rename, reorder and delete types like stages.
- **Anyone can add a bug, and it skips review**, going straight onto the board. New bugs start in the Bugfix category when it exists. Existing cards can be moved into Bugs by anyone; a bug moved out of Bugs onto the regular board by someone who isn't a reviewer goes into review, like any new card.
- Mark a bug **Resolved** in its dialog: it shows a ✓ badge and is dimmed. **Hide resolved** above the types hides them for you only. The tab shows open/total bugs instead of a % done. Archiving works as elsewhere.

### Card review

People marked **Reviewer** under **People** approve cards that others create. Skye is a reviewer from the start (added to People if missing), and only a reviewer can change who reviews.

- When someone who isn't a reviewer adds a card with **+ Add task**, it is created **in review**, aimed at that stage. It doesn't appear on the board; it waits in the **Review** tab, whose count is highlighted for reviewers. The card's dialog shows its destination, which can be changed.
- A reviewer can edit it, **Approve** it (it appears at the end of its destination stage, or the reviewer picks a new one if that stage was deleted meanwhile), or **Decline** it with an optional reason. Declined cards stay in the Review tab with the reason, and can be resubmitted, approved later, or deleted.
- The person who sent a card can edit, resubmit or withdraw it. Anyone else can only read it and comment.
- Cards created by reviewers, and all cards that existed before this feature, go straight to the board. Major phases and stages can be created by anyone.
- The server enforces these rules. It identifies people by their Cloudflare Access login when present; otherwise by the **You are** choice in the page, which anyone can change, so this suits a small group of trusted people.

### Decisions log

Each project has a **Decisions** tab for recording decisions in detail. Decisions have no numbers; they are known by title and date.

- A decision has a title, status (Proposed, Accepted, Rejected or Superseded), decision date, the people who decided, a short summary, and a full Markdown write-up that starts from a template (Context, Options considered, Decision, Rationale, Consequences / follow-ups). The write-up opens in a wide view and is edited like card descriptions.
- **History**: each time someone finishes editing the write-up (Preview, or closing the decision), the text is kept as a version with their name and the time. Versions can be viewed and restored, and restoring keeps the current text in the history too.
- **Links**: link a decision to any cards in the project, from either side; a card's dialog lists its decisions. A decision can **supersede** an older one, which marks the older one Superseded and shows it a banner pointing to the new one.
- Comments and attachments work as they do on cards. Deleted decisions go to Recently deleted, and undo covers them.
- The list is sorted by decision date, oldest first, then by title. Filter it by status, or search titles, summaries and write-ups. These choices are per viewer.

### Due dates and calendar

- Give a card a **Due date** in its dialog (a date only, no time of day; ✕ clears it). The card shows **Due Nov 12**: amber when it's due today or within 2 days, red once overdue. Cards in a done stage, resolved bugs and archived cards are never shown as overdue. A due date is the same date for everyone, whatever their timezone.
- The **Calendar** tab shows cards by due date; its count is the number of overdue cards. **Month** shows weeks starting Monday, with ‹ › and Today to move between months. Click a card to open it, or drag it to another day to change its due date. Busy days show "+N more".
- **Agenda** lists cards by due date, then title, under Overdue, Today, Tomorrow and each later date, with cards that have no due date at the bottom. Each shows its major phase › stage, category, assignee, priority and due date.
- The category, tag and person filters apply. Cards in review and archived cards aren't shown; tick **Show completed** to include cards in done stages and resolved bugs. **All projects** shows every project's cards together (the filters then match other projects' categories and tags by name). These choices are per viewer.

### Recently deleted and undo

Deleted cards, stages, major phases, decisions, projects and attachments go to **Recently deleted** for 30 days, along with any attachment files. **Restore** puts an item back where it was. If its parent has gone too, the parent is restored with it where possible; a card whose stage no longer exists returns to Orphaned cards. **Delete forever** removes it immediately, and anything older than 30 days is removed automatically.

**Undo** (the header button, the prompt after a change, or Ctrl+Z outside a text field) reverses your own recent changes in this browser, and everyone sees the result. If someone else has since changed the same thing, that part is left alone and you're told. The undo history is lost when the page is reloaded.

### Cards

- **Category** (required): each project has its own list, by default *Bugfix*, *Feature Addition*, *Optimization*, *Planning* (orange) and *Other* (grey). The category's colour is the stripe down the card's left edge. New cards get the project's **default** category, chosen under **Categories & tags** (*Feature Addition* unless changed); deleting the default category makes its replacement the new default. Edit the list under **Categories & tags**; deleting a category asks which category its cards should move to.
- **Priority**: Urgent, High, Medium or Low.
- **Size** (optional): Tiny, Small, Medium, Large or Huge.
- **Tags**: up to 5 per card, from a per-project list with colours. Type a new name in a card to create a tag; a tag no card uses any more (orphaned cards count as using it) is removed automatically, so the list and filter stay tidy. Rename, recolour or delete tags under **Categories & tags** (deleting removes the tag from every card).
- **Assignee** (optional), on the card and on each of its steps, shown as an initials avatar. People are shared by every project. Pick someone from the dropdown, or choose **+ New person…** to add them (a name that already exists, ignoring case, reuses that person). Rename, add or delete people under **People**; deleting someone unassigns them everywhere.
- **Filters**: the chips under the tabs filter the board by category, tag and person (only categories and tags some card uses are shown). Within each group, selecting several shows cards matching *any* of them. When several groups have selections, a card must match each of them (e.g. a category AND a tag). A card matches a person if they're assigned to the card or to any of its steps. With nothing selected, every card shows. Filters are per viewer and aren't shared with others. While filtering, stage counts read *visible/total*.
- **Description** in Markdown, editable any time (click it, or use Edit): headings, **bold**, *italic*, ~~strike~~, `code`, code blocks, lists, `- [ ]` task items, quotes and links. Rendering is built in and escapes all HTML; only http(s) and mailto links are allowed.
- **Attachments**: attach files from the dialog or drop them onto it (up to 25 MB each by default). Images get a thumbnail. Files are always served as downloads, never opened in the page. Removing an attachment, or deleting its card, sends it to Recently deleted; the file is deleted when that entry is.
- **Comments**: a thread on each card, in Markdown, updated live. People can edit and delete their own. The card shows a comment count. Your name comes from Cloudflare Access when it's in front of the app (matched to, or added to, People by email); otherwise choose it under **You are** at the top of the page, remembered in that browser.
- **Steps**: a checklist per card, with a progress bar on the card.

Data saved by older versions is upgraded when the server starts: old board columns become the stages of a single major phase named "Phase 1", task "phases" become steps, existing cards get the *Feature Addition* category, and unknown priorities become Medium. Before any upgrade, the file as it was is copied to `backups/pre-upgrade-<time>.json`.

No dependencies beyond Node.js 18 or newer.

## Run

```bash
npm start
```

Then open http://127.0.0.1:3101. On startup the server prints every address it can be reached on.

| Variable | Default | Purpose                                                                 |
|----------|---------|-------------------------------------------------------------------------|
| `PORT`   | `3101`  | Port to listen on                                                       |
| `HOST`   | `::`    | Interface to bind to. The default is all interfaces, IPv4 and IPv6 (falls back to `0.0.0.0` without IPv6). Set `127.0.0.1` to allow this machine only. |
| `MAX_UPLOAD_MB` | `25` | Largest attachment accepted, in MB. Cloudflare's free plan caps requests at 100 MB. |
| `BACKUP_INTERVAL_HOURS` | `12` | How often `data.json` is backed up. |
| `BACKUP_KEEP_DAYS` | `14` | How long backups are kept. |
| `TRASH_KEEP_DAYS` | `30` | How long deleted items stay in Recently deleted. |

## Data

All state is stored in `data.json` next to `server.js`, and attachments in `uploads/`. Both are created on first run and are not tracked by git.

**Backups**: every 12 hours, `data.json` is copied to `backups/data-YYYYMMDD-HHMMSS.json` (UTC). One is also made at startup if the newest is more than 12 hours old, and backups older than 14 days are deleted. **Attachments in `uploads/` are not backed up**; include that folder in any backup of the machine. To restore, stop the server, copy a backup over `data.json`, and start it again.

## Multiple users

Several people can use the board at once, and every change appears for everyone immediately.

- The server keeps the board in memory and is the single source of truth. It saves `data.json` shortly after each change (written to a temp file, then renamed, so a crash can't leave a half-written file).
- Browsers send only what they changed (`POST /api/ops`): set a field, or insert/remove/reorder an item in a list. Edits to different cards, or to different fields of the same card, merge rather than overwrite. If two people change the *same* field, the later change wins.
- The server pushes each new state to every open browser over Server-Sent Events (`GET /api/events`), with a keep-alive every 25 seconds so proxies such as Cloudflare Tunnel don't drop the connection.
- Each browser folds in other people's changes without disturbing its own: a field you are typing in, a stage you are renaming, or a card you are dragging is left alone and catches up when you finish. An open card dialog refreshes its other fields, and tells you if someone else deleted the card.
- The header shows **● Live** while connected. If the connection drops, the page reconnects by itself, and edits made in the meantime are sent once it is back.

## Hosting behind a Cloudflare Tunnel

The app has **no authentication of its own**. Anyone who can reach the port can read and edit everything.

- Point the tunnel's service at `http://<server-LAN-IP>:3101`, using plain `http` (Cloudflare provides HTTPS to visitors). If `cloudflared` runs on the same machine, use `http://127.0.0.1:3101`.
- Put a **Cloudflare Access** application (with an allow policy for the people who should get in) in front of the tunnel's hostname. Without Access, the tunnel makes the board public.
- Comment authorship relies on the `Cf-Access-Authenticated-User-Email` header, and "edit your own" is enforced in the page only. Anyone reaching the port directly, bypassing Access, can claim any name.
- Access only protects the public hostname. Because the app listens on all interfaces by default, anyone who can reach the server's port on your network can open the board directly. Ideally allow port 3101 only from the `cloudflared` machine, or set `HOST=127.0.0.1` when `cloudflared` runs on the same machine.
