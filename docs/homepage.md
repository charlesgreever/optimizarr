# Homepage widget

[Homepage](https://github.com/gethomepage/homepage) can poll Optimizarr without a browser login cookie.

`GET /api/widget` (alias `GET /api/homepage`) returns stats only: running title and phase, queued count, pending review count, open suggestions, failed count. It never includes Arr API keys, player tokens, passwords, or file paths.

This repository does not edit the household Homepage `services.yaml`. Copy the example below into that host yourself.

## Auth

Pick one:

1. **Widget key** (recommended). In Optimizarr Settings you can create a key. Homepage sends it as `X-Api-Key` or `Authorization: Bearer …`. The key is stored as a SHA-256 hash.
2. **Environment.** Set `OPTIMIZARR_WIDGET_KEY` on the Optimizarr container to the same string Homepage sends.
3. **Local-address bypass.** If “Allow local addresses without a password” is on, a poll from a private LAN or Docker network IP works with no key. The payload is still stats-only.

A missing key and a public IP get `401`.

## Field meanings

| Field | Meaning |
| --- | --- |
| `status` | One line such as `Working · American Underdog`, `3 waiting`, or `Idle` |
| `queued` | Jobs waiting or held for the off-peak window |
| `review` | Sidecars waiting for Keep or Discard |
| `suggestions` | Open work items |
| `failed` | Failed jobs |

## Example `services.yaml`

```yaml
- Arr Stack:
    - Optimizarr:
        icon: mdi-tune
        href: http://192.168.1.10:7373/queue
        description: Inspect and optimize Arr library files
        siteMonitor: http://192.168.1.10:7373/api/health
        widget:
          type: customapi
          url: http://192.168.1.10:7373/api/widget
          refreshInterval: 10000
          headers:
            X-Api-Key: "{{HOMEPAGE_VAR_OPTIMIZARR_KEY}}"
          mappings:
            - field: status
              label: Status
            - field: queued
              label: Queued
            - field: review
              label: Review
            - field: suggestions
              label: Suggestions
```
