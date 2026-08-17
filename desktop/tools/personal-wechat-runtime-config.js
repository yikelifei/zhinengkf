"use strict";

const path = require("node:path");
const { atomicWritePrivateJson, readPrivateJsonFile } = require("./private-runtime-file");

const REGISTRY_VERSION = "personal_wechat_rpa_registry_v1";

function ensurePersonalWechatRuntimeRegistry(runtimeDir) {
  const root = path.resolve(runtimeDir);
  const configFile = path.join(root, "personal-wechat-rpa.json");
  const storeFile = path.join(root, "local-store.json");
  const accountsFile = path.join(root, "personal-wechat-accounts.json");
  let config = safeReadJson(configFile);
  const store = safeReadJson(storeFile);
  if (!isObject(config) || !isObject(store)) {
    return { migrated: false, accountsRepaired: false, wechatAccountId: "", reason: "runtime_config_or_store_missing" };
  }

  const legacyIdentity = {
    accountNickname: text(config.accountNickname),
    ownerWxId: text(config.ownerWxId),
    token: text(config.token),
  };
  const configuredInstances = Array.isArray(config.instances)
    ? config.instances.filter((item) => isObject(item) && item.enabled !== false && item.tombstone !== true)
    : [];
  let instance = selectConfiguredInstance(configuredInstances, legacyIdentity);
  let migrated = false;

  if (!instance) {
    if (configuredInstances.length > 0) {
      return { migrated: false, accountsRepaired: false, wechatAccountId: "", reason: "registry_identity_ambiguous" };
    }
    if (!legacyIdentity.accountNickname || !legacyIdentity.ownerWxId || !legacyIdentity.token) {
      return { migrated: false, accountsRepaired: false, wechatAccountId: "", reason: "legacy_identity_incomplete" };
    }
    const matches = matchingStoreAccounts(store, legacyIdentity);
    if (matches.length !== 1) {
      return {
        migrated: false,
        accountsRepaired: false,
        wechatAccountId: "",
        reason: matches.length > 1 ? "store_identity_ambiguous" : "store_identity_missing",
      };
    }
    instance = {
      wechatAccountId: text(matches[0].id),
      endpoint: normalizeEndpoint(config.endpoint, config.port),
      token: legacyIdentity.token,
      accountNickname: legacyIdentity.accountNickname,
      ownerWxId: legacyIdentity.ownerWxId,
      enabled: true,
    };
    const nextInstances = [
      ...configuredInstances.filter((item) => text(item.wechatAccountId) !== instance.wechatAccountId),
      instance,
    ];
    config = {
      ...config,
      registryVersion: REGISTRY_VERSION,
      instances: nextInstances,
      disabledInstances: Array.isArray(config.disabledInstances) ? config.disabledInstances : [],
    };
    atomicWritePrivateJson(configFile, config);
    migrated = true;
  }

  let configRepaired = false;
  const canonicalIdentity = canonicalStoreIdentity(store, instance);
  if (canonicalIdentity) {
    const nextInstance = {
      ...instance,
      accountNickname: canonicalIdentity.accountNickname,
      ownerWxId: canonicalIdentity.ownerWxId,
    };
    const nextConfig = {
      ...config,
      accountNickname: canonicalIdentity.accountNickname,
      ownerWxId: canonicalIdentity.ownerWxId,
      instances: configuredInstances
        .map((item) => text(item.wechatAccountId) === nextInstance.wechatAccountId ? nextInstance : item),
    };
    if (migrated) nextConfig.instances = [nextInstance];
    if (JSON.stringify(nextConfig) !== JSON.stringify(config)) {
      atomicWritePrivateJson(configFile, nextConfig);
      config = nextConfig;
      configRepaired = true;
    }
    instance = nextInstance;
  }

  const accounts = safeReadJson(accountsFile);
  const repaired = repairAccountsConfig(accounts, store, instance);
  if (repaired.changed) atomicWritePrivateJson(accountsFile, repaired.document);
  return {
    migrated,
    configRepaired,
    accountsRepaired: repaired.changed,
    wechatAccountId: text(instance.wechatAccountId),
    reason: migrated || configRepaired || repaired.changed ? "runtime_identity_aligned" : "already_aligned",
  };
}

function selectConfiguredInstance(instances, legacyIdentity) {
  const matches = instances.filter((item) =>
    text(item.accountNickname) === legacyIdentity.accountNickname &&
    text(item.ownerWxId) === legacyIdentity.ownerWxId &&
    text(item.wechatAccountId),
  );
  return matches.length === 1 ? { ...matches[0] } : null;
}

function matchingStoreAccounts(store, identity) {
  return (Array.isArray(store.wechatAccounts) ? store.wechatAccounts : []).filter((account) =>
    text(account?.platform) === "personal_wechat_rpa" &&
    text(account?.personalWechatRpa?.accountNickname || account?.displayName) === identity.accountNickname &&
    text(account?.personalWechatRpa?.ownerWxId || account?.alias) === identity.ownerWxId &&
    text(account?.id),
  );
}

function canonicalStoreIdentity(store, instance) {
  const accountId = text(instance?.wechatAccountId);
  const ownerWxId = text(instance?.ownerWxId);
  if (!accountId || !ownerWxId) return null;
  const matches = (Array.isArray(store.wechatAccounts) ? store.wechatAccounts : []).filter((account) =>
    text(account?.id) === accountId &&
    text(account?.platform) === "personal_wechat_rpa" &&
    text(account?.personalWechatRpa?.ownerWxId || account?.alias) === ownerWxId,
  );
  if (matches.length !== 1) return null;
  const accountNickname = text(matches[0]?.personalWechatRpa?.accountNickname || matches[0]?.displayName);
  if (!accountNickname) return null;
  return { accountNickname, ownerWxId };
}

function repairAccountsConfig(document, store, instance) {
  if (!isObject(document) || document.version !== "personal_wechat_accounts_v1" || !Array.isArray(document.accounts)) {
    return { changed: false, document };
  }
  const accountId = text(instance.wechatAccountId);
  const accountNickname = text(instance.accountNickname);
  const ownerWxId = text(instance.ownerWxId);
  const physicalMatches = document.accounts.filter((account) =>
    isObject(account) &&
    text(account.accountNickname || account.accountText) === accountNickname &&
    text(account.ownerWxId) === ownerWxId,
  );
  if (!accountId || physicalMatches.length === 0) return { changed: false, document };

  const base = physicalMatches.find((account) => text(account.wechatAccountId) === accountId) || physicalMatches[0];
  const bindings = (Array.isArray(store.personalWechatRpaBindings) ? store.personalWechatRpaBindings : [])
    .filter((binding) => text(binding.wechatAccountId) === accountId)
    .map((binding) => ({
      conversationId: text(binding.conversationId),
      customerId: text(binding.customerId),
      chatTitle: text(binding.chatTitle),
    }))
    .filter((binding) => binding.conversationId && binding.customerId && binding.chatTitle)
    .sort((left, right) => left.conversationId.localeCompare(right.conversationId));
  const nextAccount = {
    ...base,
    wechatAccountId: accountId,
    accountText: accountNickname,
    accountNickname,
    ownerWxId,
    conversations: bindings,
  };
  const physicalSet = new Set(physicalMatches);
  const firstPhysicalIndex = document.accounts.findIndex((account) => physicalSet.has(account));
  const remaining = document.accounts.filter((account) => !physicalSet.has(account));
  remaining.splice(Math.max(0, firstPhysicalIndex), 0, nextAccount);
  const next = { ...document, accounts: remaining };
  return {
    changed: JSON.stringify(next) !== JSON.stringify(document),
    document: next,
  };
}

function normalizeEndpoint(value, portValue) {
  const raw = text(value);
  if (raw) return raw.replace(/\/$/, "");
  const port = Number(portValue);
  return `http://127.0.0.1:${Number.isInteger(port) && port > 0 && port <= 65535 ? port : 3211}`;
}

function safeReadJson(filePath) {
  try {
    return readPrivateJsonFile(filePath, null);
  } catch {
    return null;
  }
}

function text(value) {
  return String(value || "").trim();
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  ensurePersonalWechatRuntimeRegistry,
  canonicalStoreIdentity,
  matchingStoreAccounts,
  repairAccountsConfig,
};
