/**
 * Step-through debug service — pause, inspect, approve/reject agent actions.
 *
 * Flow:
 *   1. Agent calls debugHold(action) → publishes pending action, blocks
 *   2. Approver calls debugList() → sees pending actions
 *   3. Approver calls debugApprove(id) or debugReject(id, reason)
 *   4. Agent unblocks, receives decision, proceeds or returns error
 *
 * Built on Redis:
 *   debug:{project}:pending:{id}    — JSON of the proposed action
 *   debug:{project}:decision:{id}   — "approved" or "rejected:{reason}"
 *   debug:{project}:pending_ids     — list of pending action IDs
 *
 * The agent-side function (debugHold) polls Redis for a decision.
 * Polling interval is 500ms. Timeout is configurable (default 5 min).
 */
import { getRedis } from "./redis.js";
import { withSpan, spanAttrs } from "../lib/tracing.js";

export interface PendingAction {
  id: string;
  project: string;
  agent: string;
  tool: string;
  args: Record<string, unknown>;
  context: string;
  created_at: string;
}

export interface DebugDecision {
  action_id: string;
  decision: "approved" | "rejected";
  reason?: string;
  decided_at: string;
}

const POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_S = 300; // 5 minutes
const PENDING_TTL_S = 600;    // Pending actions expire after 10 minutes

function pendingKey(project: string, id: string): string {
  return `debug:${project}:pending:${id}`;
}
function decisionKey(project: string, id: string): string {
  return `debug:${project}:decision:${id}`;
}
function pendingListKey(project: string): string {
  return `debug:${project}:pending_ids`;
}
function modeKey(project: string): string {
  return `debug:${project}:enabled`;
}

// ── Mode Control ─────────────────────────────────────────

/**
 * Enable or disable debug mode for a project.
 * When disabled, debugHold() is a no-op (returns approved immediately).
 */
export async function setDebugMode(project: string, enabled: boolean): Promise<void> {
  const redis = getRedis("bus");
  if (enabled) {
    await redis.set(modeKey(project), "1");
  } else {
    await redis.del(modeKey(project));
    // Clear all pending actions when disabling
    await clearPending(project);
  }
}

export async function isDebugEnabled(project: string): Promise<boolean> {
  const redis = getRedis("bus");
  return (await redis.get(modeKey(project))) === "1";
}

// ── Agent Side (called by the agent before executing a tool) ──

/**
 * Hold execution for approval. Blocks until approved, rejected, or timeout.
 *
 * Call this from the agent's tool handler BEFORE executing the tool.
 * If debug mode is off, returns immediately with approved=true.
 *
 * Returns the decision. The agent should check decision.decision
 * and either proceed (approved) or return the rejection reason.
 */
export async function debugHold(
  project: string,
  agent: string,
  tool: string,
  args: Record<string, unknown>,
  context: string = "",
  timeoutSec: number = DEFAULT_TIMEOUT_S
): Promise<DebugDecision> {
  // Skip if debug mode is off
  if (!(await isDebugEnabled(project))) {
    return {
      action_id: "auto",
      decision: "approved",
      decided_at: new Date().toISOString(),
    };
  }

  return withSpan(
    "debug.hold",
    { ...spanAttrs.agentTool(project, `debug:${tool}`), "debug.agent": agent },
    async (span) => {
      const redis = getRedis("bus");
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const action: PendingAction = {
        id,
        project,
        agent,
        tool,
        args,
        context,
        created_at: new Date().toISOString(),
      };

      // Store the pending action
      await redis.set(pendingKey(project, id), JSON.stringify(action), "EX", PENDING_TTL_S);
      await redis.rpush(pendingListKey(project), id);

      // Notify via pub/sub so watchers see it immediately
      await redis.publish(`debug:${project}:notify`, JSON.stringify(action));

      span.setAttribute("debug.action_id", id);
      span.setAttribute("debug.tool", tool);

      // Poll for decision
      const deadline = Date.now() + timeoutSec * 1000;
      while (Date.now() < deadline) {
        const raw = await redis.get(decisionKey(project, id));
        if (raw) {
          // Clean up
          await redis.del(pendingKey(project, id), decisionKey(project, id));
          await redis.lrem(pendingListKey(project), 0, id);

          const isApproved = raw === "approved";
          const decision: DebugDecision = {
            action_id: id,
            decision: isApproved ? "approved" : "rejected",
            reason: isApproved ? undefined : raw.replace("rejected:", ""),
            decided_at: new Date().toISOString(),
          };

          span.setAttribute("debug.decision", decision.decision);
          return decision;
        }

        await sleep(POLL_INTERVAL_MS);
      }

      // Timeout — treat as rejection
      await redis.del(pendingKey(project, id));
      await redis.lrem(pendingListKey(project), 0, id);

      span.setAttribute("debug.decision", "timeout");
      return {
        action_id: id,
        decision: "rejected",
        reason: `Timeout after ${timeoutSec}s — no approval received`,
        decided_at: new Date().toISOString(),
      };
    }
  );
}

// ── Approver Side (called by Claude Code or human) ───────

/**
 * List all pending actions awaiting approval.
 */
export async function debugListPending(project: string): Promise<PendingAction[]> {
  const redis = getRedis("bus");
  const ids = await redis.lrange(pendingListKey(project), 0, -1);
  const actions: PendingAction[] = [];

  for (const id of ids) {
    const raw = await redis.get(pendingKey(project, id));
    if (raw) {
      try {
        actions.push(JSON.parse(raw) as PendingAction);
      } catch {
        // expired or malformed — clean up
        await redis.lrem(pendingListKey(project), 0, id);
      }
    } else {
      // Key expired — clean up the list
      await redis.lrem(pendingListKey(project), 0, id);
    }
  }

  return actions;
}

/**
 * Approve a pending action. The agent unblocks and proceeds.
 */
export async function debugApprove(project: string, actionId: string): Promise<boolean> {
  const redis = getRedis("bus");
  const exists = await redis.exists(pendingKey(project, actionId));
  if (!exists) return false;

  await redis.set(decisionKey(project, actionId), "approved", "EX", 60);
  return true;
}

/**
 * Reject a pending action. The agent unblocks with the rejection reason.
 */
export async function debugReject(
  project: string,
  actionId: string,
  reason: string = "Rejected by approver"
): Promise<boolean> {
  const redis = getRedis("bus");
  const exists = await redis.exists(pendingKey(project, actionId));
  if (!exists) return false;

  await redis.set(decisionKey(project, actionId), `rejected:${reason}`, "EX", 60);
  return true;
}

/**
 * Approve all pending actions at once.
 */
export async function debugApproveAll(project: string): Promise<number> {
  const pending = await debugListPending(project);
  let count = 0;
  for (const action of pending) {
    if (await debugApprove(project, action.id)) count++;
  }
  return count;
}

/**
 * Clear all pending actions (without approving or rejecting).
 */
async function clearPending(project: string): Promise<void> {
  const redis = getRedis("bus");
  const ids = await redis.lrange(pendingListKey(project), 0, -1);
  for (const id of ids) {
    await redis.del(pendingKey(project, id), decisionKey(project, id));
  }
  await redis.del(pendingListKey(project));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
