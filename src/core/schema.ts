import { z } from "zod";

const portSchema = z.number().int().min(1).max(65535);

export const profileSchema = z.object({
  auth: z
    .object({
      password: z.string().optional(),
      token: z.string().optional(),
      username: z.string().optional()
    })
    .default({}),
  description: z.string().min(1).optional(),
  ports: z
    .object({
      api: portSchema.optional(),
      cot: portSchema.optional(),
      enrollment: portSchema.optional(),
      federation: portSchema.optional()
    })
    .default({}),
  server: z.string().url(),
  tls: z
    .object({
      caFile: z.string().optional(),
      certFile: z.string().optional(),
      insecureSkipVerify: z.boolean().optional().default(false),
      keyFile: z.string().optional(),
      keyPassphrase: z.string().optional()
    })
    .default({ insecureSkipVerify: false })
});

export const configSchema = z.object({
  currentProfile: z.string().optional(),
  profiles: z.record(z.string(), profileSchema).default({}),
  schemaVersion: z.literal(1).default(1)
});

export type Profile = z.infer<typeof profileSchema>;
export type TakCliConfig = z.infer<typeof configSchema>;
