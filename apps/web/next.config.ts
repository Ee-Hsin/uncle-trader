import { dirname } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import type { NextConfig } from "next";

const configDirectory = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(configDirectory, "../../.env"), override: false, quiet: true });

const nextConfig: NextConfig = {};

export default nextConfig;
