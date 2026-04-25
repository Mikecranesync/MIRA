"use client";

import type { AuthProvider } from "@refinedev/core";
import { signIn, signOut, getSession } from "next-auth/react";

export const authProvider: AuthProvider = {
  login: async ({ email, password }: { email: string; password: string }) => {
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (!result || result.error) {
      return {
        success: false,
        error: { message: result?.error ?? "Invalid credentials", name: "LoginError" },
      };
    }
    return { success: true, redirectTo: "/feed" };
  },

  logout: async () => {
    await signOut({ redirect: false });
    return { success: true, redirectTo: "/login" };
  },

  check: async () => {
    const session = await getSession();
    if (session?.user) return { authenticated: true };
    return { authenticated: false, redirectTo: "/login" };
  },

  getPermissions: async () => {
    const session = await getSession();
    return (session?.user as { role?: string } | undefined)?.role ?? "owner";
  },

  getIdentity: async () => {
    const session = await getSession();
    if (!session?.user) return null;
    const u = session.user;
    return {
      id: u.id,
      email: u.email,
      name: u.name ?? u.email,
      tenantId: u.tenantId,
      avatar: (u.name ?? u.email ?? "?").slice(0, 2).toUpperCase(),
    };
  },

  onError: async (error) => {
    if ((error as { status?: number })?.status === 401) {
      return { logout: true, redirectTo: "/login" };
    }
    return { error };
  },
};
