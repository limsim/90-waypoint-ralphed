#!/bin/bash
# Ralph Wiggum - Long-running AI agent loop
# Loops a SINGLE user story (or an ad-hoc --prompt task) for the specified number of iterations.
# Runs the Claude Code CLI each iteration.
# Usage: ./ralph.sh [--model NAME] [--story US-XXX]
#                   [--prompt "TEXT" | --prompt-file PATH] [max_iterations]
#   --story        Story ID to loop on. Default: highest-priority story with passes:false.
#   --model        Model to pass to Claude (e.g. opus, sonnet, claude-opus-4-8). Default: Claude's own default.
#   --prompt       Free-text task to loop on INSTEAD of a PRD story. Makes --story optional; when set,
#                  Ralph runs this ad-hoc task and skips story selection (see "prompt mode" below).
#   --prompt-file  Read the --prompt text from a file instead of the command line (mutually exclusive
#                  with --prompt).
# The loop always runs the full iteration count (no early exit) - once the story
# passes, later iterations act as refinement passes on the same story.

set -e

# Parse arguments
MODEL=""    # Empty = use Claude's own default model
MAX_ITERATIONS=3
STORY_ID=""
PROMPT_TEXT=""  # Inline ad-hoc task (--prompt); empty = story mode
PROMPT_FILE=""  # File to read the ad-hoc task from (--prompt-file)

while [[ $# -gt 0 ]]; do
  case $1 in
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
    --prompt)
      PROMPT_TEXT="$2"
      shift 2
      ;;
    --prompt=*)
      PROMPT_TEXT="${1#*=}"
      shift
      ;;
    --prompt-file)
      PROMPT_FILE="$2"
      shift 2
      ;;
    --prompt-file=*)
      PROMPT_FILE="${1#*=}"
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

# Optional model flag, passed through to Claude only when set.
MODEL_ARGS=()
if [[ -n "$MODEL" ]]; then
  MODEL_ARGS=(--model "$MODEL")
fi

# Resolve the optional ad-hoc task. --prompt-file reads it from a file, --prompt takes it inline;
# they are mutually exclusive. When RUN_PROMPT is non-empty the loop runs in "prompt mode" (below),
# looping that task instead of a PRD story.
RUN_PROMPT=""
if [[ -n "$PROMPT_TEXT" && -n "$PROMPT_FILE" ]]; then
  echo "Error: use only one of --prompt and --prompt-file."
  exit 1
fi
if [[ -n "$PROMPT_FILE" ]]; then
  if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "Error: --prompt-file '$PROMPT_FILE' not found."
    exit 1
  fi
  RUN_PROMPT="$(cat "$PROMPT_FILE")"
elif [[ -n "$PROMPT_TEXT" ]]; then
  RUN_PROMPT="$PROMPT_TEXT"
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

# Decide the run mode and build the directive appended to the agent prompt every iteration:
#   * PROMPT MODE - a free-text task was given via --prompt/--prompt-file. Ralph loops that task;
#                   no PRD story is selected (--story, if also given, is ignored with a note).
#   * STORY MODE  - the default. Pin to one PRD story (--story, else highest-priority passes:false).
if [ -n "$RUN_PROMPT" ]; then
  if [ -n "$STORY_ID" ]; then
    echo "Note: --prompt given; ignoring --story '$STORY_ID' (prompt mode runs an ad-hoc task, not a PRD story)."
  fi
  # Labels are used only for console output and the per-iteration auto-commit message.
  STORY_ID="custom-prompt"
  STORY_TITLE="$(printf '%s' "$RUN_PROMPT" | head -1 | cut -c1-60)"

  RUN_DIRECTIVE="

## This Run

Work ONLY on the following ad-hoc task this run. There is NO PRD story for this run: ignore the
'read the PRD / pick the highest priority story / set passes:true' guidance in the instructions
above. Do NOT select a story and do NOT edit scripts/ralph/prd.json story flags.

TASK:
$RUN_PROMPT

Run the project's quality gate (typecheck, lint, test) before committing, keep the build green,
and commit your changes. APPEND a short progress note to scripts/ralph/progress.txt (relative to
the repo-root working directory). Do NOT create or write a progress.txt at the repo root - that
copy is invisible to this runner."
else
  # Determine which single story to loop on.
  # Default: the highest-priority story still marked passes:false.
  if [ -z "$STORY_ID" ]; then
    STORY_ID=$(jq -r '[.userStories[] | select(.passes == false)] | sort_by(.priority) | .[0].id // empty' "$PRD_FILE" 2>/dev/null || echo "")
  fi

  if [ -z "$STORY_ID" ]; then
    echo "Error: no story to loop on (give --prompt for an ad-hoc task, pass --story, or mark a story passes:false in $PRD_FILE)."
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
fi

echo "Starting Ralph - Tool: claude - Model: ${MODEL:-default} - Story: $STORY_ID ($STORY_TITLE) - Iterations: $MAX_ITERATIONS"

for i in $(seq 1 $MAX_ITERATIONS); do
  echo ""
  echo "==============================================================="
  echo "  Ralph Iteration $i of $MAX_ITERATIONS - $STORY_ID (claude)"
  echo "==============================================================="

  # Build the prompt: base agent instructions + this-run directive pinning the story.
  PROMPT="$(cat "$SCRIPT_DIR/CLAUDE.md")$RUN_DIRECTIVE"

  # Run Claude Code. We always continue to the next iteration regardless of
  # the story's pass state - the full iteration count is the only stop condition.
  # --dangerously-skip-permissions for autonomous operation, --print for output
  printf '%s' "$PROMPT" | claude --dangerously-skip-permissions --print --output-format stream-json --verbose "${MODEL_ARGS[@]}" 2>&1 | tee /dev/stderr || true

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
