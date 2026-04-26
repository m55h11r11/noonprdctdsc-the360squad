// Shared constants. Kept here so tuning values doesn't require hunting through
// the component tree.

// How many of the user's most recent listings auto-populate as product cards
// when they return to the app. 5 fits on-screen without overwhelming first-time
// visitors who have no listings anyway.
export const RESTORE_RECENT_COUNT = 5;

// Maximum listings we'll fetch in a single GET /api/listings call.
export const LIST_FETCH_LIMIT = 100;
