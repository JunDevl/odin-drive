/*
  Warnings:

  - You are about to drop the `File` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_FileToUser` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "File" DROP CONSTRAINT "File_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "_FileToUser" DROP CONSTRAINT "_FileToUser_A_fkey";

-- DropForeignKey
ALTER TABLE "_FileToUser" DROP CONSTRAINT "_FileToUser_B_fkey";

-- DropTable
DROP TABLE "File";

-- DropTable
DROP TABLE "_FileToUser";

-- CreateTable
CREATE TABLE "Folder" (
    "path" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("path")
);

-- CreateTable
CREATE TABLE "_FolderToUser" (
    "A" TEXT NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_FolderToUser_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_FolderToUser_B_index" ON "_FolderToUser"("B");

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FolderToUser" ADD CONSTRAINT "_FolderToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "Folder"("path") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FolderToUser" ADD CONSTRAINT "_FolderToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
