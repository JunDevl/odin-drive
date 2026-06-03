/*
 Warnings:
 
 - Added the required column `name` to the `File` table without a default value. This is not possible if the table is not empty.
 
 */
-- AlterTable
ALTER TABLE "File"
ADD COLUMN name TEXT GENERATED ALWAYS AS (
    CASE
      WHEN path LIKE '%/' THEN reverse(split_part(reverse(rtrim(path, '/')), '/', 1))
      ELSE reverse(split_part(reverse(path), '/', 1))
    END
  ) VIRTUAL;