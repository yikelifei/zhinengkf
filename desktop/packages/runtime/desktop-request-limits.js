"use strict";

// Images are transferred as base64 inside JSON. Keep the transport boundary
// aligned with the storage/fingerprint boundary while allowing JSON metadata.
const MAX_STORED_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BASE64_IMAGE_BYTES = 4 * Math.ceil(MAX_STORED_IMAGE_BYTES / 3);
const DESKTOP_API_JSON_OVERHEAD_BYTES = 1024 * 1024;
const MAX_DESKTOP_API_JSON_BODY_BYTES = MAX_BASE64_IMAGE_BYTES + DESKTOP_API_JSON_OVERHEAD_BYTES;

module.exports = {
  DESKTOP_API_JSON_OVERHEAD_BYTES,
  MAX_BASE64_IMAGE_BYTES,
  MAX_DESKTOP_API_JSON_BODY_BYTES,
  MAX_STORED_IMAGE_BYTES,
};
