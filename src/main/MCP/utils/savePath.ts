/**
 * savePath.ts — guards for get_screenshot's `savePath`.
 *
 * An absolute savePath is a feature (an agent saves straight into its own
 * project), so the destination is not confined to one directory. What is
 * refused is anything that is not a PNG write: a caller — or a prompt-injected
 * agent — must not be able to aim a screenshot at ~/.bashrc,
 * ~/.ssh/authorized_keys or an autostart .desktop file and clobber it.
 */

import fs from "node:fs";
import path from "node:path";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Throws unless `absPath` names a `.png` file that is either absent or already
 * a PNG (re-exporting over a previous screenshot stays possible). Symlinks are
 * refused outright: the check would otherwise be about the link, the write
 * about its target.
 */
export async function assertSafePngTarget(absPath: string): Promise<void> {
  if (path.extname(absPath).toLowerCase() !== ".png") {
    throw new Error("savePath must end in .png");
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(absPath);
  } catch (e: any) {
    if (e?.code === "ENOENT") return;
    throw e;
  }

  if (stat.isSymbolicLink()) throw new Error("refusing to write through a symlink");
  if (!stat.isFile()) throw new Error("savePath exists and is not a regular file");

  const handle = await fs.promises.open(absPath, "r");
  try {
    const head = Buffer.alloc(PNG_MAGIC.length);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    if (bytesRead !== PNG_MAGIC.length || !head.equals(PNG_MAGIC)) {
      throw new Error("refusing to overwrite an existing file that is not a PNG");
    }
  } finally {
    await handle.close();
  }
}
