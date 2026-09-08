import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { authConfig } from "./auth.config";
import { getAdminByUsername } from "./lib/db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  trustHost: true,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        const username =
          typeof credentials.username === "string"
            ? credentials.username.trim()
            : "";
        const password =
          typeof credentials.password === "string"
            ? credentials.password
            : "";

        if (!username || !password) {
          return null;
        }

        const user = getAdminByUsername(username);
        if (!user) {
          return null;
        }

        const passwordsMatch = await bcrypt.compare(password, user.passwordHash);
        if (passwordsMatch) {
          return {
            id: user.id.toString(),
            name: user.username,
            role: user.role,
          };
        }

        return null;
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      if (token.name && session.user) {
        session.user.name = token.name;
      }
      if (token.role && session.user) {
        (session.user as { id?: string; name?: string | null; email?: string | null; role?: string }).role =
          token.role as string;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.name = user.name;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
  },
});
