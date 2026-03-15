import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/crm/store";
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

type CreateProjectBody = {
  name?: string;
  clientName?: string;
  status?: CrmProject["status"];
  phase?: string;
  budget?: string;
  coverImageUrl?: string;
  linkedContactId?: string;
  note?: string;
  quotationItems?: ProjectQuotationItem[];
  dressSelectionRecords?: ProjectDressSelectionRecord[];
  quotationMeta?: ProjectQuotationMeta;
  workflowTasks?: ProjectWorkflowTask[];
  auspiciousPlan?: ProjectAuspiciousPlan;
  notificationEmail?: string;
  notificationTemplates?: ProjectNotificationTemplate[];
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? undefined;
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const includeFiled = url.searchParams.get("includeFiled") === "1";
  const includeDeleted = url.searchParams.get("includeDeleted") === "1";
  const projects = await listProjects({ search, includeArchived, includeFiled, includeDeleted });
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  let body: CreateProjectBody;
  try {
    body = (await request.json()) as CreateProjectBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = body.name?.trim() || "";
  const clientName = body.clientName?.trim() || "";
  const phase = body.phase?.trim() || "婚禮諮詢";
  const budget = body.budget?.trim() || "待定";
  const status = body.status || "draft";

  if (!name || !clientName) {
    return NextResponse.json({ error: "name and clientName are required." }, { status: 400 });
  }
  if (!PROJECT_STATUS_SET.has(status)) {
    return NextResponse.json({ error: "Unsupported project status." }, { status: 400 });
  }

  try {
    const project = await createProject({
      name,
      clientName,
      status,
      phase,
      budget,
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
    return NextResponse.json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Create project failed.";
    const statusCode = /linked contact not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
