"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true },
});

const { AgentSkillExecutorService } = require("../apps/api/src/agents/agent-skill-executor.service");
const { agentSkillExecutionPolicy } = require("../apps/api/src/agents/agent-skill-actions");
const { AgentsController } = require("../apps/api/src/agents/agents.controller");
const { OPERATOR_CAPABILITY_METADATA } = require("../apps/api/src/operator-access/operator-access.guard");
const { appConfig } = require("../apps/api/src/shared/app-config");

const originalUseLocalStore = appConfig.useLocalStore;
appConfig.useLocalStore = true;
test.after(() => {
  appConfig.useLocalStore = originalUseLocalStore;
});

test("policy maps only fixed read-only business actions and disables stopped skills", () => {
  const design = agentSkillExecutionPolicy({
    id: "skill-design",
    agentId: "generated-database-id",
    agentKey: "gift_design",
    name: "设计需求确认",
    enabled: true,
  });
  assert.equal(design.actionKey, "design_platform.health_check");
  assert.equal(design.riskLevel, "read_only");
  assert.equal(design.sideEffects, "none");
  assert.equal(design.rollbackMode, "not_required_read_only");
  assert.equal(design.confirmationText, "EXECUTE_AGENT_SKILL:skill-design");
  assert.equal(design.canExecute, true);

  const listSkillFallback = agentSkillExecutionPolicy({
    id: "skill-design-list",
    agentId: "generated-database-id",
    name: "设计需求确认",
    enabled: true,
  });
  assert.equal(listSkillFallback.actionKey, "design_platform.health_check");

  const fallback = agentSkillExecutionPolicy({
    id: "skill-custom",
    agentId: "agent-custom",
    name: "自定义话术",
    enabled: true,
  });
  assert.equal(fallback.actionKey, "skill.instruction_preview");

  const disabled = agentSkillExecutionPolicy({
    id: "skill-disabled",
    enabled: false,
  });
  assert.equal(disabled.canExecute, false);
  assert.match(disabled.blockedReason, /已停用/);
});

test("executor requires exact confirmation, records audit and replays without rerunning action", async () => {
  const fixture = createFixture();
  const payload = {
    operationKey: "agent-skill:test-operation-0001",
    confirmation: "EXECUTE_AGENT_SKILL:skill-design",
  };

  await assert.rejects(
    fixture.executor.execute(
      "agent_gift_design",
      "skill-design",
      { ...payload, confirmation: "yes" },
      "local_admin",
    ),
    (error) => error?.getResponse?.().code === "AGENT_SKILL_CONFIRMATION_REQUIRED",
  );
  assert.equal(fixture.designCalls(), 0);
  assert.equal(fixture.logs.size, 0);

  const first = await fixture.executor.execute(
    "agent_gift_design",
    "skill-design",
    payload,
    "local_admin",
  );
  assert.equal(first.status, "completed");
  assert.equal(first.replayed, false);
  assert.equal(first.result.healthy, true);
  assert.equal(first.result.adapter, "art_image_local");
  assert.equal(first.result.baseUrl, undefined);
  assert.equal(fixture.designCalls(), 1);

  const log = fixture.logs.get(first.executionId);
  assert.equal(log.afterStatus, "completed");
  assert.equal(log.reviewer, "local_admin");
  assert.equal(log.metadata.actionKey, "design_platform.health_check");
  assert.equal(log.metadata.sideEffects, "none");

  const replay = await fixture.executor.execute(
    "agent_gift_design",
    "skill-design",
    payload,
    "local_admin",
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.executionId, first.executionId);
  assert.equal(fixture.designCalls(), 1);
});

test("same operation key cannot be reused with another identity or arbitrary action input", async () => {
  const fixture = createFixture();
  const operationKey = "agent-skill:test-operation-0002";
  await fixture.executor.execute(
    "agent_gift_design",
    "skill-design",
    {
      operationKey,
      confirmation: "EXECUTE_AGENT_SKILL:skill-design",
      customerId: "customer-one",
    },
    "local_admin",
  );

  await assert.rejects(
    fixture.executor.execute(
      "agent_gift_design",
      "skill-design",
      {
        operationKey,
        confirmation: "EXECUTE_AGENT_SKILL:skill-design",
        customerId: "customer-two",
      },
      "local_admin",
    ),
    (error) => error?.getResponse?.().code === "OPERATION_KEY_REUSED",
  );

  await assert.rejects(
    fixture.executor.execute(
      "agent_gift_design",
      "skill-design",
      {
        operationKey: "agent-skill:test-operation-0003",
        confirmation: "EXECUTE_AGENT_SKILL:skill-design",
        actionKey: "shell.execute",
      },
      "local_admin",
    ),
    (error) => error?.getResponse?.().code === "AGENT_SKILL_PAYLOAD_REJECTED",
  );
  assert.equal(fixture.designCalls(), 1);
});

test("controller execution route requires the dedicated capability", () => {
  assert.equal(
    Reflect.getMetadata(
      OPERATOR_CAPABILITY_METADATA,
      AgentsController.prototype.executeSkill,
    ),
    "execute_agent_skills",
  );
  assert.equal(
    Reflect.getMetadata(
      OPERATOR_CAPABILITY_METADATA,
      AgentsController.prototype.listSkillExecutions,
    ),
    undefined,
  );
});

test("executor source cannot launch commands or evaluate supplied code", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../apps/api/src/agents/agent-skill-executor.service.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /node:child_process|execSync|spawnSync|new Function|eval\s*\(/);
  assert.match(source, /switch \(actionKey\)/);
  assert.match(source, /ALLOWED_PAYLOAD_KEYS/);
  assert.match(source, /sideEffects/);
  assert.match(source, /rollbackMode/);
});

function createFixture() {
  const logs = new Map();
  let designCalls = 0;
  const agents = {
    listAgents: () => [
      {
        id: "agent_gift_design",
        key: "gift_design",
        name: "礼盒设计 Agent",
        skills: [
          {
            id: "skill-design",
            agentId: "agent_gift_design",
            name: "设计需求确认",
            description: "收集 Logo、参考图、文案、风格和出图数量。",
            enabled: true,
            version: 2,
          },
        ],
      },
    ],
  };
  const localStore = {
    getReviewLog: (id) => logs.get(id) || null,
    createReviewLog: (payload) => {
      const existing = logs.get(payload.id);
      if (existing) return existing;
      const record = {
        ...payload,
        createdAt: new Date().toISOString(),
      };
      logs.set(record.id, record);
      return record;
    },
    updateReviewLog: (id, patch) => {
      const next = { ...logs.get(id), ...patch };
      logs.set(id, next);
      return next;
    },
    listReviewLogs: () => [...logs.values()],
  };
  const designPlatform = {
    health: async () => {
      designCalls += 1;
      return {
        ok: true,
        adapter: "art_image_local",
        service: "zhenxi-ai",
        version: "0.1.30",
        baseUrl: "http://secret.internal",
        localDemo: { localGenerateEnabled: true },
      };
    },
  };
  const executor = new AgentSkillExecutorService(
    agents,
    localStore,
    {},
    designPlatform,
    { auditSkus: async () => ({ total: 3, readyCount: 2 }) },
    { readiness: async () => ({ ready: true, blockers: [], warnings: [] }) },
  );
  return {
    executor,
    logs,
    designCalls: () => designCalls,
  };
}
