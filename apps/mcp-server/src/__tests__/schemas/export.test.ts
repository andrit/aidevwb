import { describe, it, expect } from "vitest";
import { ExportStackSchema, ExportFormatSchema } from "../../schemas/index.js";

describe("Export schemas", () => {
  describe("ExportFormatSchema", () => {
    it("accepts valid formats", () => {
      expect(ExportFormatSchema.safeParse("compose").success).toBe(true);
      expect(ExportFormatSchema.safeParse("terraform").success).toBe(true);
      expect(ExportFormatSchema.safeParse("migrations-only").success).toBe(true);
    });

    it("rejects invalid formats", () => {
      expect(ExportFormatSchema.safeParse("k8s").success).toBe(false);
      expect(ExportFormatSchema.safeParse("").success).toBe(false);
    });
  });

  describe("ExportStackSchema", () => {
    it("defaults format to compose", () => {
      const result = ExportStackSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.format).toBe("compose");
        expect(result.data.include_data).toBe(false);
      }
    });

    it("accepts full options", () => {
      const result = ExportStackSchema.safeParse({
        format: "terraform",
        include_data: true,
        output_dir: "/tmp/export",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid format", () => {
      expect(ExportStackSchema.safeParse({ format: "invalid" }).success).toBe(false);
    });
  });
});
