-- AlterTable
ALTER TABLE files
ADD COLUMN name TEXT GENERATED ALWAYS AS (
    CASE
      WHEN path LIKE '%/' THEN reverse(split_part(reverse(rtrim(path, '/')), '/', 1))
      ELSE reverse(split_part(reverse(path), '/', 1))
    END
  ) STORED;