import { BadRequestException, Body, Controller, Get, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AssetsService } from "./assets.service";
import { UploadAssetPayload } from "./assets.types";

@Controller("assets")
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  list(@Query("ownerType") ownerType?: string, @Query("ownerId") ownerId?: string) {
    return this.assets.list({ ownerType, ownerId });
  }

  @Post("upload")
  upload(@Body() payload: UploadAssetPayload) {
    return this.assets.upload(payload);
  }

  @Get("local-file")
  async localFile(@Query("path") localPath: string, @Res() reply: FastifyReply) {
    const file = await this.assets.readLocalAsset(localPath);
    reply.header("Content-Type", file.mimeType);
    reply.header("Content-Length", String(file.sizeBytes));
    reply.header("Cache-Control", "private, max-age=3600");
    return reply.send(file.stream);
  }

  @Post("demo-customer-logo")
  createDemoCustomerLogo(@Body() payload: { customerId?: string }) {
    if (!payload?.customerId) throw new BadRequestException("customerId is required for demo customer logo");
    return this.assets.createDemoCustomerLogo(payload.customerId);
  }
}
