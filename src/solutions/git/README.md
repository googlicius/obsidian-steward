# Git-based Change Tracking and Reversion for Obsidian Steward

This solution provides change tracking and reversion capabilities for operations performed by the Obsidian Steward plugin. It uses a local Git repository to track changes and allows users to revert specific operations when needed.

## Components

1. **GitService**: Core service that interacts with isomorphic-git and handles repository operations

   - Initializes and manages Git repository
   - Tracks file operations by committing changes
   - Provides reversion capabilities to specific commits

2. **GitEventHandler**: Listens for events and interacts with GitService

   - Listens for move operations, file changes, and other relevant events
   - Records operations in Git with meaningful commit messages
   - Provides methods to revert to previous states
   - Updates conversation metadata with commit hashes

3. **Integration with ConversationRenderer**:
   - Adds commit hashes to message metadata
   - Allows looking up metadata by message ID for reverts

## Usage

Once the plugin loads, Git tracking is automatically initialized. No explicit user setup is required. All file operations performed by the plugin are automatically tracked.

### Revert Operations

1. **Command Palette**: Use the "Revert Last Operation" command from the command palette
2. **Commit History**: You can view and select specific operations to revert (future enhancement)

## Technical Information

- This uses isomorphic-git, a JavaScript implementation of Git that works in the browser
- No external Git processes are used, all Git operations happen in-memory
- Changes are stored in a local repository in the Obsidian vault
- No remote repository is needed, all operations are local

## Limitations

- Only tracks changes made through the plugin (not manual file edits)
- Reversion might not be 100% accurate for complex operations
- Large changes might temporarily impact performance

## Future Enhancements

- Add a dedicated view to browse operation history
- Allow selective reversion of specific operations
- Enable cherry-picking changes from past operations
