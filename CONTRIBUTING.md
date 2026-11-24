# Contributing

Thanks for helping improve Advanced Store.

## Development setup

- Use Node.js 24 or newer.
- Run `npm ci`.
- Run `npm run setup` to create a local `.env`.
- Start the API with `npm run dev`.
- Start the web app with `npm run frontend:dev`.

## Before opening a pull request

- Run `npm run check`.
- Run `npm run frontend:build`.
- Keep migrations additive. Do not edit a migration after it has shipped.
- Add or update documentation when an API contract changes.
- Do not commit secrets, customer data, or real payment credentials.
- Keep changes focused and describe what they change and how you verified them.
