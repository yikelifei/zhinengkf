import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { appConfig } from "./shared/app-config";
import { registerLocalOriginPolicy } from "./shared/local-origin-policy";

const { MAX_DESKTOP_API_JSON_BODY_BYTES } = require("../../../packages/runtime/desktop-request-limits") as {
  MAX_DESKTOP_API_JSON_BODY_BYTES: number;
};

let appRef: NestFastifyApplication | null = null;
const keepAlive = setInterval(() => undefined, 60_000);

async function shutdown(signal: string) {
  console.log(`[api] received ${signal}, shutting down`);
  clearInterval(keepAlive);
  if (appRef) {
    await appRef.close();
  }
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.on("beforeExit", (code) => console.error(`[api] beforeExit code=${code}`));
process.on("exit", (code) => console.error(`[api] exit code=${code}`));
process.on("uncaughtException", (error) => {
  console.error("[api] uncaughtException", error);
  clearInterval(keepAlive);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[api] unhandledRejection", reason);
  clearInterval(keepAlive);
  process.exit(1);
});
async function bootstrap() {
  console.log(`[api] bootstrap starting appPort=${appConfig.apiPort}`);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: MAX_DESKTOP_API_JSON_BODY_BYTES }),
  );
  appRef = app;
  console.log(
    `[api] app created, NODE_ENV=${process.env.NODE_ENV || "<empty>"}, automationMode=${
      process.env.LOW_VALUE_AUTOMATION_MODE || "<unset>"
    }, desktopRuntimeTarget=${process.env.SMART_KEFU_RUNTIME_TARGET || "<unset>"}`,
  );
  registerWechatWorkXmlParsers(app);
  registerLocalOriginPolicy(app, appConfig.webPort);
  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  console.log("[api] bootstrap complete, listening...");
  await app.listen({ port: appConfig.apiPort, host: "127.0.0.1" });
  console.log(`[api] listening on http://127.0.0.1:${appConfig.apiPort}/api/health`);
}

function registerWechatWorkXmlParsers(app: NestFastifyApplication) {
  const fastify = app.getHttpAdapter().getInstance() as any;
  const parseAsString = (_request: unknown, body: string, done: (error: Error | null, value?: string) => void) => done(null, body);
  for (const contentType of ["text/xml", "application/xml", "application/octet-stream"]) {
    if (!fastify.hasContentTypeParser?.(contentType)) {
      fastify.addContentTypeParser(contentType, { parseAs: "string" }, parseAsString);
    }
  }
}

bootstrap().catch((error) => {
  console.error("[api] bootstrap failed", error);
  clearInterval(keepAlive);
  process.exit(1);
});
