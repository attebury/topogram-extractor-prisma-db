CREATE TABLE "User" (
  "id" text PRIMARY KEY,
  "email" text NOT NULL UNIQUE,
  "name" text,
  "role" text NOT NULL
);

CREATE TABLE "Post" (
  "id" text PRIMARY KEY,
  "title" text NOT NULL,
  "published" boolean NOT NULL DEFAULT false,
  "authorId" text NOT NULL REFERENCES "User"("id")
);
