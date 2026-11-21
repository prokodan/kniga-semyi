import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Промпты читаются с диска в серверных функциях — включаем их в бандл Vercel.
  outputFileTracingIncludes: {
    "/**": ["./prompts/**/*.md", "./fixtures/**/*"],
  },
};

export default nextConfig;
