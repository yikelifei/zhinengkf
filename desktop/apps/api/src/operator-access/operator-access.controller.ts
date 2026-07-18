import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { INTERNAL_API_TOKEN_HEADER } from "./operator-access.guard";
import { OperatorAccessService } from "./operator-access.service";
import { OperatorAccessEvaluationInput } from "./operator-access.types";

@Controller("operator-access")
export class OperatorAccessController {
  constructor(private readonly operatorAccess: OperatorAccessService) {}

  @Get("status")
  getStatus(@Headers(INTERNAL_API_TOKEN_HEADER) token?: string) {
    return this.operatorAccess.getStatus(token);
  }

  @Get("policy")
  getPolicy() {
    return this.operatorAccess.getPolicy();
  }

  @Post("evaluate")
  evaluate(@Body() payload: OperatorAccessEvaluationInput = {}) {
    return this.operatorAccess.evaluate(payload);
  }
}
