// `deno task skills`: the tiny pack's skills copied into the plugin, so a
// seat's session loads the rituals — /wake {seat} among them — from the
// plugin launch hands it.
//
// COPIES, NOT LINKS (fleet-jymr.5's first measurement, Claude Code 2.1.280,
// 2026-09-26): relative links from plugin/skills/ into this repository's
// tiny/skills/ survive a marketplace install, whose copy into Claude Code's
// plugin cache follows them, but NOT `fleet pack add`, which installs this
// pack's directory alone under <machine>/packs/claude-code, where every link
// climbing out of it resolves nowhere — and that directory is the plugin
// every seat is launched with. So the skills are copied here, committed, and
// test/plugin_test.ts holds each copy byte for byte to tiny/skills/: a skill
// changed in tiny and not copied reds the suite. Run this after changing one.
//
// plugin/skills/version is the plugin's own probe, not tiny's, and is left
// alone; every other entry is replaced by tiny's.

import { PLUGIN_OWN_SKILLS, pluginSkills, tinySkills } from "../lib/skills.ts";

async function copyTree(from: string, to: string) {
  await Deno.mkdir(to, { recursive: true });
  for await (const entry of Deno.readDir(from)) {
    const source = `${from}/${entry.name}`;
    const target = `${to}/${entry.name}`;
    if (entry.isDirectory) await copyTree(source, target);
    else if (entry.isFile) await Deno.copyFile(source, target);
    else throw new Error(`${source} is neither a file nor a directory`);
  }
}

const tiny = tinySkills();
const plugin = pluginSkills();
for await (const entry of Deno.readDir(plugin)) {
  if (PLUGIN_OWN_SKILLS.includes(entry.name)) continue;
  await Deno.remove(`${plugin}/${entry.name}`, { recursive: true });
}
for await (const entry of Deno.readDir(tiny)) {
  if (!entry.isDirectory) continue;
  await copyTree(`${tiny}/${entry.name}`, `${plugin}/${entry.name}`);
  console.log(`copied ${entry.name}`);
}
