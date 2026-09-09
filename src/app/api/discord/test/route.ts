import { NextResponse } from "next/server";
import { testDiscordWebhook, sendDiscordAlert } from "@/lib/discord-service";

export async function POST(req: Request) {
  try {
    let customUrl: string | undefined;

    // Check if optional custom webhook URL or message was provided in JSON body
    try {
      const body = await req.json();
      if (body && typeof body.url === "string") {
        customUrl = body.url;
      }
      if (body && body.title && body.description) {
        const customResult = await sendDiscordAlert({
          title: body.title,
          description: body.description,
          level: body.level || "test",
          fields: body.fields,
          bypassCooldown: true,
          url: customUrl,
        });

        const status =
          customResult.statusCode >= 200 && customResult.statusCode < 300
            ? 200
            : customResult.statusCode || 500;

        return NextResponse.json(customResult, { status });
      }
    } catch {
      // Body may be empty, which is completely valid for a test trigger
    }

    const result = await testDiscordWebhook(customUrl);
    const httpStatus =
      result.statusCode >= 200 && result.statusCode < 300
        ? 200
        : result.statusCode || 500;

    return NextResponse.json(result, { status: httpStatus });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        statusCode: 500,
        error: err.message || "Failed to execute Discord webhook test",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const result = await testDiscordWebhook();
    const httpStatus =
      result.statusCode >= 200 && result.statusCode < 300
        ? 200
        : result.statusCode || 500;

    return NextResponse.json(result, { status: httpStatus });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        statusCode: 500,
        error: err.message || "Failed to execute Discord webhook test",
      },
      { status: 500 }
    );
  }
}
