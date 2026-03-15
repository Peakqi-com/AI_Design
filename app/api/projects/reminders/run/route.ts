import { NextResponse } from "next/server";
import { listProjects, updateProject } from "@/lib/crm/store";
import { dispatchProjectReminders } from "@/lib/projects/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunBody = {
  force?: boolean;
};

const AUTH_TOKEN = process.env.PROJECT_REMINDER_CRON_TOKEN || "";

const isAuthorized = (request: Request): boolean => {
  if (!AUTH_TOKEN) {
    return true;
  }
  const header = request.headers.get("x-cron-token") || "";
  return header === AUTH_TOKEN;
};

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: RunBody = {};
  try {
    body = (await request.json()) as RunBody;
  } catch {
    body = {};
  }

  const projects = await listProjects({ includeArchived: false });
  const results = [];
  let totalSent = 0;
  let totalFailed = 0;
  let totalProcessed = 0;

  for (const project of projects) {
    const dispatchResult = await dispatchProjectReminders({
      project,
      force: Boolean(body.force),
    });
    totalSent += dispatchResult.sent;
    totalFailed += dispatchResult.failed;
    totalProcessed += dispatchResult.processed;
    if (dispatchResult.processed > 0) {
      await updateProject(project.id, {
        workflowTasks: dispatchResult.nextWorkflowTasks,
      });
    }
    if (dispatchResult.processed > 0 || dispatchResult.failed > 0 || dispatchResult.sent > 0) {
      results.push(dispatchResult);
    }
  }

  return NextResponse.json({
    ok: true,
    summary: {
      projectsChecked: projects.length,
      remindersProcessed: totalProcessed,
      sent: totalSent,
      failed: totalFailed,
    },
    results,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
