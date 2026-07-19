"use strict";

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true },
});

const { PrismaClient } = require("@prisma/client");
const { seedAgentConfig } = require("../apps/api/src/local-store/local-store.service.ts");
const { initializePrismaAgentData } = require("./initialize-prisma-agent-data.ts");

const execute = process.argv.includes("--execute");
const confirmation = argumentValue("--confirm");
const requiredConfirmation = "INITIALIZE_PRISMA_AGENTS";
const seeded = seedAgentConfig(new Date().toISOString());

if (!execute) {
  process.stdout.write(`${JSON.stringify({
    status: "PLAN",
    writesExecuted: false,
    agents: seeded.agents.length,
    skills: seeded.agentSkills.length,
    command: `npm run prisma:agents:init -- --execute --confirm ${requiredConfirmation}`,
  }, null, 2)}\n`);
  process.exit(0);
}

if (confirmation !== requiredConfirmation) {
  throw new Error(`refusing Prisma agent initialization: --confirm must equal ${requiredConfirmation}`);
}

const prisma = new PrismaClient();
void initializePrismaAgentData(
  prisma,
  seeded,
  process.env.PRISMA_AGENT_INIT_OPERATOR || "deployment_operator",
).then((result) => {
  process.stdout.write(`${JSON.stringify({ writesExecuted: result.changed, ...result }, null, 2)}\n`);
}).catch(() => {
  process.stderr.write("Prisma Agent initialization failed; inspect protected deployment logs.\n");
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}
