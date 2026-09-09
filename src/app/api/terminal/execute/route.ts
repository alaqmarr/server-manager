import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { exec, type ExecException } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const authResult = await requireAdmin(req);
    if (authResult.error) {
      return authResult.error;
    }

    let body: { command?: unknown; cwd?: unknown } | null = null;
    try {
      body = (await req.json()) as { command?: unknown; cwd?: unknown };
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON or missing request body" },
        { status: 400 }
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      body.command === undefined ||
      typeof body.command !== "string"
    ) {
      return NextResponse.json(
        { error: "Missing or non-string command" },
        { status: 400 }
      );
    }

    const command = body.command;

    // Determine initial working directory
    let effectiveCwd = process.cwd();
    if (body.cwd && typeof body.cwd === "string" && body.cwd.trim() !== "") {
      try {
        const candidate = path.resolve(body.cwd);
        if (
          fs.existsSync(/*turbopackIgnore: true*/ candidate) &&
          fs.statSync(/*turbopackIgnore: true*/ candidate).isDirectory()
        ) {
          effectiveCwd = candidate;
        } else {
          return NextResponse.json(
            {
              stdout: "",
              stderr: `Directory does not exist: ${body.cwd}`,
              exitCode: 1,
              cwd: process.cwd(),
            },
            { status: 200 }
          );
        }
      } catch {
        return NextResponse.json(
          {
            stdout: "",
            stderr: `Invalid directory path: ${body.cwd}`,
            exitCode: 1,
            cwd: process.cwd(),
          },
          { status: 200 }
        );
      }
    }

    const trimmedCommand = command.trim();

    // Handle empty command
    if (trimmedCommand === "") {
      return NextResponse.json(
        {
          stdout: "",
          stderr: "",
          exitCode: 0,
          cwd: effectiveCwd,
        },
        { status: 200 }
      );
    }

    // Directory navigation (cd)
    // Only handle pure directory changes, not commands chained with &&, ||, ;, or |
    const isChained = /[;&|]/.test(trimmedCommand);
    if (!isChained && (trimmedCommand === "cd" || /^cd[\s\t]/.test(trimmedCommand))) {
      let targetPath = trimmedCommand === "cd" ? "" : trimmedCommand.slice(2).trim();
      // Remove enclosing quotes if any
      if (
        (targetPath.startsWith('"') && targetPath.endsWith('"')) ||
        (targetPath.startsWith("'") && targetPath.endsWith("'"))
      ) {
        targetPath = targetPath.slice(1, -1).trim();
      }

      let resolvedPath: string;
      if (!targetPath || targetPath === "~") {
        resolvedPath = os.homedir();
      } else if (targetPath.startsWith("~/") || targetPath.startsWith("~\\")) {
        resolvedPath = path.join(os.homedir(), targetPath.slice(2));
      } else {
        resolvedPath = path.resolve(effectiveCwd, targetPath);
      }

      try {
        const stat = fs.statSync(/*turbopackIgnore: true*/ resolvedPath);
        if (!stat.isDirectory()) {
          return NextResponse.json(
            {
              stdout: "",
              stderr: `cd: not a directory: ${targetPath}`,
              exitCode: 1,
              cwd: effectiveCwd,
            },
            { status: 200 }
          );
        }
        return NextResponse.json(
          {
            stdout: "",
            stderr: "",
            exitCode: 0,
            cwd: resolvedPath,
          },
          { status: 200 }
        );
      } catch {
        return NextResponse.json(
          {
            stdout: "",
            stderr: `cd: no such file or directory: ${targetPath}`,
            exitCode: 1,
            cwd: effectiveCwd,
          },
          { status: 200 }
        );
      }
    }

    // Unrestricted host shell execution running as the host user running Node.js
    const result = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>((resolve) => {
      exec(
        command,
        {
          cwd: effectiveCwd,
          shell: true as unknown as string,
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error: ExecException | null, stdout: string, stderr: string) => {
          if (error) {
            const code = typeof error.code === "number" ? error.code : 1;
            resolve({
              stdout: stdout ? stdout.toString() : "",
              stderr: stderr ? stderr.toString() : (error.message || ""),
              exitCode: code,
            });
          } else {
            resolve({
              stdout: stdout ? stdout.toString() : "",
              stderr: stderr ? stderr.toString() : "",
              exitCode: 0,
            });
          }
        }
      );
    });

    return NextResponse.json(
      {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        cwd: effectiveCwd,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error in POST /api/terminal/execute:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
