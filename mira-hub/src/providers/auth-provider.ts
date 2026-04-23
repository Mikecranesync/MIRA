"use client";

import type { AuthProvider } from "@refinedev/core";

const TEST_USER = {
  email: "mike@factorylm.com",
  password: "admin123",
  name: "Mike Harper",
  role: "admin",
  avatar: "MH",
};

export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
    if (email === TEST_USER.email && password === TEST_USER.password) {
      if (typeof window !== "undefined") {
        localStorage.setItem("hub_user", JSON.stringify({ email: TEST_USER.email, name: TEST_USER.name, role: TEST_USER.role, avatar: TEST_USER.avatar }));
      }
      return { success: true, redirectTo: "/feed" };
    }
    return { success: false, error: { message: "Invalid credentials", name: "LoginError" } };
  },

  logout: async () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("hub_user");
    }
    return { success: true, redirectTo: "/login" };
  },

  check: async () => {
    if (typeof window !== "undefined" && localStorage.getItem("hub_user")) {
      return { authenticated: true };
    }
    return { authenticated: false, redirectTo: "/login" };
  },

  getPermissions: async () => {
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem("hub_user");
      if (raw) return JSON.parse(raw).role;
    }
    return null;
  },

  getIdentity: async () => {
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem("hub_user");
      if (raw) return JSON.parse(raw);
    }
    return null;
  },

  onError: async (error) => {
    if (error?.status === 401) return { logout: true };
    return { error };
  },
};
