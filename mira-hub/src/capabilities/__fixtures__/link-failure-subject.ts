/**
 * What the notebook chat route hands retrieval when a standalone LOOK is KNOWN in this conversation but its
 * link check THROWS (unknown authorization): one open subject with no text (the unverified descriptor is
 * never forwarded), flagged as asked-with-a-photo and as unclear. The route test asserts the route produces
 * exactly these; the real-SQL test feeds retrieveNodeChunks exactly these, so the refusal is proven on the
 * inputs the route really produces, not on a shaped flag.
 */
export const LINK_FAILURE_ROUTE_INPUTS = {
  subjectQueries: [""],
  subjectUnclear: [true],
  subjectPhoto: [true],
} as const;
