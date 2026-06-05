# BigSet CLI

Local launcher for BigSet.

```bash
npm install -g @tiny-fish/bigset
bigset
```

For a one-off run without installing globally:

```bash
npx @tiny-fish/bigset
```

By default it downloads the latest BigSet release, downloads the matching
prebuilt Convex backend from GitHub, deploys BigSet's Convex functions, starts a
local credential bridge, caches everything under `~/.bigset`, and starts the app
locally.

For local testing against a build zip:

```bash
node bin/bigset.js --bigset-url file:///absolute/path/to/bigset-build.zip
```

Useful options:

```bash
bigset --force
bigset --home ~/.bigset-dev
bigset --app-port 4500 --backend-port 4501
bigset --keychain-port 3502
bigset --no-convex
```
