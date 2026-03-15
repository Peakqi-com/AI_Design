import { NextResponse } from "next/server";
import { getProjectById, updateProject } from "@/lib/crm/store";
import { dispatchProjectReminders } from "@/lib/projects/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DispatchBody = {
  force?: boolean;
  taskIds?: string[];
};

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const project = await getProjectById(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  let body: DispatchBody = {};
  try {
    body = (await request.json()) as DispatchBody;
  } catch {
    body = {};
  }

  const result = await dispatchProjectReminders({
    project,
    force: Boolean(body.force),
    taskIds: Array.isArray(body.taskIds) ? body.taskIds : [],
  });

  if (result.processed > 0) {
    await updateProject(projectId, { workflowTasks: result.nextWorkflowTasks });
  }

  return NextResponse.json({
    ok: true,
    result,
  });
}
