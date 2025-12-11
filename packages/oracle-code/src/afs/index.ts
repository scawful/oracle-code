import path from "path"
import fs from "fs/promises"
import { Instance } from "../project/instance"

export namespace AFS {
  export type Policy = "read_only" | "writable" | "executable"

  export interface DirectoryInfo {
    policy: Policy
    desc: string
  }

  export const DIRECTORIES: Record<string, DirectoryInfo> = {
    memory: { policy: "read_only", desc: "Long-term specs and architectural decisions" },
    knowledge: { policy: "read_only", desc: "Immutable reference materials" },
    tools: { policy: "executable", desc: "Scripts and automation tools" },
    scratchpad: { policy: "writable", desc: "Transient working memory and plans" },
    history: { policy: "read_only", desc: "Archived sessions" },
  }

  export type DirectoryName = keyof typeof DIRECTORIES

  export interface FileInfo {
    name: string
    path: string
    relativePath: string
    isDirectory: boolean
    size: number
    modifiedAt: Date
  }

  export interface DirectoryStatus {
    name: string
    policy: Policy
    desc: string
    path: string
    exists: boolean
    files: FileInfo[]
    fileCount: number
  }

  export interface AFSStatus {
    root: string
    exists: boolean
    directories: DirectoryStatus[]
  }

  /**
   * Find the .context root by walking up from the given directory
   */
  export async function findRoot(startDir?: string): Promise<string | null> {
    let current = startDir ?? Instance.worktree
    const root = path.parse(current).root

    while (current !== root) {
      const contextPath = path.join(current, ".context")
      try {
        const stat = await fs.stat(contextPath)
        if (stat.isDirectory()) {
          return contextPath
        }
      } catch {
        // Directory doesn't exist, continue walking up
      }
      current = path.dirname(current)
    }

    return null
  }

  /**
   * Get the AFS root, throwing an error if not found
   */
  export async function getRoot(): Promise<string> {
    const root = await findRoot()
    if (!root) {
      throw new Error(
        `AFS not initialized. No .context directory found.\nRun 'codewizard afs init' to initialize the Agentic File System.`,
      )
    }
    return root
  }

  /**
   * Get the directory name from a path within AFS
   */
  export function getDirectoryName(contextRoot: string, filePath: string): DirectoryName | null {
    const relativePath = path.relative(contextRoot, filePath)
    const parts = relativePath.split(path.sep)
    const dirName = parts[0]

    if (dirName && dirName in DIRECTORIES) {
      return dirName as DirectoryName
    }
    return null
  }

  /**
   * Get the policy for a given file path
   */
  export function getPolicy(contextRoot: string, filePath: string): Policy | null {
    const dirName = getDirectoryName(contextRoot, filePath)
    if (!dirName) return null
    return DIRECTORIES[dirName].policy
  }

  /**
   * Check if a path is within the AFS
   */
  export function isAfsPath(contextRoot: string, filePath: string): boolean {
    const resolved = path.resolve(filePath)
    return resolved.startsWith(contextRoot)
  }

  /**
   * Check if writing to a path is allowed
   */
  export function canWrite(contextRoot: string, filePath: string): boolean {
    const policy = getPolicy(contextRoot, filePath)
    return policy === "writable"
  }

  /**
   * Resolve a path that may be relative to .context or absolute
   */
  export function resolvePath(contextRoot: string, inputPath: string): string {
    if (path.isAbsolute(inputPath)) {
      return inputPath
    }
    // Handle paths like "scratchpad/plan.md" or "memory/AFS_SPEC.md"
    return path.join(contextRoot, inputPath)
  }

  /**
   * Get files in a specific AFS directory
   */
  export async function listDirectory(
    contextRoot: string,
    dirName: DirectoryName,
    recursive: boolean = false,
  ): Promise<FileInfo[]> {
    const dirPath = path.join(contextRoot, dirName)
    const files: FileInfo[] = []

    async function scan(currentPath: string): Promise<void> {
      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name)
          const stat = await fs.stat(fullPath).catch(() => null)

          if (stat) {
            files.push({
              name: entry.name,
              path: fullPath,
              relativePath: path.relative(contextRoot, fullPath),
              isDirectory: entry.isDirectory(),
              size: stat.size,
              modifiedAt: stat.mtime,
            })

            if (recursive && entry.isDirectory()) {
              await scan(fullPath)
            }
          }
        }
      } catch {
        // Directory doesn't exist or not readable
      }
    }

    await scan(dirPath)
    return files
  }

  /**
   * Get full AFS status including all directories
   */
  export async function getStatus(contextRoot?: string): Promise<AFSStatus> {
    const root = contextRoot ?? (await findRoot())

    if (!root) {
      return {
        root: path.join(Instance.worktree, ".context"),
        exists: false,
        directories: Object.entries(DIRECTORIES).map(([name, info]) => ({
          name,
          policy: info.policy,
          desc: info.desc,
          path: "",
          exists: false,
          files: [],
          fileCount: 0,
        })),
      }
    }

    const directories: DirectoryStatus[] = []

    for (const [name, info] of Object.entries(DIRECTORIES)) {
      const dirPath = path.join(root, name)
      const exists = await fs
        .stat(dirPath)
        .then((s) => s.isDirectory())
        .catch(() => false)

      const files = exists ? await listDirectory(root, name as DirectoryName, false) : []

      directories.push({
        name,
        policy: info.policy,
        desc: info.desc,
        path: dirPath,
        exists,
        files,
        fileCount: files.filter((f) => !f.isDirectory).length,
      })
    }

    return {
      root,
      exists: true,
      directories,
    }
  }

  /**
   * Get the plan file path
   */
  export function getPlanPath(contextRoot: string): string {
    return path.join(contextRoot, "scratchpad", "plan.md")
  }

  /**
   * Read the current plan content
   */
  export async function readPlan(contextRoot?: string): Promise<string | null> {
    const root = contextRoot ?? (await findRoot())
    if (!root) return null

    const planPath = getPlanPath(root)
    try {
      return await Bun.file(planPath).text()
    } catch {
      return null
    }
  }
}
