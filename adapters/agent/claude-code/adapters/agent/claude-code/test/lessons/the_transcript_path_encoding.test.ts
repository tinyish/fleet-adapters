// lessons C1 — the transcript path is an encoding, and one variable blinds
// every reader at once. Held on 2.1.280 (fleet-jymr.4, fleet-031): EVERY
// non-alphanumeric character of the worktree is a dash — a dot, an
// underscore and a space among them — and the directory is keyed on the
// RESOLVED worktree. A non-ASCII character was measured as one dash per
// UTF-16 unit, and a path past 200 characters as truncated and suffixed
// with a hash; this adapter reads neither yet (the first answers no path,
// the second finds no file), so each answers no reading rather than a guess.

import { assertEquals } from "@std/assert";
import { encodeProjectDir, transcriptPath } from "../../lib/transcript.ts";
import { CONTEXT_FIXTURES, contextCase } from "../lessons_support.ts";

const DOTTED = "-private-tmp-jymr4-rec-wt-a-b-c";
const D = "9a2bdfef-7532-4904-b713-24e1d98852c3";

Deno.test("lessons::the_transcript_path_encoding", () => {
  assertEquals(
    transcriptPath("/home/av/.claude", "/wt/builder-1", "aa-bb"),
    "/home/av/.claude/projects/-wt-builder-1/aa-bb.jsonl",
  );
  assertEquals(
    encodeProjectDir("/Users/av/.claude/jobs/tmp"),
    "-Users-av--claude-jobs-tmp",
    "a dot is a dash, and a dot after a separator is two",
  );
  assertEquals(
    encodeProjectDir("/wt/my_seat/a b.c"),
    "-wt-my-seat-a-b-c",
    "an underscore, a space and a dot are all dashes",
  );
  assertEquals(encodeProjectDir("plain123"), "plain123");
  assertEquals(
    transcriptPath("/home/av/.claude/", "/wt/b", "s"),
    "/home/av/.claude/projects/-wt-b/s.jsonl",
    "a config dir's trailing slash is not a second one",
  );
});

/**
 * The same rule, recorded: on 2.1.280 the session started in
 * `/private/tmp/jymr4-rec/wt a_b.c` wrote its transcript under
 * `-private-tmp-jymr4-rec-wt-a-b-c`, and `context` reads it there.
 */
Deno.test("lessons::the_transcript_path_encoding: the directory 2.1.280 wrote", async () => {
  assertEquals(encodeProjectDir("/private/tmp/jymr4-rec/wt a_b.c"), DOTTED);
  const path = transcriptPath(
    `${CONTEXT_FIXTURES}dotted-worktree/config`,
    "/private/tmp/jymr4-rec/wt a_b.c",
    D,
  )!;
  assertEquals(
    path,
    `${CONTEXT_FIXTURES}dotted-worktree/config/projects/${DOTTED}/${D}.jsonl`,
  );
  assertEquals((await Deno.stat(path)).isFile, true);
  const read = await contextCase("dotted-worktree");
  assertEquals(read.seats, read.expected);
  assertEquals(read.seats[0].tokens, 33122);
});

/**
 * What this adapter does not encode answers no path, never a guess: a
 * worktree with a character outside ASCII (measured on 2.1.280 as one dash
 * per UTF-16 unit, fleet-031, and not ported here), and a session id that
 * could name a file anywhere but the one directory. The no-reading fixture's
 * `é` worktree, whose dash-encoded directory does exist, answers its seat
 * alone.
 */
Deno.test("lessons::the_transcript_path_encoding: what is not encoded answers no path", async () => {
  assertEquals(transcriptPath("/c", "/wt/café", "s"), undefined);
  assertEquals(transcriptPath("/c", "/wt/🚀", "s"), undefined);
  for (const id of ["", "../x", "a/b", ".", "..", "a b"]) {
    assertEquals(transcriptPath("/c", "/wt/b", id), undefined, id);
  }
  const read = await contextCase("no-reading");
  assertEquals(read.seats, read.expected);
  assertEquals(read.seats[3], { seat: read.request.seats[3].seat });
  assertEquals(read.request.seats[3].worktree.endsWith("é"), true);
});
