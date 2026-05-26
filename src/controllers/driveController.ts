import type { RequestHandler } from "express";
import type { User, File } from "../generated/prisma/client.ts";
import { handleError } from "../utils.ts";
import { PromiseError } from "../utils.ts";
import { body, validationResult, type ValidationChain } from "express-validator";
import passport from "passport";
import prisma from "../../lib/prisma.ts";

export const getUserFiles: RequestHandler = async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/log-in");
  
  const query = req.query.query as string | undefined;

  const user: User = req.user as User;

  if (query === "") return res.redirect("/drive");

  const files = await prisma.file.findMany({
    where: { ownerId: user.id },
    orderBy: {
      _relevance: !query ? undefined : {
        fields: ["path"],
        search: query,
        sort: "desc",
      },
      path: "desc"
    }
  }) ?? []

  return res.render("index", { files, query });
}