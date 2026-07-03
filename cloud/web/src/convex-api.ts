// Single choke-point for the cross-package import of the Convex generated API.
// Everything else imports these via the `@/` alias so the fragile relative
// path lives in exactly one place.
export { api } from "../../convex/_generated/api";
export type { Doc, Id } from "../../convex/_generated/dataModel";
