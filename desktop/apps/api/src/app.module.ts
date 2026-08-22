import { Module } from "@nestjs/common";
import { AiProviderController } from "./ai/ai-provider.controller";
import { AiProviderService } from "./ai/ai-provider.service";
import { AgentTasksController } from "./agent-tasks/agent-tasks.controller";
import { AgentTaskToolExecutorService } from "./agent-tasks/agent-task-tool-executor.service";
import { AgentsController } from "./agents/agents.controller";
import { AgentSkillExecutorService } from "./agents/agent-skill-executor.service";
import { AgentsService } from "./agents/agents.service";
import { AutomationController } from "./automation/automation.controller";
import { AutomationSchedulerService } from "./automation/automation-scheduler.service";
import { AutomationService } from "./automation/automation.service";
import { AssetsController } from "./assets/assets.controller";
import { AssetsService } from "./assets/assets.service";
import { HealthController } from "./health.controller";
import { CatalogController } from "./catalog/catalog.controller";
import { CatalogService } from "./catalog/catalog.service";
import { ConversationOperationsController } from "./conversation-ops/conversation-operations.controller";
import { ConversationOperationsService } from "./conversation-ops/conversation-operations.service";
import { CompanyProfileController } from "./company-profile.controller";
import { DesktopShellController } from "./desktop-shell/desktop-shell.controller";
import { DesignJobsController } from "./design-jobs/design-jobs.controller";
import { DesignJobsService } from "./design-jobs/design-jobs.service";
import { DesignPlatformExecutionService } from "./design-jobs/design-platform-execution.service";
import { DeliveryReadinessController } from "./delivery/delivery-readiness.controller";
import { DeliveryReadinessService } from "./delivery/delivery-readiness.service";
import { DesignPlatformController } from "./integrations/design-platform/design-platform.controller";
import { DesignPlatformClient } from "./integrations/design-platform/design-platform.client";
import { ZhenxiMcpClientService } from "./integrations/zhenxi-mcp/zhenxi-mcp-client.service";
import { LocalStoreService } from "./local-store/local-store.service";
import { NotificationsController } from "./notifications/notifications.controller";
import { NotificationsService } from "./notifications/notifications.service";
import { OperatorAccessController } from "./operator-access/operator-access.controller";
import { OperatorAccessGuard } from "./operator-access/operator-access.guard";
import { OperatorAccessService } from "./operator-access/operator-access.service";
import { OrdersController } from "./orders/orders.controller";
import { OrdersService } from "./orders/orders.service";
import { PrismaService } from "./prisma/prisma.service";
import { PrismaOperationsService } from "./prisma/prisma-operations.service";
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
import { WechatWorkController } from "./wechat-work/wechat-work.controller";
import { WechatWorkApiClient } from "./wechat-work/wechat-work-api.client";
import { WechatWorkAuthorizationController } from "./wechat-work/wechat-work-authorization.controller";
import { WechatWorkAuthorizationService } from "./wechat-work/wechat-work-authorization.service";
import { WechatWorkService } from "./wechat-work/wechat-work.service";
import { WechatWorkInboundUnderstandingService } from "./wechat-work/wechat-work-inbound-understanding.service";
import { WechatWorkSuiteApiClient } from "./wechat-work/wechat-work-suite-api.client";
import { WechatWorkCallbackEventClientService } from "./wechat-work/wechat-work-callback-event-client.service";
import { WechatWorkCallbackEventRelay } from "./wechat-work/wechat-work-callback-events";
import { WechatPersistence } from "./wechat/wechat-persistence";

@Module({
  controllers: [
    AiProviderController,
    AgentTasksController,
    AgentsController,
    AutomationController,
    AssetsController,
    HealthController,
    CatalogController,
    CompanyProfileController,
    ConversationOperationsController,
    DesktopShellController,
    DeliveryReadinessController,
    DesignJobsController,
    DesignPlatformController,
    NotificationsController,
    OperatorAccessController,
    OrdersController,
    QuotesController,
    ReviewsController,
    RoutingController,
    TrainingController,
    WechatController,
    WechatWorkAuthorizationController,
    WechatWorkController,
  ],
  providers: [
    AiProviderService,
    AgentTaskToolExecutorService,
    AgentSkillExecutorService,
    AgentsService,
    AutomationService,
    AutomationSchedulerService,
    AssetsService,
    CatalogService,
    ConversationOperationsService,
    DeliveryReadinessService,
    DesignJobsService,
    DesignPlatformExecutionService,
    DesignPlatformClient,
    ZhenxiMcpClientService,
    LocalStoreService,
    NotificationsService,
    OperatorAccessGuard,
    OperatorAccessService,
    OrdersService,
    PrismaService,
    PrismaOperationsService,
    {
      provide: QuotesService,
      useFactory: (
        prisma: PrismaService,
        localStore: LocalStoreService,
        orders: OrdersService,
        wechatDispatch: WechatDispatchService,
      ) => new QuotesService(prisma, localStore, orders, wechatDispatch),
      inject: [PrismaService, LocalStoreService, OrdersService, WechatDispatchService],
    },
    ReviewsService,
    RoutingService,
    StorageService,
    TrainingService,
    WechatDispatchService,
    WechatPersistence,
    WechatSendAdapterService,
    WechatWorkApiClient,
    WechatWorkAuthorizationService,
    WechatWorkCallbackEventRelay,
    WechatWorkCallbackEventClientService,
    WechatWorkService,
    WechatWorkInboundUnderstandingService,
    WechatWorkSuiteApiClient,
  ],
})
export class AppModule {}
