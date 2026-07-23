import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";

export type LocalOriginDecision = {
  allowed: boolean;
  reason: "no_origin" | "allowed_local_web_origin" | "invalid_origin" | "origin_not_allowed";
};

type CorsOriginValue = boolean | string | RegExp | CorsOriginValue[];
type CorsOriginCallback = (error: Error | null, origin: CorsOriginValue) => void;

export function allowedLocalWebOrigins(webPort: number) {
  if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) return new Set<string>();
  return new Set([
    new URL(`http://127.0.0.1:${webPort}`).origin,
    new URL(`http://localhost:${webPort}`).origin,
  ]);
}

export function evaluateLocalRequestOrigin(
  origin: string | string[] | undefined,
  webPort: number,
): LocalOriginDecision {
  if (origin === undefined) return { allowed: true, reason: "no_origin" };
  if (Array.isArray(origin) || !origin) return { allowed: false, reason: "invalid_origin" };
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) return { allowed: false, reason: "invalid_origin" };
    if (allowedLocalWebOrigins(webPort).has(parsed.origin)) {
      return { allowed: true, reason: "allowed_local_web_origin" };
    }
    return { allowed: false, reason: "origin_not_allowed" };
  } catch {
    return { allowed: false, reason: "invalid_origin" };
  }
}

export function createLocalOriginRequestHook(webPort: number) {
  return async function enforceLocalOrigin(
    request: Pick<FastifyRequest, "headers">,
    reply: Pick<FastifyReply, "code" | "send">,
  ) {
    const decision = evaluateLocalRequestOrigin(request.headers.origin, webPort);
    if (decision.allowed) return;
    reply.code(403).send({
      statusCode: 403,
      error: "Forbidden",
      code: "request_origin_not_allowed",
      message: "Browser requests to the desktop API are limited to the configured local Web origin.",
    });
  };
}

export function createLocalCorsOriginHandler(webPort: number) {
  return (origin: string | undefined, callback: CorsOriginCallback) => {
    const decision = evaluateLocalRequestOrigin(origin, webPort);
    callback(null, origin && decision.allowed ? origin : false);
  };
}

export function registerLocalOriginPolicy(app: NestFastifyApplication, webPort: number) {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", createLocalOriginRequestHook(webPort));
  app.enableCors({
    origin: createLocalCorsOriginHandler(webPort),
    credentials: true,
  });
}
