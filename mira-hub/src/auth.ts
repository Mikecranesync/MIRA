import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { ensureUserAndTenant, findUserByEmail } from "@/lib/users";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      tenantId: string;
    };
  }
  interface User {
    id: string;
    email?: string | null;
    tenantId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    tid?: string;
  }
}

const googleClientId = process.env.GOOGLE_AUTH_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_AUTH_CLIENT_SECRET || "";

const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = credentials?.email?.trim();
      const password = credentials?.password;
      if (!email || !password) return null;
      const user = await findUserByEmail(email);
      if (!user?.passwordHash) return null;
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return null;
      return { id: user.id, email: user.email, name: user.name ?? null, tenantId: user.tenantId };
    },
  }),
];

if (googleClientId && googleClientSecret) {
  providers.unshift(
    GoogleProvider({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      authorization: { params: { scope: "openid email profile" } },
    }),
  );
} else if (process.env.NODE_ENV === "production") {
  console.warn("[auth] GOOGLE_AUTH_CLIENT_ID or GOOGLE_AUTH_CLIENT_SECRET unset — Google sign-in disabled");
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers,
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google" && profile?.email) {
        const existing = await ensureUserAndTenant({
          email: profile.email,
          googleSub: account.providerAccountId,
          name: (profile as { name?: string }).name,
        });
        user.id = existing.id;
        user.email = existing.email;
        user.tenantId = existing.tenantId;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.tid = user.tenantId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid ?? "";
        session.user.tenantId = token.tid ?? "";
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
};
