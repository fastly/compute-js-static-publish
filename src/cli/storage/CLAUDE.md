# CLI storage providers

KV batch endpoint behavior (measured, not documented):

- No limit on the item count up to 25,000 items. No limit on the request size up to 133 MiB.
- A limit of approximately 32 MiB for each NDJSON line. A longer line causes a `503`. The lines before it are stored.
- A `207` response lists the failed keys in `errors[].key`. The CLI retries only these keys.
