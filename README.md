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

Then open http://127.0.0.1:3101.

| Variable | Default     | Purpose                    |
|----------|-------------|----------------------------|
| `PORT`   | `3101`      | Port to listen on          |
| `HOST`   | `127.0.0.1` | Interface to bind to       |

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

- Keep the default `HOST=127.0.0.1` so the app is only reachable from this machine.
- Run `cloudflared` on the same host and point the tunnel's ingress at `http://127.0.0.1:3101`.
- Put a **Cloudflare Access** application (with an allow policy for the people who should get in) in front of the tunnel's hostname. Without Access, the tunnel makes the board public.
