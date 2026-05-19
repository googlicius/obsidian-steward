/* eslint-disable */
/* auto-generated — do not edit */

export interface CommunityUdcEntry {
  commandName: string;
  displayName: string;
  description: string;
  version: number;
  files: string[];
  destinationFolder?: string;
  sourceFile: string;
  mainVAULT_FILENAME: string;
  updateInstruction?: string;
}

export const COMMUNITY_UDC_MANIFEST: CommunityUdcEntry[] = [
  {
    "commandName": "bash",
    "displayName": "Shells",
    "description": "Bash shell (e.g. Git Bash).",
    "version": 1,
    "files": [
      "community-UDCs/Shells.md"
    ],
    "sourceFile": "community-UDCs/Shells.md",
    "mainVAULT_FILENAME": "Shells.md"
  },
  {
    "commandName": "claude",
    "displayName": "Agents",
    "description": "Claude Code CLI (Anthropic).",
    "version": 1,
    "files": [
      "community-UDCs/Agents.md"
    ],
    "sourceFile": "community-UDCs/Agents.md",
    "mainVAULT_FILENAME": "Agents.md"
  },
  {
    "commandName": "cmd",
    "displayName": "Shells",
    "description": "Windows Command Prompt (cmd.exe).",
    "version": 1,
    "files": [
      "community-UDCs/Shells.md"
    ],
    "sourceFile": "community-UDCs/Shells.md",
    "mainVAULT_FILENAME": "Shells.md"
  },
  {
    "commandName": "explain-video",
    "displayName": "Explain video",
    "description": "Explain a Youtube video by the given URL",
    "version": 2,
    "files": [
      "community-UDCs/Video/Explain video.md",
      "community-UDCs/Video/Install yt-dlp.md"
    ],
    "destinationFolder": "Video",
    "sourceFile": "community-UDCs/Video/Explain video.md",
    "mainVAULT_FILENAME": "Explain video.md"
  },
  {
    "commandName": "flashcard-ask",
    "displayName": "Flashcard ask",
    "description": "Quiz help from the flashcard above the cursor.",
    "version": 1,
    "files": [
      "community-UDCs/Flashcard ask.md"
    ],
    "sourceFile": "community-UDCs/Flashcard ask.md",
    "mainVAULT_FILENAME": "Flashcard ask.md"
  },
  {
    "commandName": "gemini",
    "displayName": "Agents",
    "description": "Gemini CLI (Google).",
    "version": 1,
    "files": [
      "community-UDCs/Agents.md"
    ],
    "sourceFile": "community-UDCs/Agents.md",
    "mainVAULT_FILENAME": "Agents.md"
  },
  {
    "commandName": "git-commit-and-push",
    "displayName": "Git sync commands",
    "description": "Commit all and push to main.",
    "version": 1,
    "files": [
      "community-UDCs/Git sync commands.md"
    ],
    "sourceFile": "community-UDCs/Git sync commands.md",
    "mainVAULT_FILENAME": "Git sync commands.md"
  },
  {
    "commandName": "git-commit-changes",
    "displayName": "Git sync commands",
    "description": "Stage all changes and commit with your message.",
    "version": 1,
    "files": [
      "community-UDCs/Git sync commands.md"
    ],
    "sourceFile": "community-UDCs/Git sync commands.md",
    "mainVAULT_FILENAME": "Git sync commands.md"
  },
  {
    "commandName": "git-status",
    "displayName": "Git sync commands",
    "description": "Show git status in the repo.",
    "version": 1,
    "files": [
      "community-UDCs/Git sync commands.md"
    ],
    "sourceFile": "community-UDCs/Git sync commands.md",
    "mainVAULT_FILENAME": "Git sync commands.md"
  },
  {
    "commandName": "git-sync-setup",
    "displayName": "Git sync setup",
    "description": "Guided Git + SOPS encrypted sync setup.",
    "version": 1,
    "files": [
      "community-UDCs/Git sync setup.md"
    ],
    "sourceFile": "community-UDCs/Git sync setup.md",
    "mainVAULT_FILENAME": "Git sync setup.md"
  },
  {
    "commandName": "hermes",
    "displayName": "Agents",
    "description": "Hermes Agent CLI (Nous Research).",
    "version": 1,
    "files": [
      "community-UDCs/Agents.md"
    ],
    "sourceFile": "community-UDCs/Agents.md",
    "mainVAULT_FILENAME": "Agents.md"
  },
  {
    "commandName": "install-yt-dlp",
    "displayName": "Install yt-dlp",
    "description": "Install or upgrade yt-dlp using linked steps.",
    "version": 3,
    "files": [
      "community-UDCs/Video/Explain video.md",
      "community-UDCs/Video/Install yt-dlp.md"
    ],
    "destinationFolder": "Video",
    "sourceFile": "community-UDCs/Video/Install yt-dlp.md",
    "mainVAULT_FILENAME": "Install yt-dlp.md",
    "updateInstruction": "Delete old files if they exist: 'yt-dlp.md', 'Installation instruction.md'."
  },
  {
    "commandName": "plan",
    "displayName": "Plan",
    "description": "Build a plan with todos, then confirm before running.",
    "version": 1,
    "files": [
      "community-UDCs/Plan.md"
    ],
    "sourceFile": "community-UDCs/Plan.md",
    "mainVAULT_FILENAME": "Plan.md"
  },
  {
    "commandName": "powershell",
    "displayName": "Shells",
    "description": "Windows PowerShell.",
    "version": 1,
    "files": [
      "community-UDCs/Shells.md"
    ],
    "sourceFile": "community-UDCs/Shells.md",
    "mainVAULT_FILENAME": "Shells.md"
  },
  {
    "commandName": "word-processor",
    "displayName": "Word processor",
    "description": "Auto-structure English vocabulary notes when tagged.",
    "version": 1,
    "files": [
      "community-UDCs/Word processor.md"
    ],
    "sourceFile": "community-UDCs/Word processor.md",
    "mainVAULT_FILENAME": "Word processor.md"
  }
];
