import type { RequestHandler } from "express";
import type { User, File } from "../generated/prisma/client.ts";
import { handleError } from "../utils.ts";
import { PromiseError } from "../utils.ts";
import { body, validationResult, type ValidationChain } from "express-validator";
import passport from "passport";
import prisma from "../../lib/prisma.ts";
import supabase from "../../lib/supabase.ts";
import multer from "multer";
const upload = multer({ storage: multer.memoryStorage() }) //TODO!

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

export const createFile: RequestHandler[] = [
  upload.single("file"),
  async (req, res, next) => {
    const user: User = req.user as User;

    const filename = req.file?.originalname;
    const path = `${req.params.rest}${filename}`

    console.log(path);
    console.log(req.file!);

    return next();
  }
]

export const deleteFiles: RequestHandler[] = [async (req, res, next) => {
  const user: User = req.user as User;

  return next();
}]