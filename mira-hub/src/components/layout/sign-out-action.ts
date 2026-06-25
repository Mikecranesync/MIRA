"use client";

import { signOut } from "next-auth/react";

export function signOutToLogin(): void {
  void signOut({ callbackUrl: "/login" });
}
