import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  output: "export",
  basePath: "/dads_section/drum-remover-app",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
