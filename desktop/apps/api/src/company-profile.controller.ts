import { Controller, Get } from "@nestjs/common";
import { appConfig } from "./shared/app-config";

const { loadCompanyProfile } = require("../../../packages/runtime/company-profile");

@Controller("company-profile")
export class CompanyProfileController {
  @Get()
  getCompanyProfile() {
    const profile = loadCompanyProfile();
    return {
      ...profile,
      runtimeBinding: {
        profileLoaded: true,
        credentialsEmbedded: false,
        wechatWorkConfigured: Boolean(
          appConfig.wechatWorkCorpId
          && appConfig.wechatWorkSecret
          && appConfig.wechatWorkToken
          && appConfig.wechatWorkEncodingAesKey
          && appConfig.wechatWorkOpenKfid,
        ),
      },
    };
  }
}
