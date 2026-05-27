# i18n message conventions

Messages live in `en.json`, `zh-CN.json`, and `ja.json` (inlang message-format).
`en` is the base locale. After editing any of them, regenerate the compiled
output with:

```sh
cd frontend && bun run paraglide:compile
```

> The convention note lives here, not in a JSON key. Paraglide only special-cases
> `$schema`; any other `$`-prefixed key (e.g. `$conventions`) is compiled into a
> real `m.*` message function, so it cannot be used for comments.

## Key naming

- Single-layer **snake_case** with a **domain prefix**:
  `common_`, `nav_`, `login_`, `downloads_`, `search_`, `filter_`, `ranking_`,
  `user_`, `home_`, `status_`, `error_`, `settings_`, `cfg_`.
- No nested objects — keys are flat, e.g. `error_rate_limited`,
  `settings_section_download`, `cfg_pixiv_proxy`.

## Params

- Use ICU-lite `{param}` syntax, e.g. `{count}`.

## Key-completeness

- Every key MUST exist in all three files (`en`, `zh-CN`, `ja`) with the same
  param shape. The `en` entry is authoritative for the param set.

## React usage

- Components subscribe to locale changes via `const m = useMessages()` (from
  `@/i18n`). Never `import { m }` at module scope.
- For lookups by key, use **explicit static maps** (`m.some_key`), never
  `m[dynamicKey]()` — dynamic indexing breaks tree-shaking and types.
