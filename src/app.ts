import express from "express";
import cors from "cors";
import helmet from "helmet";
import { apiRouter } from "./api/routes.js";

/**
 * Express application factory — separates app definition from process listen (easier testing).
 */
export function createApp(): express.Application {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "256kb" }));
  app.use(apiRouter);
  return app;
}
