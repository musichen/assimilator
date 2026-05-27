import fs from "node:fs/promises";
import path from "node:path";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function writeFileIfMissing(filePath: string, content: string): Promise<"created" | "exists"> {
  if (await pathExists(filePath)) {
    return "exists";
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return "created";
}

export async function uniquePath(basePath: string): Promise<string> {
  if (!(await pathExists(basePath))) {
    return basePath;
  }
  const parsed = path.parse(basePath);
  for (let index = 2; index < 10000; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }
  throw new Error(`Unable to find unique path for ${basePath}`);
}

export async function listFiles(root: string, extensions?: Set<string>): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath, extensions));
    } else if (!extensions || extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }
  return files;
}
