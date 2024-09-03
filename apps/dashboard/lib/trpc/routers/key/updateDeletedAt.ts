import { db, eq, schema } from "@/lib/db";
import { ingestAuditLogs } from "@/lib/tinybird";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auth, t } from "../../trpc";

export const updateKeyDeletedAt = t.procedure
  .use(auth)
  .input(
    z.object({
      keyId: z.string(),
      deletedAt: z.date(),
      enabled: z.boolean(),
    }),
  )
  .mutation(async ({ input, ctx }) => {
    const key = await db.query.keys.findFirst({
      where: (table, { eq, and, isNull }) =>
        and(eq(table.id, input.keyId), isNull(table.deletedAt)),
      with: {
        workspace: true,
      },
    });
    if (!key || key.workspace.tenantId !== ctx.tenant.id) {
      throw new TRPCError({
        message:
          "We are unable to find the the correct key. Please contact support using support@unkey.dev.",
        code: "NOT_FOUND",
      });
    }

    try {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.keys)
          .set({
            deletedAt: input.deletedAt,
            enabled: input.enabled,
          })
          .where(eq(schema.keys.id, key.id));

        await ingestAuditLogs({
          workspaceId: key.workspace.id,
          actor: {
            type: "user",
            id: ctx.user.id,
          },
          event: "key.update",
          description: `Changed the deletion date of ${key.id} to ${input.deletedAt.toUTCString()}`,
          resources: [
            {
              type: "key",
              id: key.id,
            },
          ],
          context: {
            location: ctx.audit.location,
            userAgent: ctx.audit.userAgent,
          },
        }).catch((err) => {
          tx.rollback();
          throw err;
        });
      });
    } catch (_err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "We were unable to update this key. Please contact support using support@unkey.dev",
      });
    }
    return true;
  });
