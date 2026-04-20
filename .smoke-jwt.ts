import { SignJWT } from "jose";

const secret = new TextEncoder().encode("test-secret-preflight-2026-04-19");
const tid = "00000000-0000-0000-0000-000000000001";

async function mint(role: "ADMIN" | "USER"): Promise<string> {
  return await new SignJWT({
    email: `${role.toLowerCase()}@preflight.test`,
    tier: "active",
    atlasCompanyId: 1,
    atlasUserId: 1,
    atlasRole: role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(tid)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

console.log("ADMIN:", await mint("ADMIN"));
console.log("USER:", await mint("USER"));
