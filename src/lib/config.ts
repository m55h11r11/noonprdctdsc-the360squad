// Shared constants. Kept here so tuning values doesn't require hunting through
// the component tree.

// How many of the user's most recent listings auto-populate as product cards
// when they return to the app. 5 fits on-screen without overwhelming first-time
// visitors who have no listings anyway.
export const RESTORE_RECENT_COUNT = 5;

// Maximum listings we'll fetch in a single GET /api/listings call. The client
// only materializes the top RESTORE_RECENT_COUNT (5) — the rest of the response
// is parsed and discarded. So this limit is effectively a defensive cap, not a
// product feature. Raised from 100 → 200 to give prolific users headroom before
// silent truncation. Revisit when the "browse all listings" page lands; at that
// point switch to keyset pagination on (created_at, id) desc with hasMore + cursor.
// TODO(browse-all-ui): replace with cursor pagination when GET /api/listings gains a paginated consumer.
export const LIST_FETCH_LIMIT = 200;
