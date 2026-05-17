/**
 * Project routes — CRUD for the workbench project registry.
 *
 * GET    /projects              — list all projects
 * POST   /projects              — create/register a project
 * GET    /projects/:name        — get project details
 * DELETE /projects/:name        — drop project + database
 * PATCH  /projects/:name/config — update project config
 */
import { FastifyInstance } from "fastify";
import { CreateProjectSchema } from "../schemas/index.js";
import {
  listProjects,
  getProject,
  createProject,
  deleteProject,
  updateProjectConfig,
} from "../services/projects.js";

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {

  app.get("/projects", async () => {
    return listProjects();
  });

  app.post("/projects", async (request, reply) => {
    const parsed = CreateProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }
    try {
      const project = await createProject(parsed.data);
      return reply.status(201).send(project);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        return reply.status(409).send({ error: msg });
      }
      throw err;
    }
  });

  app.get("/projects/:name", async (request, reply) => {
    const { name } = request.params as { name: string };
    const project = await getProject(name);
    if (!project) {
      return reply.status(404).send({ error: `Project '${name}' not found` });
    }
    return project;
  });

  app.delete("/projects/:name", async (request, reply) => {
    const { name } = request.params as { name: string };
    const project = await getProject(name);
    if (!project) {
      return reply.status(404).send({ error: `Project '${name}' not found` });
    }
    await deleteProject(name);
    return { status: "deleted", project: name };
  });

  app.patch("/projects/:name/config", async (request, reply) => {
    const { name } = request.params as { name: string };
    const body = request.body as Record<string, unknown>;
    if (!body || typeof body !== "object") {
      return reply.status(400).send({ error: "Body must be a JSON object" });
    }
    try {
      const project = await updateProjectConfig(name, body);
      return project;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) {
        return reply.status(404).send({ error: msg });
      }
      throw err;
    }
  });
}
