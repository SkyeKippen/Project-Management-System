# Project Management System

A small self-hosted phase board, organised as **Project → Major Phases → Stages → Cards**:

- **Major phases** are tabs across the top of the board (add, rename, reorder, delete). The selected tab is remembered per project.
- **Stages** are rows stacked top to bottom inside a major phase (add, rename, move up/down, delete).
- **Cards** (tasks) flow left to right within a stage and wrap onto new lines. Drag them within a stage, between stages, or onto another major phase's tab, which moves the card to that phase's first stage.
- Each task can also have its own checklist of **steps**, with a progress bar on the card.
- **Orphaned cards**: deleting a stage or major phase asks for confirmation, with a "Delete cards" checkbox. Unticked (the default), its cards move to the *Orphaned cards* tab at the right of the tab bar, labelled with where they came from. From there, drag a card onto a major phase tab or open it and pick a stage.

Data saved by older versions is migrated on load: old board columns become the stages of a single major phase named "Phase 1", and task "phases" become steps.

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

## Data

All state is stored in `data.json` next to `server.js`. It is created with sample data on first run and is not tracked by git, so back it up separately. Data from older versions is upgraded once when the server starts.

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
