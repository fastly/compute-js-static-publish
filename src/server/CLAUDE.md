# CLAUDE.md (server)

## PublisherServer request flow

`src/server/publisher-server/index.ts`:

1. Select the active collection. This is the default collection, or the collection from `setActiveCollectionName`. The helpers are in `collection-selector/` (for example host, cookie, config store).
   `beginRequest()` resets the per-request state: the `Server-Timing` collector (`util/server-timing.ts`), which is on only if `setServerTimingRequestHeader()` names a header that the request has.
2. If `setResponseCache()` is set, `serveCached()` (`response-cache.ts`) looks up the whole response in the Core Cache, keyed by publish ID, collection, path, and normalized `Accept-Encoding`. A hit skips steps 3 to 8. A miss uses `transactionLookup()`, so concurrent misses wait for one fill. The fill runs steps 3 to 8 with a `GET` that has no conditional headers, and caches a `200`, a `404`, or "not found". Conditional requests and `HEAD` are then answered from the cached response. The fill reads the whole body (`readBodyUpTo()`) before `insert()`, and calls `cancel()` if the read fails. A body larger than `maxBodySize` gets a "too large" marker entry, and is served from storage. Do not stream into the entry with `insertAndStreamBack()`: on a real service, a fill that is short, abandoned, or not closed is not stored, but the filler and the waiters still get a short body that ends as if complete. Viceroy is different again: it stores such a fill.
   `serveAsset()` passes the stored body through `checkBodyLength()` (`util/body-length.ts`), which compares it with the variant's `size`. An empty body throws before the response starts. Any other mismatch stops the stream with an error, which resets the response on a real service.
3. Load the settings and the index for that collection, and keep them in a cache. An expired collection is the same as a collection that does not exist. If the default collection has no settings, the response is a 500. For another collection that has no settings or no usable index, the response is a plain-text 404 that names the collection, and `doNotStoreResponse` keeps `serveCached()` from storing it.
4. to 8. Find the file, select the encoding, process the conditional headers, and set the cache headers (see the code).
