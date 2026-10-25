// The Import dialog's suggested workspace name, from the file picked — kept
// out of the component so a test can load it.

/** `blog (1).zip` → `blog-1`, `Blog_v2.zip` → `blog-v2`: kebab-case, as a
 *  workspace name must be (assertSafeName). */
export function suggestName(file: string): string {
  return file
    .replace(/\.zip$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
