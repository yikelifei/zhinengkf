import { Controller, Get, UseGuards } from "@nestjs/common";
import { OperatorAccessGuard, RequireOperatorCapability } from "../operator-access/operator-access.guard";
import { DeliveryReadinessService } from "./delivery-readiness.service";

@Controller("delivery/readiness")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class DeliveryReadinessController {
  constructor(private readonly deliveryReadiness: DeliveryReadinessService) {}

  @Get()
  getReadiness() {
    return this.deliveryReadiness.getReadiness();
  }
}
