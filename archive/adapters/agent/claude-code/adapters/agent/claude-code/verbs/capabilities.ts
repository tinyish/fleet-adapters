// `capabilities`: the declaration, whole, from lib/capabilities.ts. It runs
// no claude, so it answers where no Claude Code is installed.

import type { Handler } from "../lib/answer.ts";
import { CAPABILITIES } from "../lib/capabilities.ts";

export const capabilities: Handler<"capabilities"> = () =>
  Promise.resolve(CAPABILITIES);
