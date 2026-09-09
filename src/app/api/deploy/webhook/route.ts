import { NextResponse } from "next/server";
import crypto from "crypto";
import {
  triggerDeployment,
  extractBranch,
} from "@/lib/deploy-service";

export async function POST(req: Request) {
  try {
    const eventHeader = req.headers.get("x-github-event") || "push";
    const signatureHeader = req.headers.get("x-hub-signature-256");

    let rawBody = "";
    try {
      rawBody = await req.text();
    } catch {
      return NextResponse.json(
        { success: false, error: "Failed to read request body" },
        { status: 400 }
      );
    }

    if (!rawBody || rawBody.trim() === "") {
      return NextResponse.json(
        { success: false, error: "Invalid JSON payload: body is empty" },
        { status: 400 }
      );
    }

    // Required HMAC signature check if secret is configured in environment
    const secret = process.env.DEPLOY_WEBHOOK_SECRET;
    if (secret) {
      if (!signatureHeader) {
        return NextResponse.json(
          { success: false, error: "Invalid webhook signature" },
          { status: 401 }
        );
      }

      const hmac = crypto.createHmac("sha256", secret);
      const digest = "sha256=" + hmac.update(rawBody).digest("hex");

      const sigBuf = Buffer.from(signatureHeader);
      const digestBuf = Buffer.from(digest);

      if (sigBuf.length !== digestBuf.length || !crypto.timingSafeEqual(sigBuf, digestBuf)) {
        return NextResponse.json(
          { success: false, error: "Invalid webhook signature" },
          { status: 401 }
        );
      }
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    // Handle GitHub Ping event
    if (eventHeader === "ping" || (payload && typeof payload.zen === "string" && !payload.ref)) {
      return NextResponse.json(
        {
          success: true,
          message: "Pong! Webhook active",
          zen: payload.zen || "Approachable is better than simple.",
        },
        { status: 200 }
      );
    }

    // Check branch filter
    const targetBranch = process.env.DEPLOY_BRANCH || "main";
    const payloadBranch = extractBranch(payload);

    // If payload branch does not match target branch, reject deployment gracefully
    if (payloadBranch !== targetBranch) {
      return NextResponse.json(
        {
          success: true,
          message: `Push ignored: branch ${payloadBranch} does not match target branch ${targetBranch}`,
          deployed: false,
        },
        { status: 200 }
      );
    }

    // Trigger deployment in background (asynchronously)
    const { deployment } = triggerDeployment(payload);

    return NextResponse.json(
      {
        success: true,
        message: "Deployment triggered",
        deploymentId: deployment.id,
        branch: deployment.branch,
        status: deployment.status,
        mode: deployment.mode,
      },
      { status: 202 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

export async function PUT() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

export async function DELETE() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
