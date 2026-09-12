/**
 * V6 data layer — loads Projects, Machines, and Threads.
 *
 * Bridges the notebook-based backend to the Project-centric V6 mental model.
 * Projects can represent machines/assets/jobs and contain threads.
 */
import type { Machine, Project, Message } from "@factorylm/interaction";
import { listNotebooks, type Notebook } from "../api/resources";

export interface V6Thread {
  readonly id: string;
  readonly label: string;
  readonly projectId?: string;
  readonly machineId?: string;
  readonly messages: readonly Message[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Load Projects from backend.
 * 
 * For MVP: bridges notebooks to projects. A notebook becomes a project if it
 * has a bound machine, otherwise threads go in a "General" project.
 */
export async function v6Projects(): Promise<readonly Project[]> {
  try {
    const notebooks = await listNotebooks();
    const projects: Project[] = [];
    
    // Create projects from notebooks with machines
    for (const notebook of notebooks) {
      if (notebook.machineId) {
        projects.push({
          id: `project-${notebook.id}`,
          name: notebook.machineName || notebook.name,
          children: [
            {
              kind: "machine-link",
              id: `machine-link-${notebook.machineId}`,
              machineId: notebook.machineId,
              label: notebook.machineName || notebook.name,
            },
            {
              kind: "thread",
              id: notebook.id,
              label: notebook.name,
            },
          ],
        });
      }
    }
    
    // Create a "General" project for threads without machines
    const generalThreads = notebooks
      .filter((nb) => !nb.machineId)
      .map((nb) => ({
        kind: "thread" as const,
        id: nb.id,
        label: nb.name,
      }));
    
    if (generalThreads.length > 0) {
      projects.push({
        id: "project-general",
        name: "General",
        children: generalThreads,
      });
    }
    
    return projects;
  } catch (error) {
    console.error("[V6] failed to load projects", error);
    // Return empty array rather than throwing - let the UI handle gracefully
    return [];
  }
}

/**
 * Load Machines from backend.
 * 
 * For MVP: extracts unique machines from notebooks. In future, this will
 * come from a dedicated machines/assets endpoint.
 */
export async function v6Machines(): Promise<readonly Machine[]> {
  try {
    const notebooks = await listNotebooks();
    const machineMap = new Map<string, Machine>();
    
    for (const notebook of notebooks) {
      if (notebook.machineId && !machineMap.has(notebook.machineId)) {
        machineMap.set(notebook.machineId, {
          id: notebook.machineId,
          name: notebook.machineName || "Unknown Machine",
          status: "unknown",
        });
      }
    }
    
    return Array.from(machineMap.values());
  } catch (error) {
    console.error("[V6] failed to load machines", error);
    return [];
  }
}

/**
 * Load a single thread's messages.
 * 
 * For MVP: placeholder that will be wired to the chat backend.
 */
export async function v6LoadThread(threadId: string): Promise<V6Thread | null> {
  // TODO: Implement thread loading from backend
  console.log("[V6] loading thread:", threadId);
  return null;
}

/**
 * Send a message in no-machine mode.
 * 
 * Supports asking general questions like "What is a VFD?" without selecting
 * a machine first.
 */
export async function v6SendNoMachine(
  text: string,
  threadId?: string,
): Promise<{ threadId: string; message: Message }> {
  // TODO: Implement no-machine send to backend
  console.log("[V6] no-machine send:", text, "thread:", threadId);
  throw new Error("Not implemented");
}

/**
 * Send a message with machine context.
 * 
 * When a machine is selected, the question is scoped to that machine's
 * documentation and history.
 */
export async function v6SendWithMachine(
  text: string,
  machineId: string,
  threadId?: string,
): Promise<{ threadId: string; message: Message }> {
  // TODO: Implement machine-scoped send to backend
  console.log("[V6] machine-scoped send:", text, "machine:", machineId, "thread:", threadId);
  throw new Error("Not implemented");
}
