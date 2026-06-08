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

By default it downloads the latest BigSet release for your OS/architecture,
downloads the matching prebuilt Convex backend from GitHub, deploys BigSet's
Convex functions, starts a local credential bridge, caches everything under
`~/.bigset`, and starts the app locally.

On later runs, the launcher checks for CLI package updates and cached BigSet
core updates. Convex is updated only when BigSet core is installed or updated,
so deferring a BigSet core update keeps the matching cached Convex binary.

For local testing against a build zip:

```bash
node bin/bigset.js --bigset-url file:///absolute/path/to/bigset-build.zip
```

Release build assets are named by Node platform and architecture, for example
`bigset-build-darwin-arm64.zip`, `bigset-build-linux-x64.zip`, or
`bigset-build-win32-arm64.zip`.

Useful options:

```bash
bigset --force
bigset --home ~/.bigset-dev
bigset --app-port 4500 --backend-port 4501
bigset --keychain-port 3502
bigset --no-convex
```

Dataset commands:

```bash
bigset create "fintech startups in the bay area" --rows 10 --wait --csv demo.csv
bigset list
bigset status <datasetId>
bigset rows <datasetId> --json
bigset export <datasetId> --csv out.csv
bigset populate <datasetId>
bigset stop <datasetId>
```

Run `bigset` first and finish local setup in the browser before using dataset
commands.
