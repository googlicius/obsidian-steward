import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';

// GitHub repository information
const GITHUB_OWNER = 'googlicius';
const GITHUB_REPO = 'obsidian-steward';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// Cache for the latest release to avoid too many API calls
interface CachedRelease {
  version: string;
  body: string;
  timestamp: number;
}

/**
 * Service for checking plugin versions and release notes from GitHub
 */
export class VersionCheckerService {
  private static instance: VersionCheckerService | null = null;
  private cachedLatestRelease: CachedRelease | null = null;
  private readonly CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour cache

  private constructor(private plugin: StewardPlugin) {}

  /**
   * Get the singleton instance
   */
  public static getInstance(plugin?: StewardPlugin): VersionCheckerService {
    if (plugin) {
      VersionCheckerService.instance = new VersionCheckerService(plugin);
    }

    if (!VersionCheckerService.instance) {
      throw new Error('VersionCheckerService is not initialized');
    }

    return VersionCheckerService.instance;
  }

  /**
   * Compares two semantic version strings
   * @param v1 First version string
   * @param v2 Second version string
   * @returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  private compareVersions(v1: string, v2: string): number {
    // Remove 'v' prefix if present for comparison
    const cleanV1 = v1.replace(/^v/i, '');
    const cleanV2 = v2.replace(/^v/i, '');

    const parts1 = cleanV1.split('.').map(Number);
    const parts2 = cleanV2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }

    return 0;
  }

  /**
   * Fetches the latest release from GitHub Releases API
   * @returns Object with version and body, or null if not found or on error
   */
  private async fetchLatestReleaseFromGitHub(): Promise<{ version: string; body: string } | null> {
    try {
      const response = await fetch(GITHUB_API_URL, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        // Handle rate limiting (403) or not found (404)
        if (response.status === 403) {
          logger.warn('GitHub API rate limit reached, using fallback');
          return null;
        }
        if (response.status === 404) {
          logger.warn('GitHub repository or releases not found');
          return null;
        }
        logger.warn(`GitHub API returned status ${response.status}`);
        return null;
      }

      const data = await response.json();
      const tagName = data.tag_name;
      const body = data.body || '';

      if (!tagName) {
        logger.warn('No tag_name found in GitHub release response');
        return null;
      }

      // Remove 'v' prefix if present
      const version = tagName.replace(/^v/i, '');
      return { version, body };
    } catch (error) {
      logger.error('Error fetching latest release from GitHub:', error);
      return null;
    }
  }

  /**
   * Gets the latest release (version and body), trying GitHub API first
   * Uses caching to avoid too many API calls
   * @returns Object with version and body, or null if not found
   */
  public async getLatestRelease(): Promise<{ version: string; body: string } | null> {
    // Check cache first
    if (this.cachedLatestRelease) {
      const now = Date.now();
      if (now - this.cachedLatestRelease.timestamp < this.CACHE_DURATION_MS) {
        return {
          version: this.cachedLatestRelease.version,
          body: this.cachedLatestRelease.body,
        };
      }
    }

    // Try fetching from GitHub
    const githubRelease = await this.fetchLatestReleaseFromGitHub();
    if (githubRelease) {
      this.cachedLatestRelease = {
        version: githubRelease.version,
        body: githubRelease.body,
        timestamp: Date.now(),
      };
      return githubRelease;
    }

    return null;
  }

  /**
   * Gets the latest version (for backward compatibility)
   * @returns The latest version string or null if not found
   */
  public async getLatestVersion(): Promise<string | null> {
    const release = await this.getLatestRelease();
    return release?.version || null;
  }

  /**
   * Checks if there's a new version available compared to the last seen version
   * @param currentVersion The current plugin version
   * @param lastSeenVersion The last version the user has seen (optional)
   * @returns Object with version and body if newer, null otherwise
   */
  public async checkForNewVersion(
    currentVersion: string,
    lastSeenVersion?: string
  ): Promise<{ version: string; body: string } | null> {
    const latestRelease = await this.getLatestRelease();

    if (!latestRelease) {
      return null;
    }

    // Compare with lastSeenVersion if provided, otherwise compare with currentVersion
    const versionToCompare = lastSeenVersion || currentVersion;

    // If latest version is newer than the version to compare, return it with body
    if (this.compareVersions(latestRelease.version, versionToCompare) > 0) {
      return latestRelease;
    }

    return null;
  }
}
