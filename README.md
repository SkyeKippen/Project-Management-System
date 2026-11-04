# Project Management System

A small self-hosted phase board, organised as **Project → Major Phases → Stages → Cards**:

- **Major phases** are tabs across the top of the board (add, rename, delete). Drag a tab to reorder it (or use ‹ ›). The selected tab is remembered per project.
- **Stages** are rows stacked top to bottom inside a major phase (add, rename, delete). Drag a stage by its ⠿ handle to reorder it (or use ↑ ↓), or drop it onto another tab to move it, with its cards, to that major phase.
- **Cards** (tasks) flow left to right within a stage and wrap onto new lines. Drag them within a stage, between stages, or onto another major phase's tab, which moves the card to that phase's first stage.
- **Orphaned cards**: deleting a stage or major phase asks for confirmation, with a "Delete cards" checkbox. Unticked (the default), its cards move to the *Orphaned cards* tab at the right of the tab bar, labelled with where they came from. From there, drag a card onto a major phase tab or open it and pick a stage.

### Cards

- **Category** (required): each project has its own list, by default *Bugfix*, *Feature Addition*, *Optimization*, *Planning* (orange) and *Other* (grey). The category's colour is the stripe down the card's left edge. New cards start as *Feature Addition*. Edit the list under **Categories & tags**; deleting a category asks which category its cards should move to.
- **Priority**: Urgent, High, Medium or Low.
- **Size** (optional): Tiny, Small, Medium, Large or Huge.
- **Tags**: up to 5 per card, from a per-project list with colours. Type a new name in a card to create a tag, and rename, recolour or delete tags under **Categories & tags** (deleting removes the tag from every card).
- **Assignee** (optional), on the card and on each of its steps, shown as an initials avatar. People are shared by every project. Pick someone from the dropdown, or choose **+ New person…** to add them (a name that already exists, ignoring case, reuses that person). Rename, add or delete people under **People**; deleting someone unassigns them everywhere.
- **Filters**: the chips under the tabs filter the board, by tag and by person. Within each group, selecting several shows cards matching *any* of them. When both groups have selections, a card must match both (a tag AND a person). A card matches a person if they're assigned to the card or to any of its steps. With nothing selected, every card shows. Filters are per viewer and aren't shared with others. While filtering, stage counts read *visible/total*.
- **Description** in Markdown: headings, **bold**, *italic*, ~~strike~~, `code`, code blocks, lists, `- [ ]` task items, quotes and links. Rendering is built in and escapes all HTML; only http(s) and mailto links are allowed.
- **Attachments**: attach files from the dialog or drop them onto it (up to 25 MB each by default). Images get a thumbnail. Files are always served as downloads, never opened in the page. Removing an attachment, or deleting its card, deletes the file.
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
- Access only protects the public hostname. Because the app listens on all interfaces by default, anyone who can reach the server's port on your network can open the board directly. Ideally allow port 3101 only from the `cloudflared` machine, or set `HOST=127.0.0.1` when `cloudflared` runs on the same machine.
