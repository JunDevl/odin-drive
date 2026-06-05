import type { RequestHandler } from "express";
import type { User, Folder } from "../generated/prisma/client.ts";
import { handleError } from "../utils.ts";
import { PromiseError } from "../utils.ts";
import { body, validationResult, type ValidationChain } from "express-validator";
import passport from "passport";
import prisma from "../../lib/prisma.ts";
import supabase from "../../lib/supabase.ts";
import multer from "multer";
const upload = multer({ storage: multer.memoryStorage() }) //TODO!

const getQueryParamsPath = (params: Record<string, any>) => 
  !params.splat || !(params.splat instanceof Array) ? "/" : 
  (params.splat as string[]).reduce((acc, cur) => `${acc !== "/" ? acc : ""}/${cur}`, "/");

export const getUserFiles: RequestHandler = async (req, res) => {        
  const query = req.query.query as string | undefined;
  const path = req.query.path || "";

  const user: User = req.user as User;

  if (query === "") return res.redirect("/drive");

  const path = getQueryParamsPath(req.params!);

  const sqlFileQuery = `^${user.id}${path === "/" ? "" : path}/[^/]+/?$`

  const sqlFolderQuery = `^${path === "/" ? "" : path}/[^/]+/?$`

  const folders: (Folder & {name?: string, metadata: Record<string, any>, kind?: "folder"})[] = await prisma.$queryRaw`
    SELECT * FROM "Folder"
    WHERE path ~ ${sqlFolderQuery}
    ORDER BY path
  ` ?? [];

  folders.forEach(folder => {
    const pathSplit = folder.path.split("/");
    const folderName = pathSplit.at(-1) || pathSplit.at(-2);

    folder.name = folderName;
    folder["metadata"] = {};
    folder.metadata.size = null;
    folder.kind = "folder";
  });

  let files: Record<string, any>[] = await prisma.$queryRaw`
    SELECT name, created_at, updated_at, path_tokens, metadata::jsonb FROM storage.objects 
    WHERE array_to_string(path_tokens, '/') ~ ${sqlFileQuery}
    ORDER BY name
  ` ?? [];

  files.forEach(file => {
    const fileName = file.path_tokens.at(-1) || file.path_tokens.at(-2);

    const [id, ...pathSplit] = file.path_tokens;

    file.path = (pathSplit as string[]).reduce((acc, cur) => `${acc === "/" ? "" : acc}/${cur}`, "/");
    file.name = fileName;
    file.kind = "file";
  });

  files = [...folders, ...files];

  return res.status(200).render("index", { files, query, path, pathArray: req.params.splat });
}

export const createFile: RequestHandler[] = [
  upload.single("file"),
  async (req, res, next) => {
    const user: User = req.user as User;
    const path = getQueryParamsPath(req.params);

    const filename = req.file ? req.file.originalname : req.body.file;
    const drivePath = `${path === "/" ? "" : path}/${filename}`
    
    if (req.file) {
      const supabasePath = `${user.id}${drivePath}`

      const { error } = await supabase.storage
        .from("drives")
        .upload(supabasePath, req.file.buffer);

      if (error) return res.status(400).send(error);

      return res.redirect(`/drive${path === "/" ? "" : path}`);
    }

    await prisma.folder.create({
      data: {
        path: `${drivePath}/`,
        ownerId: user.id
      }
    });

    return res.status(201).redirect(`/drive${path === "/" ? "" : path}`);
  }
]

export const deleteFiles: RequestHandler[] = [async (req, res, next) => {
  let filePaths = [];
  let folderPaths = [];

  if (!(req.query.file_path instanceof Array)) {
    if ((req.query.file_path as string).endsWith("/")) folderPaths.push(req.query.file_path);
    else filePaths.push(req.query.file_path);
  }

  if (req.query.file_path instanceof Array) {
    for (const path of req.query.file_path) {
      if ((path as string).endsWith("/")) {
        folderPaths.push(path);
        continue;
      }

      folderPaths.push(path);
    };
  }

  if (filePaths.length > 0) {

  }

  if (folderPaths.length > 0) {
    const pathsSqlArrayString = `{${
      folderPaths
        .map(path => `${path}%`)
        .reduce((acc, cur) => `${acc},${cur}`)
    }}`;
    const deletedFolders = await prisma.$queryRaw`
      DELETE FROM "Folder"
      WHERE path LIKE ANY(${pathsSqlArrayString})
    `

    // TODO: DELETE SUB-FOLDERS AND CHILDREN FROM SUPABASE STORAGE AS WELL!
  }

  res.send();
}]

export const renameFile: RequestHandler[] = [async (req, res, next) => {
  const {rename, path} = req.query as {rename: string, path: string};

  const basePath = path !== "/" ?
    path.split("/")
      .slice(0, -2)
      .reduce((acc, cur) => `${acc}/${cur}`) :
    "";

  if (path.endsWith("/")) { // it's a folder
    const newPath = `${basePath}/${rename}/`

    await prisma.folder.update({
      data: {path: newPath},
      where: {path}
    })
  } else { // it's a file

  }

  res.send();
}]

export const updateFiles: RequestHandler[] = [async (req, res, next) => {
  let filePaths = [];
  let folderPaths = [];

  if (!(req.body.file_path instanceof Array)) {
    if ((req.body.file_path as string).endsWith("/")) folderPaths.push(req.body.file_path);
    else filePaths.push(req.body.file_path);
  }

  if (req.body.file_path instanceof Array) {
    for (const path of req.body.file_path) {
      if ((path as string).endsWith("/")) {
        folderPaths.push(path);
        continue;
      }

      folderPaths.push(path);
    };
  }

  if (req.body.move) { // move route
    if (folderPaths.length > 0) {
      // TODO: iterate over all folder paths and execute an update query every loop to update the path of all target folders to destination
      folderPaths.forEach((path: string) => {
        const name = path.split("/")
          .slice(0, -2)
          .reduce((acc, cur) => `${acc !== "/" ? acc : ""}/${cur}`, "/");
      })

      //

      // await prisma.folder.updateMany({
        
      // })
    }

    if (filePaths.length > 0) {
  
    }
  }

  if (req.body.copy) {
    if (folderPaths.length > 0) {
        
    }
  
    if (filePaths.length > 0) {
  
    }
  }


  res.send();
}]