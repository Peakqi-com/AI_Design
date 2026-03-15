import { NextResponse } from "next/server";
import { deleteProject, getProjectById, updateProject } from "@/lib/crm/store";
import {
  CrmProject,
  ProjectAuspiciousPlan,
  ProjectDressSelectionRecord,
  ProjectNotificationTemplate,
  ProjectQuotationItem,
  ProjectQuotationMeta,
  ProjectWorkflowTask,
} from "@/lib/crm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT_STATUS_SET = new Set<CrmProject["status"]>([
  "draft",
  "active",
  "quoted",
  "completed",
]);

type UpdateProjectBody = {
  name?: string;
  clientName?: string;
  status?: CrmProject["status"];
  phase?: string;
  budget?: string;
  coverImageUrl?: string;
  linkedContactId?: string | null;
  note?: string;
  quotationItems?: ProjectQuotationItem[];
  dressSelectionRecords?: ProjectDressSelectionRecord[];
  quotationMeta?: ProjectQuotationMeta;
  workflowTasks?: ProjectWorkflowTask[];
  auspiciousPlan?: ProjectAuspiciousPlan;
  notificationEmail?: string;
  notificationTemplates?: ProjectNotificationTemplate[];
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const project = await getProjectById(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  return NextResponse.json({ project });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  let body: UpdateProjectBody;
  try {
    body = (await request.json()) as UpdateProjectBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.status && !PROJECT_STATUS_SET.has(body.status)) {
    return NextResponse.json({ error: "Unsupported project status." }, { status: 400 });
  }

  try {
    const project = await updateProject(projectId, {
      name: body.name,
      clientName: body.clientName,
      status: body.status,
      phase: body.phase,
      budget: body.budget,
      coverImageUrl: body.coverImageUrl,
      linkedContactId: body.linkedContactId,
      note: body.note,
      quotationItems: body.quotationItems,
      dressSelectionRecords: body.dressSelectionRecords,
      quotationMeta: body.quotationMeta,
      workflowTasks: body.workflowTasks,
      auspiciousPlan: body.auspiciousPlan,
      notificationEmail: body.notificationEmail,
      notificationTemplates: body.notificationTemplates,
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    return NextResponse.json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update project failed.";
    const statusCode = /linked contact not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const removed = await deleteProject(projectId);
  if (!removed) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
