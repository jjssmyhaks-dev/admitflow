// Client-safe role permissions (no server imports). The server enforces the
// same tiers in src/lib/authz.ts — this module only drives UI affordances.
import type { Role } from "@/lib/types";

export type Perm = "read" | "write" | "manage";

const RANK: Record<Role, number> = { viewer: 0, counselor: 1, admin: 2, owner: 3 };
const NEED: Record<Perm, number> = { read: 0, write: 1, manage: 2 };

/** read: viewer+ · write: counselor+ · manage: admin+ */
export function can(role: Role, perm: Perm): boolean {
  return RANK[role] >= NEED[perm];
}

export const ROLE_HINT: Record<Perm, string> = {
  read: "",
  write: "Your role can view but not change this.",
  manage: "Only admins and owners can change this.",
};
