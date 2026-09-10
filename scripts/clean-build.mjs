import { lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Fixed destinations only: never accept an arbitrary deletion path from a CLI.
const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const destinations = {
  web: ["internal", "web", "dist"],
  desktop: ["desktop", "dist"],
};

export function cleanBuildOutput(target) {
  if (!Object.hasOwn(destinations, target)) throw new Error(`Unknown build target: ${target}`);
  let directory = root;
  for (const segment of destinations[target]) {
    directory = path.join(directory, segment);
    const stat = lstatSync(directory, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
      throw new Error(`Refusing to clean through a non-directory or symlink: ${directory}`);
    }
    if (!stat) mkdirSync(directory);
  }
  for (const name of readdirSync(directory)) {
    const entry = path.join(directory, name);
    if (target === "web" && name === ".gitkeep") {
      if (!lstatSync(entry).isFile() || lstatSync(entry).isSymbolicLink()) {
        throw new Error("Expected .gitkeep to be a regular file");
      }
      continue;
    }
    // rm removes child symlinks themselves; it does not traverse their targets.
    rmSync(entry, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  cleanBuildOutput(process.argv[2]);
}
