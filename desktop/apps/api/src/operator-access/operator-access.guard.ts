import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { OperatorAccessService } from "./operator-access.service";
import { OperatorCapability, TrustedOperatorPrincipal } from "./operator-access.types";

export const INTERNAL_API_TOKEN_HEADER = "x-internal-api-token";
export const OPERATOR_CAPABILITY_METADATA = "operator_access_capability";

export type TrustedOperatorRequest = {
  headers?: Record<string, string | string[] | undefined>;
  trustedOperator?: TrustedOperatorPrincipal;
};

export const RequireOperatorCapability = (capability: OperatorCapability) =>
  SetMetadata(OPERATOR_CAPABILITY_METADATA, capability);

export const TrustedOperator = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<TrustedOperatorRequest>().trustedOperator;
});

@Injectable()
export class OperatorAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly operatorAccess: OperatorAccessService,
  ) {}

  canActivate(context: ExecutionContext) {
    const capability = this.reflector.getAllAndOverride<OperatorCapability>(OPERATOR_CAPABILITY_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!capability) return true;

    const request = context.switchToHttp().getRequest<TrustedOperatorRequest>();
    const token = request.headers?.[INTERNAL_API_TOKEN_HEADER];
    const principal = this.operatorAccess.requireTrustedCapability(token, capability);
    request.trustedOperator = principal;
    return true;
  }
}
