import { NextResponse } from "next/server";
import { isGoogleAiCredentialErrorMessage } from "@/lib/ai/google-provider";
import {
  generateInteriorCrmRecommendation,
  InteriorCrmRecommendationInput,
} from "@/lib/ai/interior-crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = Partial<InteriorCrmRecommendationInput>;

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const contact = body.contact;
  const survey = body.survey;
  if (!contact?.id || !contact?.displayName || !survey) {
    return NextResponse.json(
      { error: "contact.id, contact.displayName, survey are required." },
      { status: 400 },
    );
  }

  try {
    const result = await generateInteriorCrmRecommendation({
      contact: {
        id: String(contact.id),
        displayName: String(contact.displayName),
        tags: Array.isArray(contact.tags) ? contact.tags.map((tag) => String(tag)) : [],
        status: contact.status ? String(contact.status) : "new",
      },
      survey: survey as InteriorCrmRecommendationInput["survey"],
      conversationSummary: body.conversationSummary ? String(body.conversationSummary) : "",
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generate interior CRM recommendation failed.";
    const status = isGoogleAiCredentialErrorMessage(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
