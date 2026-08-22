import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AssetsService } from "./assets.service";
import { UploadAssetPayload } from "./assets.types";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";
import { OperatorAccessGuard, RequireOperatorCapability } from "../operator-access/operator-access.guard";
import { applySafeLocalFileHeaders } from "../storage/local-file-response";

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

  @Get("local-file/thumbnail")
  async localFileThumbnail(
    @Query("path") localPath: string,
    @Query("width") width: string,
    @Query("height") height: string,
    @Query("wechatAccountId") wechatAccountId: string,
    @Query("conversationId") conversationId: string,
    @Query("customerId") customerId: string,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.assets.readLocalAssetThumbnail(
      localPath,
      {
        expectedWechatAccountId: wechatAccountId,
        expectedConversationId: conversationId,
        expectedCustomerId: customerId,
      },
      {
        width: width ? Number(width) : undefined,
        height: height ? Number(height) : undefined,
      },
    );
    applySafeLocalFileHeaders(reply, file);
    reply.header("Cache-Control", "private, max-age=86400, stale-while-revalidate=604800");
    return reply.send(file.stream);
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
    applySafeLocalFileHeaders(reply, file);
    return reply.send(file.stream);
  }

  @Get(":id/local-file")
  async localFileById(
    @Param("id") assetId: string,
    @Query("wechatAccountId") wechatAccountId: string,
    @Query("conversationId") conversationId: string,
    @Query("customerId") customerId: string,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.assets.readLocalAssetById(assetId, {
      expectedWechatAccountId: wechatAccountId,
      expectedConversationId: conversationId,
      expectedCustomerId: customerId,
    });
    applySafeLocalFileHeaders(reply, file);
    return reply.send(file.stream);
  }

  @Post("demo-customer-logo")
  @RequireOperatorCapability("manage_design_executions")
  createDemoCustomerLogo(@Body() payload: { customerId?: string } & ExpectedIdentityPayload) {
    if (!payload?.customerId) throw new BadRequestException("customerId is required for demo customer logo");
    return this.assets.createDemoCustomerLogo(payload.customerId, payload);
  }
}
