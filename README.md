# CCTV Map

A log of every CCTV enquiry you make, on a map, searchable by **place** and by
**time** — so that when someone asks "has anyone already got footage of the
High Street on the 12th?", there is an answer.

It exists to fix one specific problem: a digital evidence system tells you what
*you* collected, but not what a colleague collected two streets away last week.
So the same shop gets visited three times, and footage that would have answered
your question quietly overwrites itself.

---

## What you record

For each CCTV enquiry:

| | |
|---|---|
| **Where it came from** | Premises name, address, postcode, and a pin on the map |
| **When you collected it** | Date and time of the visit, and who made it |
| **What period the footage covers** | Footage from → to (this is the bit that makes it searchable) |
| **Which way each camera looks** | Per camera: aim it on a mini-map of the premises — one click sets the direction and how far it sees — plus field of view and what it covers |
| **The system** | Type, retention period, quality, media format |
| **References** | Occurrence/crime reference, operation, exhibit reference, where the media is now stored |
| **Outcome** | Obtained, requested, viewed only, no footage, system not working, refused, no reply, or still to do |

The direction of view matters more than it looks. It is the difference between
"there is a camera near your scene" and "there is a camera *pointing at* your
scene".

You set it by clicking a small map centred on the premises, towards whatever
the camera actually looks at — the junction, the alley, the forecourt. That one
click records both the bearing and how far the camera usefully sees, because
pointing at a thing on a map is how people know a camera's direction. The
bearing, field of view and range are all there as numbers too if you would
rather type them.

## The three screens

**Map** — every enquiry as a pin, coloured by outcome, with a shaded cone
showing what each camera can see. A 360° camera draws as a full circle.

**List** — the same records as a table, filterable, exportable to CSV (opens
cleanly in Excel) or JSON.

**Check before you go** — the one that saves the legwork. Drop a pin where your
enquiry is, set a radius and the period you need, and it lists everything
already on file that covers that place and time. Records whose cameras actually
point at your spot are marked and sorted to the top. If it comes back empty,
you know the enquiry is genuinely outstanding.

Searching by date matches any footage that **overlaps** your window, not just
footage wholly inside it — a camera recording 06:00–22:00 will be found when
you ask about 19:00–20:00.

The app also works out when the original will have overwritten itself, from the
retention period you recorded, and says so: *"Original still on the system for
roughly 9 more days"*, or *"would have been overwritten around 9 April — this
log may be the only surviving record that it existed."*

---

## Running it

You need [Node.js](https://nodejs.org) 22.13 or newer. Nothing else — there are
no dependencies to install.

```bash
node server.js
```

Then open <http://127.0.0.1:4173>.

To load six worked examples so you can see how it hangs together:

```bash
npm run seed
```

They are all tagged with the operation `DEMO`. Filter on that and delete them
when you have finished looking, or run `npm run seed` again to reset them.

### Settings

Copy `.env.example` to `.env` in the same folder and edit it:

```bash
cp .env.example .env
```

That file is where your Ordnance Survey key goes, along with anything else you
want set every time:

```
CCTV_MAP_OS_API_KEY=your-os-maps-api-key
CCTV_MAP_PASSCODE=pick-something-long
```

Then just `node server.js` — it reads `.env` automatically. The file is
git-ignored, so nothing you put in it is ever committed.

You can still set any of these as ordinary environment variables instead, and
those take precedence over the file when both are present:

```bash
CCTV_MAP_TILES=os-light node server.js
```

Everything is optional — the app runs with none of it set:

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `4173` | Port to listen on |
| `HOST` | `127.0.0.1` | Interface to bind. `127.0.0.1` means *this machine only* |
| `CCTV_MAP_DB` | `./data/cctv-map.db` | Where the database file lives |
| `CCTV_MAP_PASSCODE` | *(unset)* | If set, a shared passcode is required to use the app |
| `CCTV_MAP_SECRET` | random | Signing key for session cookies. Set it to a long random string if you want sign-ins to survive a restart |
| `CCTV_MAP_TILES` | `carto-voyager` | Which map background to use — see below |
| `CCTV_MAP_OS_API_KEY` | *(unset)* | Ordnance Survey Data Hub key. Setting it switches the map to OS mapping |
| `CCTV_MAP_CARTO_API_KEY` | *(unset)* | CARTO account key, added to CARTO tile URLs as `?api_key=` |
| `CCTV_MAP_TILE_URL` | *(unset)* | A tile URL template of your own, e.g. a tile server inside your network. Overrides everything above |
| `CCTV_MAP_TILE_ATTRIBUTION` | per provider | Attribution text shown in the corner of the map |
| `CCTV_MAP_TILE_MAX_ZOOM` | per provider | How far the map will zoom in |
| `CCTV_MAP_TILE_MAX_NATIVE_ZOOM` | per provider | The deepest zoom the provider really has images for. `npm run check` measures this for you |

For example, to share it on a local network with a passcode:

```bash
HOST=0.0.0.0 CCTV_MAP_PASSCODE='pick-something-long' CCTV_MAP_SECRET='a-long-random-string' node server.js
```

### Checking your setup

```bash
npm run check
```

Reads your `.env` exactly as the server does, then fetches one real map tile to
prove the key works. It reports the length of your key but never its value, so
the output is safe to share when asking for help.

It catches the usual culprits: a file Notepad saved as `.env.txt` rather than
`.env`, the project *secret* pasted where the *API key* belongs, a key with a
stray space or quote in it, and a Data Hub project with the wrong API added.

### Map background

The pins, the view cones and the coverage check are all computed locally — the
only thing the internet provides is the picture underneath them. Where that
picture comes from is configurable, because it is a licensing question as much
as a technical one.

```bash
CCTV_MAP_TILES=carto-positron node server.js
```

| Preset | What it is |
|---|---|
| `carto-voyager` *(default)* | CARTO's basemap built from OpenStreetMap data. Free to use with attribution, no sign-up |
| `carto-positron` | The same, in a pale style that makes the coloured pins stand out |
| `carto-dark` | Dark style |
| `os-road`, `os-light`, `os-outdoor` | **Ordnance Survey.** Needs `CCTV_MAP_OS_API_KEY` |
| `esri-street`, `esri-imagery` | Esri's public basemaps, no account needed. Check Esri's terms before organisational use |
| `osm` | OpenStreetMap's own servers. Read the warning below before choosing this |
| `none` | No background at all. Pins and cones on a plain backdrop — works with no internet access whatsoever |

**If you are in a UK police force, use Ordnance Survey.** Forces have access
through the Public Sector Geospatial Agreement, the licensing is already
settled, and OS street and address detail is far better than anything else for
UK work. Get a key from a project in the [OS Data Hub](https://osdatahub.os.uk)
and:

```bash
CCTV_MAP_OS_API_KEY=your-key node server.js
```

Or put it in `.env` and just run `node server.js`:

```
CCTV_MAP_OS_API_KEY=your-key
```

Either way, setting the key is enough — the map switches to OS automatically.

Pick the **OS Maps API** when you add an API to your Data Hub project. It
serves pre-rendered raster tiles, which is what this app draws. *OS NGD API –
Tiles* and *OS Vector Tile API* both serve vector tiles, which Leaflet cannot
render — choosing those gives a blank map.

Note the key ends up in the tile URLs the browser requests, which is how OS
raster keys are designed to work. Restrict it to your host in the Data Hub
rather than relying on `.env` to keep it secret.

**About `osm`.** OpenStreetMap's tile servers run on donated hardware for the
OSM project's own benefit, and their
[usage policy](https://operations.osmfoundation.org/policies/tiles/) does not
cover being an application's backend. They block traffic they cannot attribute
to a known app, which is what a browser pointed at `127.0.0.1` looks like — if
you see *"Access blocked: app is not following the tile usage policy"* on the
map, that is what happened. The default was changed away from OSM for exactly
this reason. Only choose `osm` for genuinely light personal use.

Pointing it at a tile server inside your own network works too:

```bash
CCTV_MAP_TILE_URL='https://tiles.yourforce.internal/{z}/{x}/{y}.png' \
CCTV_MAP_TILE_ATTRIBUTION='Force GIS team' node server.js
```

If tiles cannot be fetched for any reason the app says so and keeps working —
only the background imagery is lost.

**If the map goes blank only when you zoom right in**, the app is asking for a
zoom level your provider has no imagery for. Run `npm run check`: it measures
how far in the provider actually goes and tells you what to set
`CCTV_MAP_TILE_MAX_NATIVE_ZOOM` to. Below that level the map stays sharp;
above it, the last real tile is scaled up rather than a missing one requested.

The check prints where each value came from:

```
    max zoom 21 · imagery to zoom 19 (default — not set by you)
```

`default — not set by you` means your `.env` line is not taking effect. The
usual reason is that it still starts with `#`, which switches the line off —
changing the number on a commented line leaves it commented. It should read:

```
CCTV_MAP_TILE_MAX_NATIVE_ZOOM=20
```

The check also refuses to guess from an ambiguous failure. Only a 404 means
"no imagery here"; a rate limit or an auth error makes it say it could not
establish the limit rather than talk you into crippling a working map.

**If a provider gives you a key but the map still fails**, the way the key is
passed varies between services and plans. The reliable route is to copy the
exact tile URL template the provider shows you and use it directly, which
sidesteps any guesswork on this side:

```
CCTV_MAP_TILE_URL=https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?api_key=YOUR_KEY
CCTV_MAP_TILE_ATTRIBUTION=© OpenStreetMap contributors © CARTO
```

`npm run check` fetches real tiles through whatever you set, so it will tell
you within seconds whether the key is being accepted. Keys are hidden from its
output, so the result is safe to share.

**If the check says the provider returns the same image for every tile**, it is
serving a placeholder — usually an "API key required" notice — rather than map
imagery. Free basemap services change their terms, and several that once
allowed anonymous use now want an account. Switch provider with
`CCTV_MAP_TILES`, or run with `CCTV_MAP_TILES=none` and work without a
background map; pins, cones and the coverage check are unaffected.

**If zoom works up to a point and then returns 403**, that is your plan, not a
fault. The free OS Data Hub plan serves open data, which does not go to
street level. For UK policing you want your force's Public Sector Geospatial
Agreement access rather than a personal account — ask whoever runs your force's
OS Data Hub organisation to add you to it.

A quicker interim step: in the OS Data Hub, a project on the **OpenData** plan
is limited to open data, which does not reach street level. Switching that
project to the **Premium** plan — which carries a free monthly allowance —
unlocks the full zoom range on the same key. Check the licensing suits your
force before relying on it for real work.

### Where the data lives

One SQLite file, `data/cctv-map.db`. Back it up by copying it. Move it to
another machine by copying it. It is not in version control — see
`.gitignore`.

---

## Please read this before putting real case data in it

This is a working tool, not an accredited evidence system, and it was built
outside any force procurement or information-assurance process. Some things you
should weigh up first:

- **There is no per-user login.** The optional passcode is shared, and the "You"
  box in the corner is a name people type themselves — it identifies who made a
  change in the audit trail, but it does not authenticate anyone.
- **Nothing is encrypted at rest.** The database is a plain file. Anyone with
  access to the machine or a backup of it can read it.
- **Traffic is unencrypted** unless you put it behind a reverse proxy with TLS.
  Do not run it with `HOST=0.0.0.0` on an untrusted network without one.
- **It records intelligence about premises and people** — addresses, contact
  names, phone numbers. That engages data protection obligations, and in a
  policing context likely a DPIA and your force's information security team.
- **It is not a disclosure record and not an exhibit management system.** Treat
  it as an index that points at where the real material is held, and keep the
  authoritative copy in whatever system your force mandates.

The honest summary: excellent for your own casework on your own machine, and
for a small team on a properly secured internal server — but get it signed off
before it holds live operational data for a whole department.

- **The browser fetches map tiles from whichever provider you configure**, which
  tells that provider which map squares are being looked at. It sends **none of
  your records** — not the pins, not the addresses, not the times. Even so, the
  pattern of areas being viewed is not nothing, which is another argument for
  pointing `CCTV_MAP_TILE_URL` at something your force already runs, or using
  `CCTV_MAP_TILES=none`. Leaflet itself is bundled in `public/vendor/`, so the
  app needs no internet access to start.

---

## Development

```bash
npm test          # 54 tests, no dependencies
npm run check     # verify configuration and the map key
npm run dev       # restarts on change
```

```
.env.example           template for .env - API keys and settings
server.js              entry point
src/
  db.js                schema
  records.js           validation, search, and the coverage query
  geo.js               distance, bearings, field-of-view maths
  api.js               JSON API
  app.js               request handler (shared by server and tests)
  auth.js              optional shared passcode
  map-config.js        tile provider presets and resolution
  csv.js               export
  http.js              small HTTP helpers
public/
  index.html           app shell
  css/app.css          styles, light and dark
  js/                  map, form, camera aiming, list, detail, coverage
  vendor/leaflet/      Leaflet 1.9.4 (BSD-2-Clause), bundled
test/                  geo, records, api, auth
scripts/
  seed.js              example data
  check-setup.js       configuration diagnostic
```

### API

All endpoints return JSON. `GET` endpoints take the same filter parameters:
`q`, `status` (repeatable), `from`, `to`, `reference`, `operation`, `bbox`,
`mapped`, `limit`, `offset`.

```
GET    /api/records            list and filter
POST   /api/records            create
GET    /api/records/:id        read
PUT    /api/records/:id        update
DELETE /api/records/:id        delete
GET    /api/records/:id/history
POST   /api/coverage           { lat, lng, radius_m, from, to }
GET    /api/meta               statuses, system types, counts
GET    /api/export.csv         filtered export
GET    /api/export.json        filtered export
GET/POST/DELETE /api/session   passcode sign-in, when enabled
```
