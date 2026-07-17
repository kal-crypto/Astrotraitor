# AstroTraitors

A complete first-person social-deduction game in a single HTML file, plus a small Node server for online play.

## Play

**Offline: double-click `index.html`.** That's it. No server, no internet, no install —
three.js is vendored in `vendor/`, and nothing is fetched at runtime. Keep `index.html` and
`vendor/` together.

**Online: run the server.**

```
npm install          # once — pulls in `ws`
node server.mjs      # then open http://localhost:8080
```

The server prints one address to share:

| Address | Notes |
| --- | --- |
| `http://localhost:8080` | you, on this machine |
| `http://<your-lan-ip>:8080` | phones and friends on the same wifi |

Everything works on those, with nothing to accept: the game, all multiplayer, and voice chat
on this PC.

**Voice on a phone is the one exception.** Browsers only expose a microphone in a "secure
context" (https, or localhost), so a phone on a plain http address has no mic API at all —
that is the browser, not the game. If you want phones talking, use the https link the server
also prints (`https://<your-lan-ip>:8443`) and tap **Advanced -> Proceed** once per device.

Options: `--force-https` sends the LAN address there automatically, `--http-only` turns https
off entirely, and `cloudflared tunnel --url http://localhost:8080` gives a real certificate with
no warning anywhere.

## Phone or PC

The first screen asks how you're playing and highlights the one it detects. The choice only sets
the controls, so it's never a dead end — pick PHONE on a desktop and mouse-drag works as the thumb
stick. Switch any time with the button at the top-right of the menu.

**Phone:** landscape. **Left thumb moves, right thumb looks** — the stick appears wherever your
left thumb lands. The round buttons do everything else, so no keyboard is needed. Portrait asks
you to turn the device.

**PC:** WASD + mouse look. Click once to capture the mouse; `Esc` releases it.

Phones on the same wifi can join with the `http://<your-lan-ip>:8080` address; otherwise use a
tunnel.

## Online

**PLAY OFFLINE** — you and bots, no server needed.

**PLAY ONLINE** — no room codes. Everyone who opens the address lands in the open lobby, and the
first one in hosts it. The button carries the live count:

```
PLAY ONLINE
1 online · 8 more to start
```

Pick your player count (**6 / 9 / 12**) *before* joining — that is the size of the whole round,
humans plus bots. The first player fixes it, the lobby is capped at it, and a different pick is
refused (in the UI and on the server):

```
PLAY ONLINE
game is 6 players — set yours to 6
```

When a host starts, that group leaves the lobby and a **fresh lobby opens behind them**, so people
arriving mid-round are never turned away — they just form the next game instead of walking into one
already in progress. Any number of games run side by side.

### Voice chat

Press **M** or tap the 🎤 button to talk. Voice is peer-to-peer (WebRTC) — it never goes through
the server beyond the handshake — and it is **proximity based**:

- full volume within ~4 units, fading to silence by ~16
- muffled to a quarter if either of you is in a vent
- everyone at full volume during a meeting
- **the living never hear the dead.** Ghosts talk freely to other ghosts and hear everyone

The mic starts muted; the first tap asks the browser for permission. Meetings also have a text
chat, with the same ghost rule.

**Voice only works on the https address** (`https://<ip>:8443`) — a browser will not expose a
microphone over plain http to anything but localhost. If you open the http address, the menu tells
you and links the right one; the mic button turns into a 🔒 HTTPS badge.

Across the internet it also uses a public STUN server to find a route — the only time the game
touches anything external, and only when voice is on.

To play with people outside your network, put a tunnel in front of the server:

```
cloudflared tunnel --url http://localhost:8080
```

- The host's browser *is* the game server. If the host leaves, that round ends.
- Duplicate names and colours are resolved automatically — nobody has to coordinate.
- Roles are random online; the menu's role picker only applies to offline games.
- The host's map choice is authoritative — it ships with the round, so guests can't diverge.
- **Don't host if you want to be surprised.** The host's browser knows every role. Guests genuinely
  can't — a guest is only ever told its own role (plus its partner, if impostor).

## Hosting your own — free

The game is one small Node server (static files + a message relay). Three ways to run it,
cheapest effort first:

**1. Same wifi** — `npm start`, then everyone opens `http://<your-lan-ip>:8080`. Free, instant,
but only people on your network can reach it.

**2. Over the internet, one command** — `npm run host`. This starts the server *and* opens a
free Cloudflare quick tunnel, then prints a public link like:

```
https://lined-addressed-remembered-systems.trycloudflare.com
```

Share that link and anyone, anywhere can play — no install on their end, nothing to configure on
yours. No account or signup (it downloads a ~30MB helper the first time). The link is real https,
so **phone voice chat just works** with no certificate warning. The link lives only while the
command runs; Ctrl+C ends it. Each person who runs `npm run host` gets their own link, so this is
exactly how friends host their own games for free.

**3. A always-on free cloud host** — deploy `server.mjs` to a free Node tier (Render, Railway,
Fly.io, Glitch all work and support websockets). Start command `node server.mjs $PORT`. This gives
a permanent URL instead of a throwaway one, but free tiers sleep when idle and have monthly limits.

All three run the identical server — the only difference is who can reach it.

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Move — relative to where you're looking |
| Mouse | Look. Click once to capture it; `Esc` releases |
| Left thumb / right thumb | Move / look, on touch devices |
| `E` / click | Use / do task / fix sabotage / call emergency meeting |
| `Q` / click | Kill (impostor) |
| `R` | Report a dead body |
| `F` | Enter / exit vent (impostor) — `A`/`D` to travel between vents |
| `Tab` | Map (sabotage map via the ⚠️ button) |
| `V` | Toggle overhead view |
| `M` | Mic on / mute (online) |
| `Esc` | Release mouse / close overlay |

## The game

**Crewmate** — finish your tasks and survive. The task bar at the top-left tracks *every* crewmate's
progress, not just yours. Fill it and the crew wins. Or vote out both impostors.

**Impostor** — kill the crew and don't get caught. You have a 10s kill cooldown, a vent network
(4 separate loops), and three sabotages. Your task list is fake: opening a task does nothing to the bar.

**Meetings** — report a body or hit the emergency button in the cafeteria (one per game). Everyone votes,
including the AI, and anyone who *witnessed* a kill will vote for the killer. Ties and skips eject no one.

**Ghosts** — get killed or ejected and you keep playing as a ghost: you pass through walls, stay invisible
to the living, and your tasks still count toward the crew's bar.

### Sabotages

| System | Effect | Fixed at |
| --- | --- | --- |
| **Lights** | Vision collapses to a small pool around you | Electrical breakers |
| **Reactor** | 40s countdown — impostors win if it hits zero | Reactor handprint |
| **Comms** | Task list and waypoints hidden | Communications |

### Tasks

16 tasks with hand-built minigames: fix wiring, swipe card, download/upload data, clear asteroids,
prime shields, start reactor (simon says), unlock manifolds, calibrate distributor, submit scan,
align engine output, fuel engines, empty garbage, chart course, divert power, inspect sample,
clean O2 filter.

## Maps

Three, picked in the menu (the host picks for everyone online):

| Map | Size | Character |
| --- | --- | --- |
| **The Skeld** | 88 x 52 | The classic ship — one long spine, tight reactor |
| **MIRA HQ** | 60 x 55 | Compact sky HQ — hub-and-spoke, short sightlines, kills happen fast |
| **Polus** | 116 x 78 | Frozen outpost — huts scattered round an open middle, long lonely walks |

Each map is pure data in the `MAPS` registry: rooms, halls, solids, vents, spawn ring, sabotage
zones, tasks, and a `props()` builder. The floor is a union of rectangles; walls, the collision grid,
the minimap and the world bounds are all derived from it, so a new map is one object — no engine
changes.

`validateMap()` runs on load and enforces the rules the Skeld only satisfied by accident: rects on the
1-unit lattice and at least 2 units thick (thinner ones vanish from the grid and become invisible
walls across visible floor), one connected blob, every spawn slot / task / vent / sab fix point on
free floor, at least 2 vents per group, and a reactor fuse long enough to actually cross that map.

To add a map: copy the `skeld` entry, change the numbers, and run
`node tools/validate-map.mjs <id>` — it plays the real engine headlessly, prints any problems, and
draws an ASCII plan view of what the engine actually built.

## AI

Every bot runs A* over a 90×54 grid with string-pulled paths. Crew bots walk to real task consoles and
complete them (which moves the shared task bar) and will detour to fix sabotages. Impostor bots hunt
isolated targets and only strike when no one else is within ~13 units and has line of sight — so being
alone is genuinely dangerous. Crew who walk near a body report it; impostors never do.

## Google AdSense

The game is wired for AdSense with two placements:

- a **Display banner** on the menu (never covers gameplay), and
- a **fullscreen interstitial** between matches, via AdSense **H5 Games Ads** (`adBreak`).

### Set up (done)

AdSense is configured for publisher **ca-pub-5258918508845457**:

- the verification `<meta name="google-adsense-account">` tag and the AdSense script are in the
  `<head>` of `index.html`;
- the **banner** uses Display slot **4244963344** (placed on the menu by `showBanner()`);
- the **fullscreen** ad uses H5 Games Ads (`adBreak`) between matches;
- **`ads.txt`** sits at the project root with your DIRECT line — the server serves it at
  `/ads.txt`, which AdSense requires before it will pay out.

To change the banner or add units, create the unit in AdSense and swap the slot in
`window.ADSENSE_BANNER_SLOT`. (The `amp-ad` snippet Google also shows you is only for AMP pages —
this game is a normal WebGL page, so it is not used.)

### How it behaves

- Ads load **only when served over http/https** — double-clicking `index.html` (offline) skips
  them and the game still plays. Everything is null-safe: no AdSense, no errors, no ads.
- The **fullscreen ad** shows on the “Play Again” screen between matches. AdSense frequency-caps
  it, so it will not appear every single time.
- While a fullscreen ad plays, the game freezes and the mic mutes, then resumes.
- AdSense must **approve your site** before real ads serve — you will see blank/placeholder ads
  on localhost. Also remember AdSense’s own policies apply to game pages.

### The simplest alternative — Auto ads

If you would rather not place units by hand, just keep the one AdSense script (the publisher id)
and turn on **Auto ads** in your AdSense dashboard, plus **Anchor** (a sticky banner) and
**Vignette** (fullscreen) formats. Google then places both automatically — no slot id needed.

### Online + ads on a host that has no game server

If you host the static files on a platform without the WebSocket server, PLAY ONLINE cannot
connect there (it shows *“no server here”*, and PLAY OFFLINE works). To make online work, host
`server.mjs` somewhere public and point the build at it:

```html
<script>window.ASTRO_SERVER = "wss://your-server.example.com";</script>
```

## How online works

`index.html` is the whole game. `vendor/three.global.js` is three.js, wrapped as a classic script by
`tools/build-three.mjs` (re-run it after bumping three). It's a classic script rather than an ESM import
because Chrome blocks module imports over `file://`, which would break double-clicking `index.html`.
`server.mjs` serves the files and relays messages between players — it knows about rooms and nothing
about the game.

Online is **host-authoritative**: the host's browser simulates everything (bots, kills, meetings, votes,
win conditions) and broadcasts snapshots ~15x/s. Guests own only their own position, sent ~20x/s, and
render everything else from those snapshots. Guest requests are validated host-side — kill range and
cooldown are re-checked rather than trusted.

## Debug

`window.__game` is exposed in the console: `__game.me`, `__game.players`, `__game.state`,
`__game.progress`, `__game.sab`, `__game.net`, `__game.findPath(x, z, x2, z2)`.
