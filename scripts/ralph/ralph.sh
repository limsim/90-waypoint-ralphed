#!/bin/bash
# Ralph Wiggum - Long-running AI agent loop
# Loops a SINGLE user story for the specified number of iterations.
# Usage: ./ralph.sh [--tool amp|claude] [--model NAME] [--story US-XXX] [max_iterations]
#   --story  Story ID to loop on. Default: highest-priority story with passes:false.
#   --model  Model to pass to the tool (e.g. opus, sonnet, claude-opus-4-8). Default: tool's own default.
# The loop always runs the full iteration count (no early exit) - once the story
# passes, later iterations act as refinement passes on the same story.

set -e

# Parse arguments
TOOL="amp"  # Default to amp for backwards compatibility
MODEL=""    # Empty = use the tool's own default model
MAX_ITERATIONS=3
STORY_ID=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)
      TOOL="$2"
      shift 2
      ;;
    --tool=*)
      TOOL="${1#*=}"
      shift
      ;;
    --model)
      MODEL="$2"
      shift 2
      ;;
    --model=*)
      MODEL="${1#*=}"
      shift
      ;;
    --story)
      STORY_ID="$2"
      shift 2
      ;;
    --story=*)
      STORY_ID="${1#*=}"
      shift
      ;;
    *)
      # Assume it's max_iterations if it's a number
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="$1"
      fi
      shift
      ;;
  esac
done

# Validate tool choice
if [[ "$TOOL" != "amp" && "$TOOL" != "claude" ]]; then
  echo "Error: Invalid tool '$TOOL'. Must be 'amp' or 'claude'."
  exit 1
fi

# Optional model flag, passed through to the selected tool only when set.
MODEL_ARGS=()
if [[ -n "$MODEL" ]]; then
  MODEL_ARGS=(--model "$MODEL")
fi
SCRIPT_DIR="./scripts/ralph"
echo $SCRIPT_DIR

PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"

# Archive previous run if branch changed
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")
  
  if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
    # Archive the previous run
    DATE=$(date +%Y-%m-%d)
    # Strip "ralph/" prefix from branch name for folder
    FOLDER_NAME=$(echo "$LAST_BRANCH" | sed 's|^ralph/||')
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"
    
    echo "Archiving previous run: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    [ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
    [ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
    echo "   Archived to: $ARCHIVE_FOLDER"
    
    # Reset progress file for new run
    echo "# Ralph Progress Log" > "$PROGRESS_FILE"
    echo "Started: $(date)" >> "$PROGRESS_FILE"
    echo "---" >> "$PROGRESS_FILE"
  fi
fi

# Track current branch
if [ -f "$PRD_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  if [ -n "$CURRENT_BRANCH" ]; then
    echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"
  fi
fi

# Initialize progress file if it doesn't exist
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# Ralph Progress Log" > "$PROGRESS_FILE"
  echo "Started: $(date)" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

# Determine which single story to loop on.
# Default: the highest-priority story still marked passes:false.
if [ -z "$STORY_ID" ]; then
  STORY_ID=$(jq -r '[.userStories[] | select(.passes == false)] | sort_by(.priority) | .[0].id // empty' "$PRD_FILE" 2>/dev/null || echo "")
fi

if [ -z "$STORY_ID" ]; then
  echo "Error: no story to loop on (no --story given and no story has passes:false in $PRD_FILE)."
  exit 1
fi

# Validate the story exists and grab its title for display + the prompt.
STORY_TITLE=$(jq -r --arg id "$STORY_ID" '.userStories[] | select(.id == $id) | .title' "$PRD_FILE" 2>/dev/null || echo "")
if [ -z "$STORY_TITLE" ]; then
  echo "Error: story '$STORY_ID' not found in $PRD_FILE."
  exit 1
fi

# Directive appended to the agent prompt every iteration, pinning it to this one story.
RUN_DIRECTIVE="

## This Run

Work ONLY on story $STORY_ID ($STORY_TITLE). Do NOT pick any other story, even if a
higher-priority story with passes:false exists - ignore the 'pick the highest priority
story' guidance above; the story is fixed for this run.

If $STORY_ID already has passes:true, treat this as a REFINEMENT pass: re-check the
implementation against the story's acceptance criteria, improve quality/robustness/tests,
re-run the quality gate, and commit any changes. Always leave the build green.

Read the PRD from scripts/ralph/prd.json and APPEND your progress to scripts/ralph/progress.txt
(both relative to the repo-root working directory). Do NOT create or write a prd.json or
progress.txt at the repo root - those copies are invisible to this runner."

echo "Starting Ralph - Tool: $TOOL - Model: ${MODEL:-default} - Story: $STORY_ID ($STORY_TITLE) - Iterations: $MAX_ITERATIONS"

for i in $(seq 1 $MAX_ITERATIONS); do
  echo ""
  echo "==============================================================="
  echo "  Ralph Iteration $i of $MAX_ITERATIONS - $STORY_ID ($TOOL)"
  echo "==============================================================="

  # Build the prompt: base agent instructions + this-run directive pinning the story.
  PROMPT="$(cat "$SCRIPT_DIR/CLAUDE.md")$RUN_DIRECTIVE"

  # Run the selected tool. We always continue to the next iteration regardless of
  # the story's pass state - the full iteration count is the only stop condition.
  if [[ "$TOOL" == "amp" ]]; then
    printf '%s' "$PROMPT" | amp --dangerously-allow-all "${MODEL_ARGS[@]}" 2>&1 | tee /dev/stderr || true
  else
    # Claude Code: --dangerously-skip-permissions for autonomous operation, --print for output
    printf '%s' "$PROMPT" | claude --dangerously-skip-permissions --print --output-format stream-json --verbose "${MODEL_ARGS[@]}" 2>&1 | tee /dev/stderr || true
  fi

  # Safety net: capture anything the agent left uncommitted this iteration so each
  # iteration is a discrete commit. No-op when the working tree is already clean.
  if [[ -n "$(git status --porcelain)" ]]; then
    git add -A
    git commit -m "chore: $STORY_ID iteration $i of $MAX_ITERATIONS (ralph auto-commit)" || true
    echo "Auto-committed leftover changes for iteration $i."
  fi

  echo "Iteration $i complete. Continuing..."
  sleep 2
done

echo ""
echo "Ralph finished $MAX_ITERATIONS iteration(s) on $STORY_ID."
echo "Check $PROGRESS_FILE for status."
exit 0
