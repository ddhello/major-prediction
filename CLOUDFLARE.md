# Cloudflare Workers + KV Deployment

The project uses `worker.js` as the Worker entry point. It serves the Vite build
through the `ASSETS` binding and handles the state API directly.

Install and build:

```text
npm install
npm run build
```

Configure these bindings in the Cloudflare Worker dashboard:

- Secret `ADMIN_TOKEN`: administrator publishing token.
- KV namespace binding `MAJOR_STATE`: stores the published default simulator state.

Then deploy:

```text
npm run deploy
```

The Worker endpoints are `GET /api/state` and `POST /api/state`.
