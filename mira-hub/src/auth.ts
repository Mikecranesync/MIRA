import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { ensureInvitedUser, ensureUserAndTenant, findUserByEmail, findUserById, validateMagicToken, magicTokenPurpose, magicTokenNeedsCredentialReview } from "@/lib/users";
import { NO_ROLE, normalizeRole, type ResolvedRole } from "@/lib/role";
import { refreshEntitlementClaims } from "@/capabilities/session-entitlement";
import { credentialEpoch } from "@/capabilities/verified-identity";
import { redeemVerifiedOnboarding } from "@/capabilities/verified-onboarding";
import { ONBOARDING_VERSION } from "@/capabilities/onboarding-policy";
import { publicSignupPolicy } from "@/capabilities/free-technician-signup";
import { claimVerifiedEmail, CredentialReviewRequiredError } from "@/capabilities/verified-identity";
import pool from "@/lib/db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      tenantId: string;
      status: string;
      trialExpiresAt?: string | null;
      /** Derived fresh from hub_users.role on every session read (#2360); "" = least privilege. */
      role: ResolvedRole;
    };
  }
  interface User {
    credentialEpoch?: number;
    id: string;
    email?: string | null;
    tenantId?: string;
    status?: string;
    trialExpiresAt?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    credentialEpoch?: number;
    uid?: string;
    tid?: string;
    status?: string;
    trialExpiresAt?: string | null;
  }
}

const googleClientId = process.env.HUB_AUTH_GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.HUB_AUTH_GOOGLE_CLIENT_SECRET || "";

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
      return {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        tenantId: user.tenantId,
        status: user.status,
        credentialEpoch: credentialEpoch(user),
        trialExpiresAt: user.trialExpiresAt?.toISOString() ?? null,
      };
    },
  }),
  CredentialsProvider({
    id: "magic-token",
    name: "Magic Link",
    credentials: { token: { type: "text" }, agreementVersion: { type:"text" } },
    async authorize(credentials) {
      if (!credentials?.token) return null;
      let account;
      const purpose = await magicTokenPurpose(credentials.token);
      if (purpose === "onboarding") {
        try { account = await redeemVerifiedOnboarding(credentials.token, credentials.agreementVersion ?? ""); }
        catch { return null; }
      } else {
        // Codex F28: refuse unknown-provenance identities before the token is spent.
        if (await magicTokenNeedsCredentialReview(credentials.token)) return null;
        const result = await validateMagicToken(credentials.token);
        if (!result) return null;
        if (result.tenantId) {
          try { account = await ensureInvitedUser({email:result.email,tenantId:result.tenantId,role:result.role ?? "technician"}); }
          catch (err) { if (err instanceof CredentialReviewRequiredError) return null; throw err; }
        }
        else {
          const existing = await findUserByEmail(result.email);
          if (!existing) return null;
          account = {id:existing.id,email:existing.email,tenantId:existing.tenantId};
        }
        try { await claimVerifiedEmail(pool,account.id); } catch { return null; }
      }
      const user=await findUserByEmail(account.email);
      if(!user) return null;
      return {
        id: account.id,
        email: account.email,
        name: user?.name ?? null,
        tenantId: account.tenantId,
        status: user?.status ?? "trial",
        credentialEpoch: credentialEpoch(user),
        trialExpiresAt: user?.trialExpiresAt?.toISOString() ?? null,
      };
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
  // Log the exact redirect_uri NextAuth will send to Google so a drift
  // between NEXTAUTH_URL and the URIs registered in Google Cloud Console
  // is visible the moment the container boots, not the moment a user
  // clicks "Continue with Google". Canonical list of authorized URIs:
  // docs/auth/oauth-redirect-uris.md. Canary: .github/workflows/oauth-redirect-canary.yml.
  const nextauthUrl = process.env.NEXTAUTH_URL ?? "(unset — NextAuth will infer from request)";
  console.log(`[auth] Google sign-in enabled — redirect_uri will be ${nextauthUrl}/callback/google`);
} else if (process.env.NODE_ENV === "production") {
  console.warn("[auth] HUB_AUTH_GOOGLE_CLIENT_ID or HUB_AUTH_GOOGLE_CLIENT_SECRET unset — Google sign-in disabled");
}

export async function resolveRoleFromDb(userId: string | undefined): Promise<ResolvedRole> {
  if (!userId) return NO_ROLE;
  try {
    const user = await findUserById(userId);
    return normalizeRole(user?.role);
  } catch {
    return NO_ROLE;
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers,
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google" && profile?.email) {
        if ((profile as { email_verified?: unknown }).email_verified !== true) return false;
        const knownEmail=await findUserByEmail(profile.email);
        const knownSubject=await pool.query("SELECT id FROM hub_users WHERE google_sub=$1 LIMIT 1",[account.providerAccountId]);
        if(!knownEmail && !knownSubject.rows[0] && publicSignupPolicy().kind!=="trial") return "/signup/";
        const existing = await ensureUserAndTenant({
          email: profile.email,
          googleSub: account.providerAccountId,
          name: (profile as { name?: string }).name,
          verifiedEmail: true,
        });
        const fullUser = await findUserByEmail(existing.email);
        user.id = existing.id;
        user.email = existing.email;
        user.tenantId = existing.tenantId;
        user.status = fullUser?.status ?? "trial";
        user.credentialEpoch = credentialEpoch(fullUser);
        user.trialExpiresAt = fullUser?.trialExpiresAt?.toISOString() ?? null;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.tid = user.tenantId;
        token.status = user.status ?? "trial";
        token.credentialEpoch = user.credentialEpoch ?? 0;
        token.trialExpiresAt = user.trialExpiresAt ?? null;
        return token;
      }
      // #4362 / Codex #4664 F3: a session minted under the old 7-day trial kept
      // its day-8 deadline until the next sign-in. Re-read status + deadline on
      // every later session read; any failure keeps the existing claims.
      return refreshEntitlementClaims(token, findUserById);
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid ?? "";
        session.user.tenantId = token.tid ?? "";
        session.user.status = token.status ?? "trial";
        session.user.trialExpiresAt = token.trialExpiresAt ?? null;
        // Same rule as lib/session.ts requireSession (#2360): the role is a DB
        // read, not a JWT claim, so revocation is instant; a failed lookup is
        // least-privilege, never a default up. Without this the client-side
        // providers saw no role at all and defaulted every user to owner.
        session.user.role = await resolveRoleFromDb(token.uid);
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
};
