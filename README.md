# Shoply

A grocery price calculator and household cost tracker, built for use while shopping
in Papua New Guinea. Currency is fixed to Kina (K).

## What it does

**Shop tab** — pick a shop, add items with price and quantity, see a running total
in a sticky receipt strip at the bottom of the screen. Set an optional budget limit
and the receipt edge turns red when you go over. Quick-pick lets you tap a
previously-bought item instead of retyping its price. Checkout saves the trip.

**History tab** — every saved trip, with date, shop, items and total. Also a
cross-shop item search ("where did I last buy rice and for how much").

**Other Costs tab** — a separate ledger for gardener, babysitter, debts you owe,
debts owed to you, utilities, etc. Tracks pending/paid status and totals.

**Settings tab** — manage shops (name, location, notes) and item categories.

Every item you add at a shop is remembered permanently in the database (price,
unit, and an optional photo), along with a full price-history log so price changes
over time are tracked automatically.

## Running it locally

```bash
cd shoply
pip install -r requirements.txt
python app.py
```

Then open `http://127.0.0.1:5000` in a browser. The database file is created
automatically at `instance/shoply.db` on first run — nothing else to set up.

To reach it from your phone while both devices are on the same wifi network, find
your computer's local IP address (e.g. `192.168.1.50`) and open
`http://192.168.1.50:5000` on your phone instead. On Windows, run `ipconfig`; on
Mac/Linux, run `ifconfig` or `ip addr`, to find that address.

## Deploying so it works away from home (at the shop, on data)

Since you want to use this on your phone while actually out shopping, the app
needs to live somewhere reachable from the internet, not just your home network.
A few practical options, roughly cheapest/simplest to more involved:

- **PythonAnywhere** (free tier exists) — upload the project, point it at `app.py`,
  get a public URL. Good first option since it needs no server administration.
- **Render.com / Railway.app** — connect a GitHub repo, both have free tiers for
  small apps like this, deploys automatically on push.
- **A VPS** (DigitalOcean, Linode, etc.) — more control, requires you to run Flask
  behind something like gunicorn + nginx yourself. Worth it later if you outgrow
  the free tiers, not necessary to start.

Whichever you choose, the SQLite database file (`instance/shoply.db`) is
the entire app's memory — back it up periodically, since it holds your shops,
remembered item prices, photos, and other-costs ledger.

One note on SQLite specifically: it's fine for one person using the app, even
across phone and computer, as long as only one request writes at a time, which
is the normal case here. If this ever grows into something multiple people use
at once, that's the point to migrate to MySQL/Postgres — not before.

## Project structure

```
shoply/
├── app.py              # Flask routes / API
├── models.py           # Database tables (SQLAlchemy)
├── requirements.txt
├── instance/
│   └── shoply.db # created automatically, holds all your data
├── templates/
│   └── index.html
└── static/
    ├── css/style.css
    └── js/app.js
```

## Possible next additions

A few things that came up while building this, worth considering later but
deliberately left out for now to keep the first version usable rather than
over-built:

- True offline support (a service worker / PWA manifest) so the app keeps working
  with no signal at the shop and syncs once you're back online. The current version
  needs a live connection to save items/trips as you go.
- A simple PIN/password lock, since the database has financial info in it and
  this will likely sit on a phone.
- Monthly/yearly spending charts pulling from trip history and the other-costs
  ledger.
