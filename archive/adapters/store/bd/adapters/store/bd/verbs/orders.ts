// The verbs that write fleet's two keys on an item: order.set and run.set,
// each one `--metadata` write of the one key it owns, and order.withdraw, the
// assignee and the order taken away in ONE fenced update — ported from
// tinyfleet's in-process adapter (core/src/store/bd/mod.rs at e416304,
// `order_set`, `order_withdraw`, `run_set`), measured on bd 1.3.0.
//
// EVERY TEXT RIDES AS `--flag=value` AND THE ID AFTER `--`, so neither an id
// nor a value opening with `-` is ever read as a flag of bd's.

import type { Order } from "../contract.d.ts";
import type { Handlers } from "../lib/answer.ts";
import type { Bd } from "../lib/bd.ts";
import { ORDERS, RUN, stamped } from "../lib/rows.ts";
import { fenced, holderNamed, written } from "../lib/write.ts";

/**
 * The order as it is written: its own fields, the seat LEFT OUT where the
 * order names none — never written `null` or empty, so an order naming no
 * seat reads back naming none.
 */
export function orderFields(order: Order): Record<string, unknown> {
  const { seat, ...rest } = order;
  return typeof seat === "string" ? { ...order } : rest;
}

/**
 * One `--metadata` write of `{"<key>": {…, "v": 1}}`. bd MERGES A METADATA
 * WRITE AT THE TOP LEVEL AND REPLACES THE ONE KEY'S OBJECT WHOLE — measured
 * on 1.3.0: `fleet.orders` written twice kept `fleet.run` beside it, and
 * another writer's bare `orders` and `a_prior_key` stood through both — so
 * order.set and run.set each write the key it owns and never erase the other
 * or anyone else's.
 */
export function metadataWrite(
  id: string,
  by: string,
  key: string,
  object: Record<string, unknown>,
): string[] {
  return [
    "update",
    `--metadata=${JSON.stringify(stamped(key, object))}`,
    `--actor=${by}`,
    "--",
    id,
  ];
}

/** The fence a withdrawal carries, as a request states it. */
export interface Fence {
  if_assignee?: string | null;
  if_status?: string | null;
  reopen?: boolean;
}

/**
 * The ONE `update` a withdrawal is: the fence, `--assignee=` (the empty
 * assignee is what clears the field), `--unset-metadata=fleet.orders` (the
 * one key taken away, every other standing) and, to reopen, `--status=open`
 * — measured on 1.3.0, where the one call left no `assignee` and no
 * `fleet.orders`, `fleet.run` and another writer's bare `orders` standing,
 * and an item its seat had closed open and in `bd ready` again.
 *
 * `if_assignee: null` is `--if-assignee=`, the fence on nobody holding the
 * item — measured: exit 13 on an item a seat held, naming it. Left out, no
 * fence. `if_status` left out or `null` is no status fence; `--if-status` is
 * what keeps a reopen off an item closed since it was read — measured, the
 * call without it reopened an item its holder had closed.
 */
export function withdrawal(id: string, by: string, fence: Fence): string[] {
  return [
    "update",
    ...(fence.if_assignee === undefined
      ? []
      : [`--if-assignee=${fence.if_assignee ?? ""}`]),
    ...(typeof fence.if_status === "string"
      ? [`--if-status=${fence.if_status}`]
      : []),
    "--assignee=",
    `--unset-metadata=${ORDERS}`,
    ...(fence.reopen === true ? ["--status=open"] : []),
    `--actor=${by}`,
    "--",
    id,
  ];
}

/**
 * What a withdrawal was fenced on, as its `moved` refusal says it — `held by
 * <seat>`, `closed`, `held by <seat> as in_progress` — or `undefined` where it
 * carries no fence.
 */
export function fencedOn(fence: Fence): string | undefined {
  const holder = fence.if_assignee === undefined
    ? undefined
    : holderNamed(fence.if_assignee ?? "");
  const status = typeof fence.if_status === "string"
    ? fence.if_status
    : undefined;
  if (holder === undefined) return status;
  return status === undefined
    ? `held by ${holder}`
    : `held by ${holder} as ${status}`;
}

/** order.set, run.set and order.withdraw over the store at a request's root. */
export function orders(open: (root: string) => Bd): Handlers {
  return {
    async "order.set"({ root, id, by, order }) {
      const args = metadataWrite(id, by, ORDERS, orderFields(order));
      await written(open(root), args);
      return {};
    },

    async "run.set"({ root, id, by, run }) {
      const args = metadataWrite(id, by, RUN, { ...run });
      await written(open(root), args);
      return {};
    },

    /**
     * EXIT 13 ANSWERS `moved`, and nothing of the withdrawal is written: bd
     * takes every flag of the one call or none. An unfenced withdrawal is a
     * plain write, whose only refusal is `missing`.
     */
    async "order.withdraw"({ root, id, by, ...fence }) {
      const bd = open(root);
      const args = withdrawal(id, by, fence);
      const on = fencedOn(fence);
      if (on === undefined) await written(bd, args);
      else await fenced(bd, args, id, on);
      return {};
    },
  };
}
