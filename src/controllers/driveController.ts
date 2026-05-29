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
  const path = req.query.path || "";

  const user: User = req.user as User;

  if (query === "") return res.redirect("/drive");

  const sqlQuery = `^${path}/[^/]+/?$` //

  const files: File[] = await prisma.$queryRaw`
    SELECT * FROM "File" 
    WHERE path ~ ${sqlQuery}
  ` ?? []

  return res.render("index", { files, query });
}

export const createFile: RequestHandler[] = [
  upload.single("file"),
  async (req, res, next) => {
    const user: User = req.user as User;

    // const supabaseData = await supabase.auth.getUser();

    const filename = req.file ? req.file.originalname : req.body.file;
    const drivePath = `${req.query.path || ""}/${filename}`
    const supabasePath = `${user!.id}${drivePath}`

    const folder = await prisma.file.create({
      data: {
        path: req.file ? drivePath : `${drivePath}/`,
        ownerId: user!.id
      }
    })

    if (!req.file) return res.send('Folder created');
 
    const { data, error } = await supabase.storage
      .from("drives")
      .upload(supabasePath, req.file.buffer);

    if (error) return res.status(400).send(error);

    return res.send(data);
  }
]

export const deleteFiles: RequestHandler[] = [async (req, res, next) => {
  const user: User = req.user as User;

  return next();
}]