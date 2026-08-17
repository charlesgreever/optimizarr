# Homepage widget

[Homepage](https://github.com/gethomepage/homepage) on ubuntuserver can poll Optimizarr without a browser login cookie.

`GET /api/widget` (alias `GET /api/homepage`) returns stats only: running title and phase, queued count, pending review count, open suggestions, failed count, and library movie/episode counts. It never includes Arr API keys, player tokens, passwords, or file paths.

## Auth

Pick one:

1. **Widget key** (recommended). In Optimizarr Settings → Homepage widget, create a key. Homepage sends it as `X-Api-Key` or `Authorization: Bearer …`. The key is stored as a SHA-256 hash. Creating a new key replaces the old one.
2. **Environment.** Set `OPTIMIZARR_WIDGET_KEY` on the Optimizarr container to the same string Homepage sends.
3. **Local-address bypass.** If “Allow local addresses without a password” is on, a poll from a private LAN or Docker network IP works with no key. The payload is still stats-only.

A missing key and a public IP get `401`.

## Example `services.yaml`

Sit this on the Arr Stack group next to Radarr and Sonarr. Homepage `customapi` maps flat fields.

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

On `arr_net`, the URL can be `http://optimizarr:7373/api/widget`. Put the widget key in Homepage’s env as `HOMEPAGE_VAR_OPTIMIZARR_KEY`.

While a job runs, `status` looks like `Transcoding to HEVC · American Underdog`. When idle it is `Idle`, `3 waiting`, or `2 ready to review`. `runningTitle`, `runningPhase`, and `runningProgress` are also on the payload if you want extra mappings.
