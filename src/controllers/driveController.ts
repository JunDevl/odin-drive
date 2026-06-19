import type { RequestHandler } from "express";
import type { User, Folder } from "../generated/prisma/client.ts";
import { handleError, PromiseError } from "../utils.ts";
import { body, validationResult, type ValidationChain } from "express-validator";
import passport from "passport";
import prisma from "../../lib/prisma.ts";
import supabase from "../../lib/supabase.ts";
import multer from "multer";
import type { PrismaPromise, Return } from "@prisma/client/runtime/client";
const upload = multer({ storage: multer.memoryStorage() })

const queryParamsPath = (params: Record<string, any>) => 
  !params.splat || !(params.splat instanceof Array) ? "/" : 
  (params.splat as string[]).reduce((acc, cur) => `${acc !== "/" ? acc : ""}/${cur}`, "/");

const getChildrenPaths = async (parentPath: string) => {
  const searchQuery = parentPath + "%";

  // TODO: SANITIZE SEARCHQUERY SO USERS CAN'T TYPE "%", "/" OR ANY INVALID CHARACTERS!

  const foldersQuery = prisma.$queryRaw<string[]>`
    SELECT path FROM "Folder"
    WHERE path LIKE ${searchQuery}
  `;

  const filesQuery = prisma.$queryRaw<string[]>`
    SELECT name FROM storage.objects
    WHERE path LIKE ${searchQuery}
    AND path NOT LIKE '%/'
  `;

  return new Promise<{parentPath: string, children: string[]}>(async (resolve, reject) => {
    try {
      const subfolders = await foldersQuery;
      const subfiles = await filesQuery;

      const all = [...subfolders, ...subfiles];

      resolve({
        parentPath,
        children: all
      });
    } catch (e) {
      reject(e);
    }
  });
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
  const user: User = req.user as User;

  if (!req.query.file_path) return res.status(400).send("No file paths provided.");

  let paths = req.query.file_path instanceof Array ? String(req.query.file_path) : [String(req.query.file_path)];

  let supabaseQueryString: string = '';

  let folderPathsQueryString: string = '';

  for (const path of paths) {
    supabaseQueryString += `,${user.id}${path}%`

    if (!path.endsWith("/")) continue;

    folderPathsQueryString += `,${path}%`
  }

  const pathsSqlArrayString = `{${folderPathsQueryString}}`;
  const pathsSqlSupabaseArrayString = `{${supabaseQueryString}}`

  let filesToBeDeleted: string[]

  try {
    await prisma.$queryRaw`
      DELETE FROM "Folder"
      WHERE path LIKE ANY(${pathsSqlArrayString})
    `

    filesToBeDeleted = await prisma.$queryRaw`
      SELECT name FROM storage.objects
      WHERE name LIKE ANY (${pathsSqlSupabaseArrayString})
    `
  } catch (e) {
    return res.status(400).send(e);
  }

  const { error } = await supabase.storage.from("drives").remove(filesToBeDeleted);

  if (error) res.status(400).send(error);

  res.send();
}]

export const renameFile: RequestHandler[] = [async (req, res, next) => {
  const user: User = req.user as User;

  const {rename, path} = req.query as {rename: string, path: string};

  const isFolder = path.endsWith('/');

  const getBasePath = (path: string) => {
    const lastIndex = path.slice(0, -1).lastIndexOf("/") >= 0 ? path.slice(0, -1).lastIndexOf("/") : 0;

    if (lastIndex < 0) return res.status(400).send("Path must point to a valid parent folder.");

    return lastIndex ? path.slice(0, lastIndex) : "/";
  }

  const basePath = getBasePath(path);

  let newPath = `${basePath}/${rename}/`;

  if (!isFolder) {
    const { error } = await supabase.storage.from("drives").move(`${user.id}${path}`, `${user.id}${newPath}`);

    if (error) return res.status(400).send(error);
    
    return res.send();
  }

  let childrenPaths: string[];

  const queries: Promise<any>[] = [];

  try {
    childrenPaths = (await getChildrenPaths(path)).children;
  } catch (e) {
    return res.status(400).send(e);
  }

  for (let path of childrenPaths) {
    const isChildFolder = path.endsWith('/');

    const supabaseOriginPath = `${user.id}${path}`;
    const supabaseNewPath = `${user.id}${newPath}`;

    if (isChildFolder) {
      queries.push(prisma.folder.update({
        data: {path: newPath},
        where: {path}
      }))

      const { data: folderExists } = await supabase.storage.from("drives").exists(supabaseOriginPath);

      if (!folderExists) continue;
    }

    const { error } = await supabase.storage.from("drives").move(supabaseOriginPath, supabaseNewPath);

    if (error) return res.status(400).send(error);
  }

  // FIXME: Wtf is wrong with this renameFile function... It's completely and utterly shit.

  res.send();
}]

export const updateFiles: RequestHandler[] = [async (req, res, next) => {
  const user: User = req.user as User;

  if (!req.query.file_path) return res.status(400).send("No file paths provided.");

  const paths = req.query.file_path instanceof Array ? String(req.query.file_path) : [String(req.query.file_path)];

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

  const childrenQueries: ReturnType<typeof getChildrenPaths>[] = []

  const foldersChildren: {
    parentPath: string,
    children: string[]
  }[] = [];

  const prismaQueries: Promise<any>[] = [];
  const supabaseQueries: Promise<any>[] = [];

  // supabase.storage.from("drives").list

  const supabaseStorageQueries = [];

  type MovePath = {originPath: string, destinationPath: string};

  let movePaths: MovePath[] = [];

  for (const path of paths) 
    if (path.endsWith("/")) childrenQueries.push(getChildrenPaths(path));

  const foldersAndFiles: Set<string> = new Set();

  try {
    await Promise.all(childrenQueries).then(res => foldersChildren.push(...res));
  } catch (e) {
    res.status(400).send(e);
  }

  for (const folderChildren of foldersChildren) 
    movePaths.push(...folderChildren.children.map(childPath => ({
      originPath: childPath, 
      destinationPath: filePathDestination(folderChildren.parentPath, childPath)
    })))

  for (const updatePath of movePaths) {
    let {originPath, destinationPath} = updatePath;

    const isFolder = originPath.endsWith("/");
    
    if (isFolder) {
      prismaQueries.push(req.body.move ? 
        prisma.folder.update({
          data: {
            path: destinationPath
          },
          where: { path: originPath }
        }) :
        prisma.folder.create({
          data: {
            ownerId: user.id,
            path: destinationPath
          }
        })
      );

      originPath = `${user.id}${originPath}`;
      destinationPath = `${user.id}${destinationPath}`;

      const { data: folderExists } = await supabase.storage.from("drives").exists(originPath);
  
      if (!folderExists) continue;
    }
    
    supabaseQueries.push(req.body.move ? 
      supabase.storage.from("drives").move(originPath, destinationPath) :
      supabase.storage.from("drives").copy(originPath, destinationPath)
    );
  }

  try {
    await Promise.all(prismaQueries);
    await Promise.all(supabaseQueries); // FIXME: this is not how supabase handles errors...
  } catch (e) {
    res.status(400).send();
  }

  return res.send();
}]