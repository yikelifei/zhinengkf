type SeededAgentConfig = {
  agents: any[];
  agentSkills: any[];
};

export async function initializePrismaAgentData(
  prisma: any,
  seeded: SeededAgentConfig,
  operator = "deployment_operator",
) {
  return prisma.$transaction(async (tx: any) => {
    const result = {
      status: "PASS",
      changed: false,
      createdAgents: 0,
      updatedAgents: 0,
      createdSkills: 0,
      updatedSkills: 0,
    };
    const actualAgentIds = new Map<string, string>();

    for (const agent of seeded.agents) {
      const existing = await tx.customerServiceAgent.findUnique({ where: { key: agent.key } });
      const data = agentData(agent);
      if (!existing) {
        const created = await tx.customerServiceAgent.create({ data: { key: agent.key, ...data } });
        actualAgentIds.set(agent.id, created.id);
        result.createdAgents += 1;
        continue;
      }
      actualAgentIds.set(agent.id, existing.id);
      if (fieldsChanged(existing, data)) {
        await tx.customerServiceAgent.update({ where: { id: existing.id }, data });
        result.updatedAgents += 1;
      }
    }

    for (const skill of seeded.agentSkills) {
      const actualAgentId = actualAgentIds.get(skill.agentId);
      if (!actualAgentId) throw new Error(`default Agent missing for Skill: ${skill.agentId}`);
      const candidates = await tx.agentSkill.findMany({ where: { agentId: actualAgentId } });
      const existing = candidates.find((item: any) => canonicalSkillName(item.name) === canonicalSkillName(skill.name));
      const data = { name: skill.name, description: skill.description, enabled: skill.enabled };
      if (!existing) {
        await tx.agentSkill.create({ data: { agentId: actualAgentId, version: 1, ...data } });
        result.createdSkills += 1;
      } else if (fieldsChanged(existing, data)) {
        await tx.agentSkill.update({ where: { id: existing.id }, data });
        result.updatedSkills += 1;
      }
    }

    result.changed = Boolean(result.createdAgents || result.updatedAgents || result.createdSkills || result.updatedSkills);
    if (!result.changed) return { ...result, status: "UNCHANGED" };

    await tx.reviewLog.create({ data: {
      targetType: "system",
      targetId: "default_agent_configuration",
      decision: "initialize_prisma_agents",
      reviewer: operator,
      note: "Explicit idempotent initialization of default customer-service agents and skills.",
      beforeStatus: "checked",
      afterStatus: "initialized",
      metadata: {
        source: "prisma:agents:init",
        createdAgents: result.createdAgents,
        updatedAgents: result.updatedAgents,
        createdSkills: result.createdSkills,
        updatedSkills: result.updatedSkills,
        agentKeys: seeded.agents.map((agent) => agent.key),
      },
    }});
    return result;
  });
}

function agentData(agent: any) {
  return {
    name: agent.name,
    scene: agent.scene,
    description: agent.description,
    valueLevel: agent.valueLevel,
    enabled: agent.enabled,
    sortOrder: agent.sortOrder,
  };
}

function fieldsChanged(current: any, desired: any) {
  return Object.entries(desired).some(([key, value]) => current?.[key] !== value);
}

function canonicalSkillName(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}
