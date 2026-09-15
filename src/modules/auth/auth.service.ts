import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";

import { prisma } from "../../db/client.js";
import { ApiError, badRequest, unauthorized } from "../../lib/errors.js";
import { signAccessToken } from "../../lib/jwt.js";
import type { LoginInput, RegisterInput } from "./auth.schemas.js";

const BCRYPT_ROUNDS = 12;

/** Matches AuthUser in the frontend's src/types/domain.ts — never includes the password hash. */
export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  role: "CANDIDATE" | "ADMIN";
}

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
}

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    ...(user.phone ? { phone: user.phone } : {}),
    role: user.role,
  };
}

export async function register(input: RegisterInput): Promise<AuthSession> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw badRequest("An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  // Registration always creates a CANDIDATE — there is no public admin-signup endpoint in the contract.
  // Admins are seeded or promoted directly in the database (or, later, via another admin's request).
  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash,
      role: "CANDIDATE",
    },
  });

  return { accessToken: signAccessToken({ sub: user.id, role: user.role }), user: toAuthUser(user) };
}

export async function login(input: LoginInput): Promise<AuthSession> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw unauthorized("Invalid email or password");
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw unauthorized("Invalid email or password");
  }

  return { accessToken: signAccessToken({ sub: user.id, role: user.role }), user: toAuthUser(user) };
}

export async function getAuthUserById(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ApiError(401, "Account no longer exists", "Unauthorized");
  }
  return toAuthUser(user);
}
