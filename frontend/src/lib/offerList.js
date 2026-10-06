// Points offers on the customer screens: the cheapest first and only a few at a time, so the page stays short.
// The offer the customer picked always stays in view; "See all" shows the rest.
export const OFFER_LIMIT = 3;

export function shortOfferList(offers, { limit = OFFER_LIMIT, keepId = null, showAll = false } = {}) {
    const sorted = [...(offers || [])].sort((a, b) => (a.pointsRequired || 0) - (b.pointsRequired || 0));
    if (showAll || sorted.length <= limit) return { list: sorted, hidden: 0 };
    const idOf = (o) => o._id || o.id;
    const list = sorted.slice(0, limit);
    const kept = keepId && sorted.find(o => idOf(o) === keepId);
    if (kept && !list.includes(kept)) list.push(kept);
    return { list, hidden: sorted.length - list.length };
}
