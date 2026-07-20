import { BadRequestException, Body, Controller, Get, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AssetsService } from "./assets.service";
import { UploadAssetPayload } from "./assets.types";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";
import { OperatorAccessGuard, RequireOperatorCapability } from "../operator-access/operator-access.guard";

@Controller("assets")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  list(
    @Query("ownerType") ownerType?: string,
    @Query("ownerId") ownerId?: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.assets.list({ ownerType, ownerId, wechatAccountId, conversationId, customerId });
  }

  @Post("upload")
  @RequireOperatorCapability("manage_design_executions")
  upload(@Body() payload: UploadAssetPayload) {
    return this.assets.upload(payload);
  }

  @Get("local-file")
  async localFile(
    @Query("path") localPath: string,
    @Query("wechatAccountId") wechatAccountId: string,
    @Query("conversationId") conversationId: string,
    @Query("customerId") customerId: string,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.assets.readLocalAsset(localPath, {
      expectedWechatAccountId: wechatAccountId,
      expectedConversationId: conversationId,
      expectedCustomerId: customerId,
    });
    reply.header("Content-Type", file.mimeType);
    reply.header("Content-Length", String(file.sizeBytes));
    reply.header("Cache-Control", "private, max-age=3600");
    return reply.send(file.stream);
  }

  @Post("demo-customer-logo")
  @RequireOperatorCapability("manage_design_executions")
  createDemoCustomerLogo(@Body() payload: { customerId?: string } & ExpectedIdentityPayload) {
    if (!payload?.customerId) throw new BadRequestException("customerId is required for demo customer logo");
    return this.assets.createDemoCustomerLogo(payload.customerId, payload);
  }
}
