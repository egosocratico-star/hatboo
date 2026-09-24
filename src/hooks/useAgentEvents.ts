import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWorkStore, type StepResult } from "../store/workStore";
import type { PendingApproval, Task } from "../types";

interface PlanEvent {
  conversationId: string;
  tasks: Task[];
}

interface ApprovalEvent extends PendingApproval {}

interface DoneEvent {
  conversationId: string;
  summary: string;
}

interface AgentErrorEvent {
  conversationId: string;
  message: string;
}

export function useAgentEvents() {
  useEffect(() => {
    const unlistenFns: Array<() => void> = [];
    // Mismo guard que useStreaming: listen() resuelve después del desmontaje.
    let disposed = false;

    const setup = async () => {
      const offs = await Promise.all([
        listen<PlanEvent>("agent:plan", ({ payload }) => {
          useWorkStore.getState().onPlan(payload.conversationId, payload.tasks);
        }),
        listen<StepResult>("agent:step_result", ({ payload }) => {
          useWorkStore.getState().onStepResult(payload);
        }),
        listen<ApprovalEvent>("agent:approval_needed", ({ payload }) => {
          useWorkStore.getState().onApprovalNeeded(payload);
        }),
        listen<{ conversationId: string; text: string }>(
          "agent:reasoning",
          ({ payload }) => {
            useWorkStore.getState().onReasoning(payload.conversationId, payload.text);
          },
        ),
        listen<{ conversationId: string; planId: string; tasks: unknown[] }>(
          "agent:plan_review",
          ({ payload }) => {
            useWorkStore.getState().onPlanReview({
              conversationId: payload.conversationId,
              planId: payload.planId,
              pasos: (payload.tasks as { description: string }[]).map((t) => t.description),
            });
          }
        ),
        listen<DoneEvent>("agent:done", ({ payload }) => {
          useWorkStore.getState().onDone(payload.conversationId, payload.summary);
        }),
        listen<AgentErrorEvent>("agent:error", ({ payload }) => {
          useWorkStore.getState().onError(payload.conversationId, payload.message);
        }),
        listen<AgentErrorEvent>("agent:cancelled", ({ payload }) => {
          useWorkStore.getState().onCancelled(payload.conversationId);
        }),
      ]);
      // Re-check de soporte de herramientas al montar (el proveedor pudo cambiar).
      void useWorkStore.getState().refreshToolSupport();
      return offs;
    };

    void setup().then((offs) => {
      if (disposed) {
        offs.forEach((fn) => fn());
        return;
      }
      unlistenFns.push(...offs);
    });
    return () => {
      disposed = true;
      unlistenFns.forEach((fn) => fn());
    };
  }, []);
}
