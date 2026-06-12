# Cloudflare Pages Deployment

Build command:

```text
npm run build
```

Build output directory:

```text
dist
```

Configure these bindings in the Cloudflare Pages project:

- Environment variable `ADMIN_TOKEN`: administrator publishing token.
- KV namespace binding `MAJOR_STATE`: stores the published default simulator state.

The Pages Function endpoints are:

- `GET /api/state`: returns the published default state.
- `POST /api/state`: publishes the current state with `Authorization: Bearer <ADMIN_TOKEN>`.
