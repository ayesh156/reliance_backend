import path from "path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Force load .env from explicit directory path
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, ".env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL || process.env["DATABASE_URL"] || "",
  },
});