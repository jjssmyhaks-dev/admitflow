import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Makes the Cloudflare bindings (D1 `DB`, R2 `FILES`) available to `next dev`
// through the same wrangler config the Sites build uses.
initOpenNextCloudflareForDev({ configPath: "./freebuff.wrangler.jsonc" });

const nextConfig: NextConfig = {};

export default nextConfig;
