import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import {
  listUsers,
  createUser,
  getUserByUsername,
  updateUserRole,
  deleteUser,
  adminExists,
  db,
} from "@/lib/db";
import bcrypt from "bcrypt";

export const dynamic = "force-dynamic";

/**
 * GET /api/users
 * Lists all users with their roles (Admin only).
 * Returns 401 if unauthenticated, 403 if not Admin.
 */
export async function GET(req: Request) {
  try {
    const authResult = await requireAdmin(req);
    if (authResult.error) {
      return authResult.error;
    }

    const users = listUsers();
    return NextResponse.json({ success: true, users }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/users
 * Creates a new user with a specified role (Admin only).
 * Returns 401 if unauthenticated, 403 if not Admin.
 */
export async function POST(req: Request) {
  try {
    const authResult = await requireAdmin(req);
    if (authResult.error) {
      return authResult.error;
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { username, password, role = "developer", allowedProcess } = (body as {
      username?: string;
      password?: string;
      role?: string;
      allowedProcess?: string;
    }) ?? {};

    if (!username || !password || typeof username !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }

    if (username.length < 3) {
      return NextResponse.json({ error: "Username must be at least 3 characters" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const validRoles = ["admin", "developer", "client"];
    if (!validRoles.includes(role.toLowerCase())) {
      return NextResponse.json({ error: "Role must be admin, developer, or client" }, { status: 400 });
    }

    const existingUser = getUserByUsername(username);
    if (existingUser) {
      return NextResponse.json({ error: "Username already exists" }, { status: 400 });
    }

    if (role.toLowerCase() === "admin" && adminExists()) {
      return NextResponse.json(
        { error: "Only one administrator account is permitted" },
        { status: 400 }
      );
    }


    const passwordHash = await bcrypt.hash(password, 10);
    const created = createUser(username.trim(), passwordHash, role.toLowerCase(), allowedProcess);

    if (!created) {
      return NextResponse.json(
        { error: "Failed to create user" },
        { status: 400 }
      );
    }

    const newUser = getUserByUsername(username.trim());

    return NextResponse.json(
      {
        success: true,
        message: "User created successfully",
        user: {
          id: newUser?.id,
          username: newUser?.username,
          role: newUser?.role,
          createdAt: newUser?.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/users
 * Updates a user's role (Admin only).
 */
export async function PATCH(req: Request) {
  try {
    const authResult = await requireAdmin(req);
    if (authResult.error) {
      return authResult.error;
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { id, role } = (body as { id?: number | string; role?: string }) ?? {};
    const userId = Number(id);

    if (!userId || isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : "";
    if (normalizedRole !== "admin" && normalizedRole !== "developer") {
      return NextResponse.json(
        { error: "Role must be either 'admin' or 'developer'" },
        { status: 400 }
      );
    }

    const targetUser = db.prepare("SELECT id, role FROM users WHERE id = ?").get(userId) as { id: number; role: string } | undefined;
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (normalizedRole === "admin") {
      const currentAdmin = db.prepare("SELECT id FROM users WHERE LOWER(role) = 'admin'").get() as { id: number } | undefined;
      if (currentAdmin && currentAdmin.id !== userId) {
        return NextResponse.json(
          { error: "Only one administrator account is permitted" },
          { status: 400 }
        );
      }
    } else if (targetUser.role.toLowerCase() === "admin") {
      // Prevent demoting the last remaining administrator
      const adminCountStmt = db.prepare("SELECT count(*) as count FROM users WHERE LOWER(role) = 'admin'");
      const adminCount = (adminCountStmt.get() as { count: number }).count;
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot demote the last remaining administrator" },
          { status: 400 }
        );
      }
    }

    const updated = updateUserRole(userId, normalizedRole);
    if (!updated) {
      return NextResponse.json({ error: "Failed to update user role" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: "User role updated successfully",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/users
 * Deletes a user account (Admin only). Cannot delete the last admin.
 */
export async function DELETE(req: Request) {
  try {
    const authResult = await requireAdmin(req);
    if (authResult.error) {
      return authResult.error;
    }

    const { searchParams } = new URL(req.url);
    let idParam = searchParams.get("id");

    if (!idParam) {
      try {
        const body = (await req.json()) as { id?: number | string };
        if (body?.id) idParam = String(body.id);
      } catch {
        // Ignored
      }
    }

    const userId = Number(idParam);
    if (!userId || isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const targetUser = db.prepare("SELECT id, role FROM users WHERE id = ?").get(userId) as { id: number; role: string } | undefined;
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (targetUser.role.toLowerCase() === "admin") {
      const adminCountStmt = db.prepare("SELECT count(*) as count FROM users WHERE LOWER(role) = 'admin'");
      const adminCount = (adminCountStmt.get() as { count: number }).count;
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot delete the last remaining administrator (cannot delete the last administrator)" },
          { status: 400 }
        );
      }
    }

    const deleted = deleteUser(userId);
    if (!deleted) {
      return NextResponse.json(
        { error: "Cannot delete user (either not found or is the last administrator)" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
