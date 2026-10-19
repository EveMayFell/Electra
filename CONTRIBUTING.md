# Contributing to ELECTRA

ELECTRA is a zero-backend, vanilla JavaScript / SVG power-system workstation. There
is no bundler in the runtime path: the browser loads ES modules directly from `js/`.

## Development

```bash
python -m http.server 5188 --bind 127.0.0.1
# open http://127.0.0.1:5188/
```

Use a modern Chrome, Edge or Firefox. Do not open `index.html` through `file://`;
ES modules require HTTP.

## Tests

```bash
node --test tests/engine.test.mjs
```

The engine suite is designed to run without a browser and without dependencies.
Please add a focused regression test for every numerical or protection change.

## Code map

| Path | Responsibility |
|---|---|
| `js/model.js` | project schema, factory helpers, validation, persistence |
| `js/engine/` | power flow, short circuit, protection, reclose, stability, regulation |
| `js/ui/` | SVG editor, pages, charts, modals, report |
| `js/data/` | examples and protection catalog |
| `tests/` | engine tests |

## Pull requests

- Keep numerical changes isolated and explain the assumptions in the PR.
- Preserve existing example projects and screenshots where possible.
- Run the full test suite and a browser smoke test.
- Do not commit credentials, private project data or generated release archives.

By contributing you agree that your contribution is licensed under the MIT License.
