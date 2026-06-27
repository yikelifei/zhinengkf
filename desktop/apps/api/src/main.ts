import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { appConfig } from "./shared/app-config";

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
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  appRef = app;
  app.setGlobalPrefix("api");
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen({ port: appConfig.apiPort, host: "127.0.0.1" });
  console.log(`[api] listening on http://127.0.0.1:${appConfig.apiPort}/api/health`);
}

bootstrap().catch((error) => {
  console.error("[api] bootstrap failed", error);
  clearInterval(keepAlive);
  process.exit(1);
});
