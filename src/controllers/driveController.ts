import type { RequestHandler } from "express";
import type { User, Folder } from "../generated/prisma/client.ts";
import { handleError, PromiseError } from "../utils.ts";
import { body, validationResult, type ValidationChain } from "express-validator";
import passport from "passport";
import prisma from "../../lib/prisma.ts";
import supabase from "../../lib/supabase.ts";
import multer from "multer";
import type { PrismaPromise, Return } from "@prisma/client/runtime/client";
import type { UUID } from "node:crypto";
const upload = multer({ storage: multer.memoryStorage() })

const queryParamsPath = (params: Record<string, any>) => 
  !params.splat || !(params.splat instanceof Array) ? "/" : 
  (params.splat as string[]).reduce((acc, cur) => `${acc !== "/" ? acc : ""}/${cur}`, "/");

const getChildrenPaths = async (userUUID: UUID, parentPath: string) => {
  const searchQuery = parentPath + "%";

  // TODO: SANITIZE SEARCHQUERY SO USERS CAN'T TYPE "%", "/" OR ANY INVALID CHARACTERS!

  const foldersQuery = prisma.$queryRaw<{path: string}[]>`
    SELECT path FROM "Folder"
    WHERE path LIKE ${searchQuery}
  `;

  const filesQuery = prisma.$queryRaw<{name: string}[]>`
    SELECT name FROM storage.objects
    WHERE name LIKE ${userUUID + searchQuery}
    AND name NOT LIKE '%/'
  `;

  return new Promise<{parentPath: string, children: string[]}>(async (resolve, reject) => {
    try {
      const subfolders = (await foldersQuery).map(subfolder => subfolder.path);
      const subfiles = (await filesQuery).map(subfile => subfile.name.slice(subfile.name.indexOf("/")));

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

  res.render("index", { files, query, path, pathArray: req.params.splat });
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

      return res.send();
    }

    await prisma.folder.create({
      data: {
        path: `${drivePath}/`,
        ownerId: user.id
      }
    });

    return res.send();
  }
]

export const deleteFiles: RequestHandler[] = [async (req, res, next) => {
  const user: User = req.user as User;

  if (!req.query.file_path) return res.status(400).send("No file paths provided.");

  let paths = req.query.file_path instanceof Array ? req.query.file_path.map(path => String(path)) : [String(req.query.file_path)];

  let supabaseQueryString: string = '';

  let folderPathsQueryString: string = '';

  let i = 0;

  for (const path of paths) {
    if (i === 0) {
      i++;

      supabaseQueryString += `${user.id}${path}%`

      if (!path.endsWith("/")) continue;

      folderPathsQueryString += `${path}%`

      continue;
    }

    i++;

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

    filesToBeDeleted = (await prisma.$queryRaw`
      SELECT name FROM storage.objects
      WHERE name LIKE ANY (${pathsSqlSupabaseArrayString})
    ` as Record<string, any>[]).map(row => row.name);
  } catch (e) {
    return res.status(400).send(e);
  }

  const { error } = await supabase.storage.from("drives").remove(filesToBeDeleted);

  if (error) return res.send(error);

  res.send();
}]

export const renameFile: RequestHandler[] = [async (req, res, next) => {
  const user: User = req.user as User;

  const {rename, path} = req.query as {rename: string, path: string};

  const isFolder = path.endsWith('/');

  const getBasePath = (path: string) => {
    const lastIndex = path.slice(0, -1).lastIndexOf("/") >= 0 ? path.slice(0, -1).lastIndexOf("/") : 0;

    if (lastIndex < 0) return res.status(400).send("Path must point to a valid parent folder.");

    return lastIndex ? path.slice(0, lastIndex) : "";
  }

  const basePath = getBasePath(path);

  const newPath = `${basePath}/${rename}${isFolder ? "/" : ""}`;

  if (!isFolder) {
    const originPath = `${user.id}${path}`;
    const renamePath = `${user.id}${newPath}`;

    const { error } = await supabase.storage.from("drives").move(originPath, renamePath);

    if (error) return res.status(400).send(error);
    
    return res.send();
  }

  let parentChildren: Awaited<ReturnType<typeof getChildrenPaths>>;

  const queries: Promise<any>[] = [];

  try {
    parentChildren = await getChildrenPaths(user.id as UUID, path);
  } catch (e) {
    return res.status(400).send(e);
  }

  const errorMessages = []

  for (let childPath of parentChildren.children) {
    const isChildFolder = childPath.endsWith('/');

    const childNewPath = `${newPath}${childPath.slice(0, path.length)}`;

    const supabaseOriginPath = `${user.id}${childPath}`;
    const supabaseNewPath = `${user.id}${childNewPath}`;

    if (isChildFolder) {
      queries.push(prisma.folder.update({
        data: {path: childNewPath},
        where: {path: childPath}
      }))

      // const { data: folderExistsInSupabase } = await supabase.storage.from("drives").exists(supabaseOriginPath);

      // if (!folderExistsInSupabase) continue;
    }

    const { error } = await supabase.storage.from("drives").move(supabaseOriginPath, supabaseNewPath);

    if (error) errorMessages.push(error);
  }

  res.send(errorMessages);
}]

export const updateFiles: RequestHandler[] = [async (req, res, next) => {
  const user: User = req.user as User;

  if (!req.query.file_path) return res.status(400).send("No file paths provided.");

  const paths = req.query.file_path instanceof Array ? req.query.file_path.map(path => String(path)) : [String(req.query.file_path)];

  let destination: string = req.body.move || req.body.copy;

  if (destination && !destination.startsWith("/")) destination = "/" + destination;
  if (destination && !destination.endsWith("/")) destination += "/";
  if (!destination) destination = "/";

  const filePathDestination = (parentPath: string, filePath: string) => {
    const grandParentPath = parentPath.slice(0, parentPath.slice(0, -1).lastIndexOf("/"));
    
    const relativePath = filePath.length < parentPath.length ?
      filePath.split("/").at(-2) + "/" :
      filePath.slice(grandParentPath.length);

    return destination + relativePath.slice(1);
  }

  const allChildrenQueries: ReturnType<typeof getChildrenPaths>[] = []

  const children: Awaited<ReturnType<typeof getChildrenPaths>>[] = [];

  const prismaQueries: Promise<any>[] = [];
  const supabaseQueries: 
    (ReturnType<ReturnType<typeof supabase.storage.from>["copy"]> | 
    ReturnType<ReturnType<typeof supabase.storage.from>["move"]>)[] = [];

  // supabase.storage.from("drives").list

  const supabaseStorageQueries = [];

  type MovePath = {originPath: string, destinationPath: string};

  let movePaths: MovePath[] = [];

  for (const path of paths) 
    allChildrenQueries.push(getChildrenPaths(user.id as UUID, path));

  const foldersAndFiles: Set<string> = new Set();

  try {
    await Promise.all(allChildrenQueries).then(res => children.push(...res));
  } catch (e) {
    return res.status(400).send(e);
  }

  for (const child of children) 
    movePaths.push(...child.children.map(childPath => ({
      originPath: childPath, 
      destinationPath: filePathDestination(child.parentPath, childPath)
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

      // const { data: folderExistsInSupabase } = await supabase.storage.from("drives").exists(originPath);
  
      // if (!folderExistsInSupabase) continue;
    }

    originPath = `${user.id}${originPath}`;
    destinationPath = `${user.id}${destinationPath}`;
    
    supabaseQueries.push(req.body.move ? 
      supabase.storage.from("drives").move(originPath, destinationPath) :
      supabase.storage.from("drives").copy(originPath, destinationPath)
    );
  }

  const errorMessages: any[] = []

  try {
    await Promise.all(prismaQueries);
  } catch (e) {
    return res.status(400).send();
  }

  await Promise.all(supabaseQueries).then(responses => {
    for (const res of responses) {
      const { error } = res;

      if (error) errorMessages.push(error);
    }
  });

  res.send({
    error: errorMessages
  });
}]