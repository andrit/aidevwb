/**
 * Export routes — generate production stack from workbench infrastructure.
 *
 * POST /projects/:name/export — generate a self-contained production stack
 *
 * Not project-middleware-scoped (uses :name param directly for clarity).
 */
import { FastifyInstance } from "fastify";
import { ExportStackSchema } from "../schemas/index.js";
import { getProject } from "../services/projects.js";
import { exportStack } from "../services/export.js";

export async function registerExportRoutes(
  app: FastifyInstance
): Promise<void> {

  app.post("/projects/:name/export", async (request, reply) => {
    const { name } = request.params as { name: string };
    const project = await getProject(name);
    if (!project) {
      return reply.status(404).send({ error: `Project '${name}' not found` });
    }

    const parsed = ExportStackSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }

    const result = await exportStack(
      name,
      project.directory,
      parsed.data.format,
      parsed.data.include_data,
      parsed.data.output_dir
    );

    return result;
  });
}
