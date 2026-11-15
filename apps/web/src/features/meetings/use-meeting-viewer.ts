"use client";

import { useMemo } from "react";
import type { MeetingViewer } from "@workspace/shared";
import { useWorkspace } from "@/components/workspace/workspace-context";

/**
 * The reader as the meeting rules need them (ADR 0051 "Part 3", safest option 5): the id the server
 * names them by (`viewerUserId`), never the demo persona's fixture id, with the keys and data scope
 * of the shell's effective access. In api mode those keys still come from the shell's roles until
 * the roles move to the API (risk R1), so a screen may hide or offer a control the server then
 * decides on; the server decides every action again.
 */
export function useMeetingViewer(userId: string): MeetingViewer {
  const { access } = useWorkspace();
  return useMemo(
    () => ({ userId, permissions: access.permissions, dataScope: access.dataScope }),
    [userId, access.permissions, access.dataScope],
  );
}
