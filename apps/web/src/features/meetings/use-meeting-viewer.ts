"use client";

import { useMemo } from "react";
import type { MeetingViewer } from "@workspace/shared";
import { useWorkspace } from "@/components/workspace/workspace-context";

/**
 * The reader as the meeting rules need them (ADR 0051 "Part 3", safest option 5): the id the server
 * names them by (`viewerUserId`), never the demo persona's fixture id, with the keys and data scope
 * of the shell's effective access. In api mode that access is the guard's own, from GET /company
 * (ADR 0051, "GET /company"); the server still decides every action again.
 */
export function useMeetingViewer(userId: string): MeetingViewer {
  const { access } = useWorkspace();
  return useMemo(
    () => ({ userId, permissions: access.permissions, dataScope: access.dataScope }),
    [userId, access.permissions, access.dataScope],
  );
}
