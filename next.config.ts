import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The 4 MB upload cap plus room for multipart overhead; the actions enforce the cap themselves.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
};

export default nextConfig;
