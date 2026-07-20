import * as fs from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { appConfig } from "../shared/app-config";
import { INTERNAL_API_TOKEN_HEADER, OperatorAccessGuard } from "../operator-access/operator-access.guard";

export const WECHAT_BRIDGE_TOKEN_HEADER = "x-wechat-bridge-token";
export const WECHAT_WINDOW_OBSERVER_TOKEN_HEADER = "x-wechat-window-observer-token";

@Injectable()
export class WechatBridgeAccessGuard implements CanActivate {
  constructor(private readonly operatorGuard: OperatorAccessGuard) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (hasHeader(request?.headers, INTERNAL_API_TOKEN_HEADER)) return this.operatorGuard.canActivate(context);
    if (runtimeTokenMatches(request?.headers?.[WECHAT_BRIDGE_TOKEN_HEADER], appConfig.wechatBridgeServiceTokenFile)) return true;
    throw runtimeSessionRequired("trusted_wechat_bridge_session_required", "A trusted operator or WeChat bridge service session is required.");
  }
}

@Injectable()
export class WechatWindowObserverAccessGuard implements CanActivate {
  constructor(private readonly operatorGuard: OperatorAccessGuard) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (hasHeader(request?.headers, INTERNAL_API_TOKEN_HEADER)) return this.operatorGuard.canActivate(context);
    if (runtimeTokenMatches(request?.headers?.[WECHAT_WINDOW_OBSERVER_TOKEN_HEADER], appConfig.wechatWindowObserverProofFile)) return true;
    throw runtimeSessionRequired("trusted_wechat_window_observer_session_required", "A trusted operator or WeChat window observer session is required.");
  }
}

export function runtimeTokenMatches(received: unknown, tokenFile: string) {
  const actual = singleHeader(received);
  if (!/^[a-f0-9]{64}$/i.test(actual)) return false;
  let expected = "";
  try {
    const stat = fs.lstatSync(tokenFile);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    expected = String(fs.readFileSync(tokenFile, "utf8") || "").trim();
  } catch {
    return false;
  }
  if (!/^[a-f0-9]{64}$/i.test(expected)) return false;
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function hasHeader(headers: Record<string, unknown> | undefined, name: string) {
  return singleHeader(headers?.[name]).length > 0;
}

function singleHeader(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function runtimeSessionRequired(code: string, message: string) {
  return new ForbiddenException({
    statusCode: 403,
    error: "Forbidden",
    code,
    message,
  });
}
