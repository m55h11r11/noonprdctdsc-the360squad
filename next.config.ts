import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tree-shake huge barrel imports so we don't ship the entire icon set, the
  // entire motion runtime, or the entire Radix umbrella when we only use a
  // handful of components. Next 16 can do this automatically per package — we
  // just need to opt the packages in.
  experimental: {
    optimizePackageImports: ["lucide-react", "motion", "radix-ui"],
  },
};

export default nextConfig;
