import { Controller, Get, Header, Post, Query, Body, UseGuards } from "@nestjs/common";
import { OperatorAccessGuard, RequireOperatorCapability } from "../operator-access/operator-access.guard";
import { WechatWorkAuthorizationService } from "./wechat-work-authorization.service";

@Controller("wechat-work")
export class WechatWorkAuthorizationController {
  constructor(private readonly authorization: WechatWorkAuthorizationService) {}

  @Get("authorization/status")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  getAuthorizationStatus() {
    return this.authorization.getStatus();
  }

  @Post("authorization/install-link")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  createAuthorizationInstallLink() {
    return this.authorization.createInstallLink();
  }

  @Get("authorization/callback")
  @Header("content-type", "text/html; charset=utf-8")
  async handleAuthorizationRedirect(@Query() query: Record<string, string>) {
    try {
      const result = await this.authorization.handleAuthorizationRedirect(query);
      return authorizationResultHtml(true, `企业「${result.corpName}」授权成功，可以关闭此页面。`);
    } catch {
      return authorizationResultHtml(false, "授权未完成或链接已失效，请回到客服工作台重新发起。");
    }
  }

  @Get("suite/callback")
  @Header("content-type", "text/plain; charset=utf-8")
  verifySuiteCallback(@Query() query: Record<string, string>) {
    return this.authorization.verifySuiteCallback(query);
  }

  @Post("suite/callback")
  @Header("content-type", "text/plain; charset=utf-8")
  handleSuiteCallback(@Query() query: Record<string, string>, @Body() body: unknown) {
    return this.authorization.handleSuiteCallback(query, body);
  }
}

function authorizationResultHtml(ok: boolean, message: string) {
  const title = ok ? "企业微信授权成功" : "企业微信授权失败";
  const color = ok ? "#166534" : "#991b1b";
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="margin:0;background:#f8fafc;font-family:system-ui,sans-serif;color:#172033"><main style="max-width:520px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #dfe5ee;border-radius:16px"><h1 style="font-size:24px;color:${color}">${title}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}
