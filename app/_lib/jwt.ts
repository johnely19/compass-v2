/**
 * JWT utilities for Charlie iOS authentication.
 * Uses HS256 via `jose` (pure ESM, Next.js compatible).
 *
 * Secret: CHARLIE_JWT_SECRET env var (falls back to a dev default).
 * Token payload: { sub: userId, code: userCode, iat, exp }
 * Expiry: 365 days (long-lived — iOS stores in Keychain).
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const SECRET_ENV = process.env.CHARLIE_JWT_SECRET ?? 'compass-charlie-dev-secret-change-in-prod';
const secret = new TextEncoder().encode(SECRET_ENV);

export interface CharlieTokenPayload extends JWTPayload {
  sub: string;    // userId
  code: string;   // user invite code
}

/** Issue a new JWT for a user. Expires in 365 days. */
export async function signToken(userId: string, userCode: string): Promise<string> {
  return new SignJWT({ code: userCode })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('365d')
    .sign(secret);
}

/** Verify and decode a JWT. Returns null if invalid/expired. */
export async function verifyToken(token: string): Promise<CharlieTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as CharlieTokenPayload;
  } catch {
    return null;
  }
}
