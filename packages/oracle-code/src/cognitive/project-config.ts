/**
 * Per-Project Emotional Configuration
 *
 * Allows projects to override emotional baselines, mode calibration,
 * expression levels, and path-specific emotional triggers.
 *
 * Config file: .context/emotions.json or .context/project-emotions.json
 *
 * Features:
 * - Override mode calibration (anxiety/confidence baselines per mode)
 * - Path-specific emotions (e.g., legacy code → caution, tests → confidence)
 * - Expression level settings (how verbose emotional output is)
 * - Project-specific triggers
 * - Discovery across multiple directories (~/Code, ~/Chris, ~/Journal, etc.)
 */

import path from "path"
import fs from "fs/promises"
import os from "os"
import z from "zod"
import { Log } from "../util/log"
import type { Emotions } from "./emotions"

export namespace ProjectConfig {
  const log = Log.create({ service: "project-config" })

  // =============
  // Configuration Directories
  // =============

  // Directories to search for projects (in addition to current working directory)
  const PROJECT_DISCOVERY_PATHS = [
    "~/Code",
    "~/Chris",
    "~/Journal",
    "~/Projects",
    "~/Developer",
  ]

  // Config file names to look for (in order of priority)
  const CONFIG_FILE_NAMES = [
    "project-emotions.json",
    "emotions-config.json",
  ]

  // =============
  // Zod Schemas
  // =============

  // Expression level determines how verbose emotional output is
  export const ExpressionLevel = z.enum([
    "silent",     // 0: No emotional output
    "subtle",     // 1: Minimal hints in behavior
    "noted",      // 2: Brief notes in output (default for build mode)
    "explained",  // 3: Moderate explanation
    "reflective", // 4: Full emotional reflection (default for chat mode)
  ])
  export type ExpressionLevel = z.infer<typeof ExpressionLevel>

  // Numeric mapping for expression levels
  export const EXPRESSION_LEVEL_VALUES: Record<ExpressionLevel, number> = {
    silent: 0,
    subtle: 1,
    noted: 2,
    explained: 3,
    reflective: 4,
  }

  // Mode calibration override schema
  const ModeCalibrationOverride = z.object({
    anxietyBaseline: z.number().min(0).max(100).optional(),
    confidenceBaseline: z.number().min(0).max(100).optional(),
    anxietySensitivity: z.number().min(0).max(3).optional(),
    confidenceSensitivity: z.number().min(0).max(3).optional(),
    anxietyMax: z.number().min(0).max(100).optional(),
    confidenceMax: z.number().min(0).max(100).optional(),
    anxietyDecayRate: z.number().min(0).max(2).optional(),
    confidenceDecayRate: z.number().min(0).max(2).optional(),
    expressionLevel: ExpressionLevel.optional(),
  })
  type ModeCalibrationOverride = z.infer<typeof ModeCalibrationOverride>

  // Path emotion trigger schema
  const PathEmotionTrigger = z.object({
    pattern: z.string(), // Glob pattern or path substring
    emotion: z.enum([
      "fear", "curiosity", "satisfaction", "frustration",
      "excitement", "determination", "caution", "relief",
    ]),
    intensity: z.number().min(1).max(10),
    description: z.string(),
    // How to apply: 'boost' adds to existing, 'set' replaces
    mode: z.enum(["boost", "set"]).default("boost"),
  })
  export type PathEmotionTrigger = z.infer<typeof PathEmotionTrigger>

  // Project-specific trigger schema
  const ProjectTrigger = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    condition: z.object({
      // File patterns that activate this trigger
      filePatterns: z.array(z.string()).optional(),
      // Content patterns (regex)
      contentPatterns: z.array(z.string()).optional(),
      // Tool names that activate this trigger
      tools: z.array(z.string()).optional(),
      // Cognitive state conditions
      minAnxiety: z.number().optional(),
      maxConfidence: z.number().optional(),
    }),
    effect: z.object({
      emotion: z.enum([
        "fear", "curiosity", "satisfaction", "frustration",
        "excitement", "determination", "caution", "relief",
      ]).optional(),
      anxietyDelta: z.number().optional(),
      confidenceDelta: z.number().optional(),
      suggestion: z.string().optional(),
    }),
  })
  export type ProjectTrigger = z.infer<typeof ProjectTrigger>

  // Full project emotional config schema
  export const ProjectEmotionalConfig = z.object({
    // Project metadata
    projectId: z.string().optional(),
    projectName: z.string().optional(),
    description: z.string().optional(),

    // Global overrides
    defaultMode: z.enum(["build", "plan", "docs", "review", "security", "chat"]).optional(),
    defaultExpressionLevel: ExpressionLevel.optional(),
    defaultAutonomyLevel: z.number().min(0).max(100).optional(),

    // Mode-specific calibration overrides (partial - only override specific modes)
    modeOverrides: z.object({
      build: ModeCalibrationOverride.optional(),
      plan: ModeCalibrationOverride.optional(),
      docs: ModeCalibrationOverride.optional(),
      review: ModeCalibrationOverride.optional(),
      security: ModeCalibrationOverride.optional(),
      chat: ModeCalibrationOverride.optional(),
    }).optional(),

    // Path-specific emotion triggers
    pathEmotions: z.array(PathEmotionTrigger).optional(),

    // Project-specific analysis triggers
    triggers: z.array(ProjectTrigger).optional(),

    // Decay rate multipliers (1.0 = default, 0.5 = half speed, 2.0 = double speed)
    decayMultipliers: z.object({
      fear: z.number().min(0).max(5).optional(),
      curiosity: z.number().min(0).max(5).optional(),
      satisfaction: z.number().min(0).max(5).optional(),
      frustration: z.number().min(0).max(5).optional(),
      excitement: z.number().min(0).max(5).optional(),
      determination: z.number().min(0).max(5).optional(),
      caution: z.number().min(0).max(5).optional(),
      relief: z.number().min(0).max(5).optional(),
    }).optional(),

    // Emotion ceiling overrides (max intensity per category)
    emotionCeilings: z.object({
      fear: z.number().min(1).max(10).optional(),
      curiosity: z.number().min(1).max(10).optional(),
      satisfaction: z.number().min(1).max(10).optional(),
      frustration: z.number().min(1).max(10).optional(),
      excitement: z.number().min(1).max(10).optional(),
      determination: z.number().min(1).max(10).optional(),
      caution: z.number().min(1).max(10).optional(),
      relief: z.number().min(1).max(10).optional(),
    }).optional(),

    // Initial emotions to seed when starting a session in this project
    initialEmotions: z.array(z.object({
      category: z.enum([
        "fear", "curiosity", "satisfaction", "frustration",
        "excitement", "determination", "caution", "relief",
      ]),
      trigger: z.string(),
      context: z.string(),
      intensity: z.number().min(1).max(10),
    })).optional(),

    // Tags for this project (used for historical memory matching)
    tags: z.array(z.string()).optional(),
  })
  export type ProjectEmotionalConfig = z.infer<typeof ProjectEmotionalConfig>

  // =============
  // Project Discovery
  // =============

  export interface DiscoveredProject {
    path: string
    name: string
    hasConfig: boolean
    configPath?: string
    config?: ProjectEmotionalConfig
  }

  /**
   * Expand ~ to home directory
   */
  function expandHome(filepath: string): string {
    if (filepath.startsWith("~/")) {
      return path.join(os.homedir(), filepath.slice(2))
    }
    return filepath
  }

  /**
   * Check if a directory has a .context folder
   */
  async function hasContextDir(dirPath: string): Promise<boolean> {
    try {
      const contextPath = path.join(dirPath, ".context")
      const stats = await fs.stat(contextPath)
      return stats.isDirectory()
    } catch {
      return false
    }
  }

  /**
   * Find project config file in a directory
   */
  async function findConfigFile(contextPath: string): Promise<string | null> {
    for (const filename of CONFIG_FILE_NAMES) {
      const configPath = path.join(contextPath, filename)
      try {
        await fs.access(configPath)
        return configPath
      } catch {
        continue
      }
    }
    return null
  }

  /**
   * Load project config from a file
   */
  async function loadConfigFile(configPath: string): Promise<ProjectEmotionalConfig | null> {
    try {
      const content = await fs.readFile(configPath, "utf-8")
      const data = JSON.parse(content)
      return ProjectEmotionalConfig.parse(data)
    } catch (e) {
      log.error("failed to load project config", { configPath, error: e })
      return null
    }
  }

  /**
   * Discover projects in a given directory
   */
  async function discoverProjectsInDir(baseDir: string): Promise<DiscoveredProject[]> {
    const projects: DiscoveredProject[] = []
    const expandedPath = expandHome(baseDir)

    try {
      const entries = await fs.readdir(expandedPath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith(".")) continue // Skip hidden directories

        const projectPath = path.join(expandedPath, entry.name)
        const hasContext = await hasContextDir(projectPath)

        if (hasContext) {
          const contextPath = path.join(projectPath, ".context")
          const configPath = await findConfigFile(contextPath)
          const config = configPath ? await loadConfigFile(configPath) : null

          projects.push({
            path: projectPath,
            name: entry.name,
            hasConfig: config !== null,
            configPath: configPath || undefined,
            config: config || undefined,
          })
        }
      }
    } catch (e) {
      // Directory may not exist
      log.info("directory not accessible for project discovery", { baseDir, error: e })
    }

    return projects
  }

  /**
   * Discover all projects across configured directories
   */
  export async function discoverAllProjects(): Promise<DiscoveredProject[]> {
    const allProjects: DiscoveredProject[] = []

    for (const basePath of PROJECT_DISCOVERY_PATHS) {
      const projects = await discoverProjectsInDir(basePath)
      allProjects.push(...projects)
    }

    // Dedupe by path
    const seen = new Set<string>()
    return allProjects.filter((p) => {
      if (seen.has(p.path)) return false
      seen.add(p.path)
      return true
    })
  }

  /**
   * Get project config for current working directory
   */
  export async function getConfigForCwd(): Promise<ProjectEmotionalConfig | null> {
    const cwd = process.cwd()
    const contextPath = path.join(cwd, ".context")
    const configPath = await findConfigFile(contextPath)
    return configPath ? await loadConfigFile(configPath) : null
  }

  /**
   * Get project config for a specific AFS root
   */
  export async function getConfigForRoot(root: string): Promise<ProjectEmotionalConfig | null> {
    const configPath = await findConfigFile(root)
    return configPath ? await loadConfigFile(configPath) : null
  }

  // =============
  // Config Merging
  // =============

  /**
   * Merge project config with default mode calibration
   */
  export function getMergedModeCalibration(
    mode: Emotions.AgentMode,
    projectConfig: ProjectEmotionalConfig | null,
    defaultCalibration: {
      anxietyBaseline: number
      confidenceBaseline: number
      anxietySensitivity: number
      confidenceSensitivity: number
      anxietyMax: number
      confidenceMax: number
      anxietyDecayRate: number
      confidenceDecayRate: number
    }
  ): typeof defaultCalibration & { expressionLevel?: ExpressionLevel } {
    if (!projectConfig?.modeOverrides?.[mode]) {
      return { ...defaultCalibration }
    }

    const override = projectConfig.modeOverrides[mode]

    return {
      anxietyBaseline: override.anxietyBaseline ?? defaultCalibration.anxietyBaseline,
      confidenceBaseline: override.confidenceBaseline ?? defaultCalibration.confidenceBaseline,
      anxietySensitivity: override.anxietySensitivity ?? defaultCalibration.anxietySensitivity,
      confidenceSensitivity: override.confidenceSensitivity ?? defaultCalibration.confidenceSensitivity,
      anxietyMax: override.anxietyMax ?? defaultCalibration.anxietyMax,
      confidenceMax: override.confidenceMax ?? defaultCalibration.confidenceMax,
      anxietyDecayRate: override.anxietyDecayRate ?? defaultCalibration.anxietyDecayRate,
      confidenceDecayRate: override.confidenceDecayRate ?? defaultCalibration.confidenceDecayRate,
      expressionLevel: override.expressionLevel,
    }
  }

  /**
   * Get path-specific emotions for a file
   */
  export function getPathEmotions(
    filePath: string,
    projectConfig: ProjectEmotionalConfig | null
  ): PathEmotionTrigger[] {
    if (!projectConfig?.pathEmotions) return []

    return projectConfig.pathEmotions.filter((trigger) => {
      // Simple substring match or glob-like pattern
      if (trigger.pattern.includes("*")) {
        // Convert glob to regex
        const regex = new RegExp(
          "^" + trigger.pattern
            .replace(/\./g, "\\.")
            .replace(/\*\*/g, ".*")
            .replace(/\*/g, "[^/]*")
            + "$"
        )
        return regex.test(filePath)
      }
      return filePath.includes(trigger.pattern)
    })
  }

  /**
   * Get current expression level based on mode and project config
   */
  export function getExpressionLevel(
    mode: Emotions.AgentMode,
    projectConfig: ProjectEmotionalConfig | null
  ): ExpressionLevel {
    // Check mode-specific override first
    if (projectConfig?.modeOverrides?.[mode]?.expressionLevel) {
      return projectConfig.modeOverrides[mode]!.expressionLevel!
    }

    // Check project default
    if (projectConfig?.defaultExpressionLevel) {
      return projectConfig.defaultExpressionLevel
    }

    // Mode defaults
    const modeDefaults: Record<Emotions.AgentMode, ExpressionLevel> = {
      build: "noted",
      plan: "explained",
      docs: "subtle",
      review: "explained",
      security: "explained",
      chat: "reflective",
    }

    return modeDefaults[mode]
  }

  /**
   * Get decay rate multiplier for an emotion category
   */
  export function getDecayMultiplier(
    category: Emotions.EmotionCategory,
    projectConfig: ProjectEmotionalConfig | null
  ): number {
    if (!projectConfig?.decayMultipliers) return 1.0
    return projectConfig.decayMultipliers[category] ?? 1.0
  }

  /**
   * Get emotion ceiling for a category
   */
  export function getEmotionCeiling(
    category: Emotions.EmotionCategory,
    projectConfig: ProjectEmotionalConfig | null
  ): number {
    if (!projectConfig?.emotionCeilings) return 10
    return projectConfig.emotionCeilings[category] ?? 10
  }

  // =============
  // Config Management
  // =============

  /**
   * Save project config to file
   */
  export async function saveConfig(
    root: string,
    config: ProjectEmotionalConfig
  ): Promise<void> {
    const configPath = path.join(root, "project-emotions.json")
    await fs.writeFile(configPath, JSON.stringify(config, null, 2))
    log.info("saved project emotional config", { configPath })
  }

  /**
   * Create a default config for a project
   */
  export function createDefaultConfig(projectName: string): ProjectEmotionalConfig {
    return {
      projectId: projectName.toLowerCase().replace(/\s+/g, "-"),
      projectName,
      description: `Emotional configuration for ${projectName}`,
      defaultMode: "build",
      defaultExpressionLevel: "noted",
      defaultAutonomyLevel: 70,
      modeOverrides: {},
      pathEmotions: [],
      triggers: [],
      tags: [],
    }
  }

  /**
   * Initialize project config if it doesn't exist
   */
  export async function initializeIfNeeded(root: string, projectName?: string): Promise<boolean> {
    const existing = await getConfigForRoot(root)
    if (existing) return false

    const name = projectName || path.basename(path.dirname(root))
    const config = createDefaultConfig(name)
    await saveConfig(root, config)
    return true
  }

  // =============
  // Example Configs
  // =============

  /**
   * Example config for a C++ project like YAZE
   */
  export const EXAMPLE_CPP_PROJECT: ProjectEmotionalConfig = {
    projectId: "yaze",
    projectName: "YAZE",
    description: "Yet Another Zelda3 Editor - C++17 ROM editor",
    defaultMode: "build",
    defaultExpressionLevel: "noted",
    defaultAutonomyLevel: 75,
    modeOverrides: {
      build: {
        anxietyBaseline: 40, // C++ builds can be scary
        confidenceBaseline: 50,
        expressionLevel: "subtle", // Focus on code, not feelings
      },
      review: {
        anxietyBaseline: 50,
        confidenceBaseline: 45,
        expressionLevel: "explained",
      },
    },
    pathEmotions: [
      {
        pattern: "src/lib/**",
        emotion: "caution",
        intensity: 5,
        description: "Core library code - changes affect everything",
        mode: "boost",
      },
      {
        pattern: "**/*.s",
        emotion: "caution",
        intensity: 6,
        description: "Assembly code - requires extra care",
        mode: "boost",
      },
      {
        pattern: "**/test/**",
        emotion: "satisfaction",
        intensity: 3,
        description: "Test code - good for confidence",
        mode: "boost",
      },
      {
        pattern: "**/imgui/**",
        emotion: "curiosity",
        intensity: 4,
        description: "UI code - interesting to explore",
        mode: "boost",
      },
    ],
    triggers: [
      {
        id: "cmake_failure",
        name: "CMake Build Failure",
        description: "CMake configuration or build failed",
        condition: {
          tools: ["bash"],
          contentPatterns: ["CMake Error", "cmake.*failed"],
        },
        effect: {
          emotion: "frustration",
          anxietyDelta: 10,
          suggestion: "Check CMakeLists.txt and preset configuration",
        },
      },
    ],
    decayMultipliers: {
      fear: 0.7, // Fears persist longer in C++ projects
      frustration: 1.2, // Frustration clears faster
    },
    tags: ["cpp", "c++", "cmake", "imgui", "sdl2", "rom-editing"],
  }

  /**
   * Example config for a personal journal/notes project
   */
  export const EXAMPLE_JOURNAL_PROJECT: ProjectEmotionalConfig = {
    projectId: "journal",
    projectName: "Journal",
    description: "Personal org-mode journal system",
    defaultMode: "chat",
    defaultExpressionLevel: "reflective",
    defaultAutonomyLevel: 85,
    modeOverrides: {
      chat: {
        anxietyBaseline: 10,
        confidenceBaseline: 80,
        anxietySensitivity: 0.3, // Very calm mode
        expressionLevel: "reflective",
      },
      docs: {
        anxietyBaseline: 15,
        confidenceBaseline: 75,
        expressionLevel: "explained",
      },
    },
    pathEmotions: [
      {
        pattern: "**/personal/**",
        emotion: "caution",
        intensity: 3,
        description: "Personal content - be respectful",
        mode: "boost",
      },
      {
        pattern: "**/ideas/**",
        emotion: "excitement",
        intensity: 5,
        description: "Ideas section - creative exploration",
        mode: "boost",
      },
    ],
    initialEmotions: [
      {
        category: "satisfaction",
        trigger: "Helping with personal organization",
        context: "Journal work is meaningful",
        intensity: 4,
      },
    ],
    tags: ["org-mode", "emacs", "personal", "notes", "journal"],
  }

  /**
   * Example config for an assembly/ROM hack project
   */
  export const EXAMPLE_ASM_PROJECT: ProjectEmotionalConfig = {
    projectId: "oracle-of-secrets",
    projectName: "Oracle of Secrets",
    description: "65816 assembly ROM hack for Zelda 3",
    defaultMode: "build",
    defaultExpressionLevel: "noted",
    defaultAutonomyLevel: 65,
    modeOverrides: {
      build: {
        anxietyBaseline: 55, // Assembly is delicate
        confidenceBaseline: 40,
        anxietySensitivity: 1.3,
        expressionLevel: "explained",
      },
      security: {
        anxietyBaseline: 60,
        confidenceBaseline: 35,
        expressionLevel: "explained",
      },
    },
    pathEmotions: [
      {
        pattern: "**/*.asm",
        emotion: "caution",
        intensity: 5,
        description: "Assembly source - one wrong byte breaks everything",
        mode: "boost",
      },
      {
        pattern: "**/bank*.asm",
        emotion: "fear",
        intensity: 4,
        description: "Bank code - memory layout critical",
        mode: "boost",
      },
      {
        pattern: "**/dungeon*.asm",
        emotion: "curiosity",
        intensity: 5,
        description: "Dungeon code - complex and interesting",
        mode: "boost",
      },
    ],
    triggers: [
      {
        id: "asar_error",
        name: "Asar Assembly Error",
        description: "Asar assembler reported an error",
        condition: {
          tools: ["bash"],
          contentPatterns: ["error:", "Error:"],
        },
        effect: {
          emotion: "frustration",
          anxietyDelta: 15,
          suggestion: "Check line numbers in error output, verify label names",
        },
      },
    ],
    decayMultipliers: {
      fear: 0.5, // Assembly fears persist much longer
      caution: 0.6, // Caution also persists
      determination: 0.7, // Need sustained determination
    },
    emotionCeilings: {
      fear: 9, // High fear ceiling for dangerous work
      caution: 10,
    },
    initialEmotions: [
      {
        category: "caution",
        trigger: "Working with assembly code",
        context: "65816 assembly requires careful attention",
        intensity: 5,
      },
      {
        category: "determination",
        trigger: "ROM hacking project",
        context: "Complex project requiring persistence",
        intensity: 4,
      },
    ],
    tags: ["asm", "65816", "snes", "rom-hack", "zelda"],
  }
}
