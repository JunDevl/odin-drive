import type { RequestHandler } from "express";
import type { User, Folder } from "../generated/prisma/client.ts";
import { handleError, PromiseError } from "../utils.ts";
import { body, validationResult, type ValidationChain } from "express-validator";
import passport from "passport";
import prisma from "../../lib/prisma.ts";
import supabase from "../../lib/supabase.ts";
import multer from "multer";
import type { PrismaPromise } from "@prisma/client/runtime/client";
const upload = multer({ storage: multer.memoryStorage() })

const queryParamsPath = (params: Record<string, any>) => 
  !params.splat || !(params.splat instanceof Array) ? "/" : 
  (params.splat as string[]).reduce((acc, cur) => `${acc !== "/" ? acc : ""}/${cur}`, "/");

const getFolderChildrenQuery = async (parentPath: string) => {
  const searchQuery = parentPath + "%";

  // TODO: SANITIZE SEARCHQUERY SO USERS CAN'T TYPE "%", "/" OR ANY INVALID CHARACTERS!

  const query = prisma.$queryRaw`
    SELECT * FROM "Folder"
    WHERE path LIKE ${searchQuery}
  ` as PrismaPromise<Folder[]>;

  query.then(res => ({
    parentPath,
    children: res
  }))

  return new Promise(async (resolve, reject) => {
    const subfolders = await query;

    resolve({
      parentPath,
      children: subfolders
    });

    reject(subfolders);
  }) as Promise<{parentPath: string, children: Folder[]}>;
}

export const getUserFiles: RequestHandler = async (req, res) => {        
  const query = req.query.query as string | undefined;

  const user: User = req.user as User;

  if (query === "") return res.redirect("/drive");

  const path = queryParamsPath(req.params!);

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
    const path = queryParamsPath(req.params);

    // TODO: SANITIZE FOLDER/FILE NAME SO USERS CAN'T TYPE "%", "/" OR ANY INVALID CHARACTERS!

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
  const user: User = req.user as User;

  let filePaths: string[] = [];
  let folderPaths: string[] = [];

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

      filePaths.push(path);
    };
  }

  let destination: string = req.body.move || req.body.copy;

  if (!destination.startsWith("/")) destination = "/" + destination;
  if (!destination.endsWith("/")) destination += "/";

  const filePathDestination = (parentPath: string, filePath: string) => {
    const parentName = parentPath.split("/").at(-2) + "/";
    
    const relativePath = filePath.length < parentPath.length ?
      filePath.split("/").at(-2) + "/" :
      filePath.slice(parentPath.length - parentName.length)

    return destination + relativePath;
  }

  const subfolderQueries: ReturnType<typeof getFolderChildrenQuery>[] = []

  const foldersChildren: {
    parentPath: string,
    children: Folder[]
  }[] = [];

  const queries: Promise<any>[] = [];

  supabase.storage.from("drives").list

  const supabaseStorageQueries = [];

  type FileMovePaths = {originPath: string, destinationPath: string};

  let foldersMovePaths: FileMovePaths[] = [];

  for (const folderPath of folderPaths) 
    subfolderQueries.push(getFolderChildrenQuery(folderPath));

  const foldersAndFiles: Set<string> = new Set();

  await Promise.all(subfolderQueries)
    .then(res => {
      foldersChildren.push(...res)
      
    });

  for (const folderChildren of foldersChildren) 
    foldersMovePaths.push(...folderChildren.children.map(subfolder => ({
      originPath: subfolder.path, 
      destinationPath: filePathDestination(folderChildren.parentPath, subfolder.path)
    })))

  if (req.body.move) { // move route
    for (const movePath of foldersMovePaths) {
      queries.push(prisma.folder.update({
        data: {
          path: movePath.destinationPath
        },
        where: { path: movePath.originPath }
      }));

      const supabaseOriginalPath = `${user.id}${movePath.originPath}`;
      const supabaseDestinationPath = `${user.id}${movePath.destinationPath}`;

      const { data: folderExists } = await supabase.storage.from("drives").exists(supabaseOriginalPath);

      if (!folderExists) continue;
      
      const { error } = await supabase.storage.from("drives").move(supabaseOriginalPath, supabaseDestinationPath);

      if (error) return res.status(400).send(error);

      // TODO: IF THE DIRECTORY CONTAINS FILES, UPDATE SUPABASE AS WELL!
    }

    // TODO: CHECK filePaths AS WELL!
    for (const filePath of filePaths) {
      const supabaseOriginalPath = `${user.id}${filePath}`;
      // const supabaseDestinationPath = `${user.id}${movePath.destinationPath}`;
    }
    

    await Promise.all(queries);
  }

  if (req.body.copy) { // copy route

    for (const copyPath of foldersMovePaths) {
      queries.push(prisma.folder.create({
        data: {
          ownerId: user.id,
          path: copyPath.destinationPath
        }
      }));

      const supabaseOriginalPath = `${user.id}${copyPath.originPath}`;
      const supabaseDestinationPath = `${user.id}${copyPath.destinationPath}`;

      const folderExists = await supabase.storage.from("drives").exists(supabaseOriginalPath);

      if (folderExists.error) return res.status(400).send(folderExists.error);

      if (!folderExists.data) continue;
      
      const { error } = await supabase.storage.from("drives").copy(supabaseOriginalPath, supabaseDestinationPath);

      if (error) return res.status(400).send(error);
    }
  
    // TODO: CHECK filePaths AS WELL!

    await Promise.all(queries);
  }

  return res.send();
}]