import { Module } from "@nestjs/common";
import { AgentsController } from "./agents/agents.controller";
import { AgentsService } from "./agents/agents.service";
import { AutomationController } from "./automation/automation.controller";
import { AutomationService } from "./automation/automation.service";
import { AssetsController } from "./assets/assets.controller";
import { AssetsService } from "./assets/assets.service";
import { HealthController } from "./health.controller";
import { CatalogController } from "./catalog/catalog.controller";
import { CatalogService } from "./catalog/catalog.service";
import { DesignJobsController } from "./design-jobs/design-jobs.controller";
import { DesignJobsService } from "./design-jobs/design-jobs.service";
import { DesignPlatformController } from "./integrations/design-platform/design-platform.controller";
import { DesignPlatformClient } from "./integrations/design-platform/design-platform.client";
import { LocalStoreService } from "./local-store/local-store.service";
import { NotificationsController } from "./notifications/notifications.controller";
import { NotificationsService } from "./notifications/notifications.service";
import { OrdersController } from "./orders/orders.controller";
import { OrdersService } from "./orders/orders.service";
import { PrismaService } from "./prisma/prisma.service";
import { QuotesController } from "./quotes/quotes.controller";
import { QuotesService } from "./quotes/quotes.service";
import { ReviewsController } from "./reviews/reviews.controller";
import { ReviewsService } from "./reviews/reviews.service";
import { RoutingController } from "./routing/routing.controller";
import { RoutingService } from "./routing/routing.service";
import { StorageService } from "./storage/storage.service";
import { TrainingController } from "./training/training.controller";
import { TrainingService } from "./training/training.service";
import { WechatController } from "./wechat/wechat.controller";
import { WechatDispatchService } from "./wechat/wechat-dispatch.service";
import { WechatSendAdapterService } from "./wechat/wechat-send-adapter.service";

@Module({
  controllers: [
    AgentsController,
    AutomationController,
    AssetsController,
    HealthController,
    CatalogController,
    DesignJobsController,
    DesignPlatformController,
    NotificationsController,
    OrdersController,
    QuotesController,
    ReviewsController,
    RoutingController,
    TrainingController,
    WechatController,
  ],
  providers: [
    AgentsService,
    AutomationService,
    AssetsService,
    CatalogService,
    DesignJobsService,
    DesignPlatformClient,
    LocalStoreService,
    NotificationsService,
    OrdersService,
    PrismaService,
    QuotesService,
    ReviewsService,
    RoutingService,
    StorageService,
    TrainingService,
    WechatDispatchService,
    WechatSendAdapterService,
  ],
})
export class AppModule {}
