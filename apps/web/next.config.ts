import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  output: "export",
  reactStrictMode: true,
  transpilePackages: ["@relay/contracts", "@relay/domain"],
};

if (process.env.NODE_ENV === "production") {
  nextConfig.assetPrefix = ".";
}

export default nextConfig;
