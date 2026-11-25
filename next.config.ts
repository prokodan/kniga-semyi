import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Промпты читаются с диска в серверных функциях — включаем их в бандл Vercel.
  outputFileTracingIncludes: {
    "/**": ["./prompts/**/*.md", "./fixtures/**/*"],
    // Шрифты книги (I5) читаются с диска при сборке PDF — кладём их в функцию.
    "/api/books/**": ["./public/fonts/**/*"],
  },
};

export default nextConfig;
