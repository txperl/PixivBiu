import createClient from "openapi-fetch";
import type { paths } from "./schema.gen";

export const api = createClient<paths>({ baseUrl: "/api/v1" });
