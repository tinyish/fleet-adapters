// Where the plugin's skills are, and where the copies of tiny's come from
// (scripts/skills.ts; test/plugin_test.ts). Neither is read by a verb.

import { pluginDir } from "./plugin.ts";

/** The plugin's own skills, which are not tiny's: the version probe. */
export const PLUGIN_OWN_SKILLS = ["version"];

/** The plugin's skills directory. */
export function pluginSkills(): string {
  return `${pluginDir()}/skills`;
}

/**
 * The tiny pack's skills in this repository: tiny/ at its root, six
 * directories above this adapter's (adapters/agent/claude-code/adapters/
 * agent/claude-code/). Only a checkout of fleet-packs has one there; an
 * installed pack sits alone under <machine>/packs/.
 */
export function tinySkills(): string {
  return decodeURIComponent(
    new URL("../../../../../../../tiny/skills", import.meta.url).pathname,
  );
}
