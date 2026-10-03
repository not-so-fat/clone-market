import { z } from "zod/v4";

import { contractSchemas } from "./schemas.js";

export const jsonSchemas = Object.fromEntries(
  Object.entries(contractSchemas).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema, { target: "draft-2020-12" }),
  ]),
) as Readonly<Record<keyof typeof contractSchemas, Record<string, unknown>>>;
