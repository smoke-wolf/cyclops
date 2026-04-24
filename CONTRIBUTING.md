# Contributing to CYCLOPS

Thanks for your interest in contributing.

## Adding a Connector

The fastest way to contribute is adding a new OSINT connector.

1. Create `src/connectors/your_connector.js` extending `BaseConnector`
2. Implement `run(investigationId, phaseId, inputType, inputValue)` — return entities
3. Implement `healthCheck()` — return `{ ok: true/false }`
4. Add the connector definition to `config/connectors.json`
5. Add it to relevant workflow phases in `config/workflows.json`
6. Add a test in `test/run.js`

Look at `src/connectors/ip_api.js` for a clean native connector example, or `src/connectors/base.js` for the binary connector pattern.

### Connector Rules

- Native connectors use Node.js `http`/`https` directly — no external dependencies
- Binary connectors shell out to installed tools and parse their output
- Always handle rate limiting (HTTP 429) gracefully
- Always set timeouts on HTTP requests
- Always wrap `JSON.parse()` in try/catch
- Return entities with a `confidence` score between 0 and 1
- Use `source` field in entity data to identify your connector

## Adding an Entity Type

1. Add the type definition to `config/correlation.json` under `entity_types`
2. Add linking rules if it should correlate with other types
3. Update `_entityLabel()` in `src/correlate/linker.js`

## Running Tests

```bash
npm test          # full suite (41 tests, ~60s)
```

Tests hit live APIs (GitHub, DNS, WHOIS, etc.), so they require internet access. External service tests skip gracefully if the service is down.

## Code Style

- ESM modules (`import`/`export`)
- No comments unless the WHY is non-obvious
- No unnecessary abstractions
- Keep it simple

## Pull Requests

- One feature or fix per PR
- Include a test
- Make sure `npm test` passes
