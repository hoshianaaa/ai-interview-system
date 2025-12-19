import dotenv from "dotenv";
import path from "node:path";
import type { NextConfig } from "next";

dotenv.config({ path: path.join(__dirname, ".env") });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname
  }
};

export default nextConfig;
