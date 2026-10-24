import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // drizzle-kit 自动加载 .env；Neon 连接串由控制器统一注入后 push
    url: process.env.DATABASE_URL!,
  },
});
