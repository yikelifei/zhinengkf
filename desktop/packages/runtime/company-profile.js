"use strict";

const fs = require("node:fs");
const path = require("node:path");

const COMPANY_PROFILE_SCHEMA_VERSION = "smart_kefu_company_profile_v1";
const MAX_COMPANY_PROFILE_BYTES = 64 * 1024;

const ENUMS = Object.freeze({
  ownership: new Set(["company"]),
  edition: new Set(["single_company_internal"]),
  directorySource: new Set(["wechat_work"]),
  servicerProvisioning: new Set(["company_admin_managed"]),
  desktopOperatorAccounts: new Set(["not_enabled"]),
  deploymentMode: new Set(["managed_host"]),
  runtimeCredentialPolicy: new Set(["external_private_runtime"]),
  employeeSetup: new Set(["zero_secret"]),
});

function resolveCompanyProfilePath(options = {}) {
  const requested = String(
    options.filePath || process.env.SMART_KEFU_COMPANY_PROFILE_FILE || path.join(process.cwd(), "config", "company-profile.json"),
  ).trim();
  if (!requested) throw new Error("Company profile path is empty");
  return path.resolve(requested);
}

function loadCompanyProfile(options = {}) {
  const filePath = resolveCompanyProfilePath(options);
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Company profile must be a regular file: ${filePath}`);
  if (stat.size <= 0 || stat.size > MAX_COMPANY_PROFILE_BYTES) {
    throw new Error(`Company profile size is invalid: ${stat.size}`);
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return validateCompanyProfile(parsed);
}

function validateCompanyProfile(value) {
  const profile = exactObject(value, "company profile", [
    "schemaVersion",
    "profileId",
    "organization",
    "workspace",
    "wechatWork",
    "employeeAccess",
    "deployment",
    "publicEndpoints",
  ]);
  if (profile.schemaVersion !== COMPANY_PROFILE_SCHEMA_VERSION) {
    throw new Error(`Unsupported company profile schema: ${String(profile.schemaVersion || "missing")}`);
  }

  const organization = exactObject(profile.organization, "organization", ["displayName"]);
  const workspace = exactObject(profile.workspace, "workspace", ["displayName", "productName", "ownership", "edition"]);
  const wechatWork = exactObject(profile.wechatWork, "wechatWork", ["accountDisplayName"]);
  const employeeAccess = exactObject(profile.employeeAccess, "employeeAccess", [
    "directorySource",
    "servicerProvisioning",
    "desktopOperatorAccounts",
  ]);
  const deployment = exactObject(profile.deployment, "deployment", [
    "mode",
    "runtimeCredentialPolicy",
    "employeeSetup",
  ]);
  const publicEndpoints = exactObject(profile.publicEndpoints, "publicEndpoints", ["customerServiceBaseUrl"]);

  const validated = {
    schemaVersion: COMPANY_PROFILE_SCHEMA_VERSION,
    profileId: identifier(profile.profileId, "profileId"),
    organization: {
      displayName: displayText(organization.displayName, "organization.displayName"),
    },
    workspace: {
      displayName: displayText(workspace.displayName, "workspace.displayName"),
      productName: displayText(workspace.productName, "workspace.productName"),
      ownership: enumValue(workspace.ownership, "workspace.ownership", ENUMS.ownership),
      edition: enumValue(workspace.edition, "workspace.edition", ENUMS.edition),
    },
    wechatWork: {
      accountDisplayName: displayText(wechatWork.accountDisplayName, "wechatWork.accountDisplayName"),
    },
    employeeAccess: {
      directorySource: enumValue(employeeAccess.directorySource, "employeeAccess.directorySource", ENUMS.directorySource),
      servicerProvisioning: enumValue(
        employeeAccess.servicerProvisioning,
        "employeeAccess.servicerProvisioning",
        ENUMS.servicerProvisioning,
      ),
      desktopOperatorAccounts: enumValue(
        employeeAccess.desktopOperatorAccounts,
        "employeeAccess.desktopOperatorAccounts",
        ENUMS.desktopOperatorAccounts,
      ),
    },
    deployment: {
      mode: enumValue(deployment.mode, "deployment.mode", ENUMS.deploymentMode),
      runtimeCredentialPolicy: enumValue(
        deployment.runtimeCredentialPolicy,
        "deployment.runtimeCredentialPolicy",
        ENUMS.runtimeCredentialPolicy,
      ),
      employeeSetup: enumValue(deployment.employeeSetup, "deployment.employeeSetup", ENUMS.employeeSetup),
    },
    publicEndpoints: {
      customerServiceBaseUrl: publicHttpsOrigin(
        publicEndpoints.customerServiceBaseUrl,
        "publicEndpoints.customerServiceBaseUrl",
      ),
    },
  };

  return deepFreeze(validated);
}

function exactObject(value, label, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const keys = Object.keys(value);
  const unexpected = keys.filter((key) => !allowedKeys.includes(key));
  const missing = allowedKeys.filter((key) => !keys.includes(key));
  if (unexpected.length) throw new Error(`${label} contains unsupported fields: ${unexpected.join(", ")}`);
  if (missing.length) throw new Error(`${label} is missing fields: ${missing.join(", ")}`);
  return value;
}

function displayText(value, label) {
  const text = String(value || "").trim();
  if (!text || text.length > 80 || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${label} is invalid`);
  return text;
}

function identifier(value, label) {
  const text = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(text)) throw new Error(`${label} is invalid`);
  return text;
}

function enumValue(value, label, allowed) {
  const text = String(value || "").trim();
  if (!allowed.has(text)) throw new Error(`${label} is unsupported`);
  return text;
}

function publicHttpsOrigin(value, label) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error(`${label} must be a valid HTTPS origin`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${label} must be a credential-free HTTPS origin`);
  }
  return parsed.origin;
}

function deepFreeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object" && !Object.isFrozen(child)) deepFreeze(child);
  }
  return value;
}

module.exports = {
  COMPANY_PROFILE_SCHEMA_VERSION,
  loadCompanyProfile,
  resolveCompanyProfilePath,
  validateCompanyProfile,
};
