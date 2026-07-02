import { httpRouter } from "convex/server";
import { authKit } from "./auth";

const http = httpRouter();
// Mounts the WorkOS webhook receiver at /workos/webhook so the component
// can sync user create/update/delete events into its user table.
authKit.registerRoutes(http);
export default http;
