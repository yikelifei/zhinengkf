"use strict";

function commandLineOutsideCurrentRoot(commandLine, normalizedRoot) {
  const current = String(commandLine || "");
  const root = String(normalizedRoot || "");
  if (!current || !root || !current.includes(root)) return current;
  return current.split(root).join("");
}

function commandLineReferencesNestedLegacyRuntime(commandLine, normalizedRoot, legacyRuntimeMarker) {
  const marker = String(legacyRuntimeMarker || "");
  if (!marker) return false;
  return commandLineOutsideCurrentRoot(commandLine, normalizedRoot).includes(marker);
}

module.exports = {
  commandLineOutsideCurrentRoot,
  commandLineReferencesNestedLegacyRuntime,
};
