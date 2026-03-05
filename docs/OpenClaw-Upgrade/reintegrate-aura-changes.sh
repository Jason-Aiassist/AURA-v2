#!/bin/bash
#
# AURA Changes Re-Integration Script
# 
# Automatically checks and re-applies AURA-specific changes to OpenClaw core files
# after an upgrade. Run this after merging upstream OpenClaw changes.
#
# Usage: ./reintegrate-aura-changes.sh [--check-only|--apply]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MODE="${1:---check-only}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_header() {
    echo ""
    echo "========================================"
    echo "$1"
    echo "========================================"
    echo ""
}

# Track issues
ISSUES_FOUND=0
ISSUES_FIXED=0

cd "$REPO_ROOT"

print_header "AURA Changes Re-Integration"
log_info "Mode: $MODE"
log_info "Repository: $REPO_ROOT"

# ============================================
# CHECK 1: src/plugins/loader.ts
# ============================================
print_header "Checking src/plugins/loader.ts"

LOADER_FILE="src/plugins/loader.ts"

# Check for type imports
if grep -q "PluginHookBeforePromptBuildEvent" "$LOADER_FILE"; then
    log_success "PluginHookBeforePromptBuildEvent import present"
else
    log_warn "Missing PluginHookBeforePromptBuildEvent import"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
    
    if [ "$MODE" = "--apply" ]; then
        log_info "Attempting to fix..."
        
        # Add type imports after PluginLogger
        if sed -i '/PluginLogger,/a\  PluginHookBeforePromptBuildEvent,\n  PluginHookAgentContext,' "$LOADER_FILE"; then
            log_success "Added type imports"
            ISSUES_FIXED=$((ISSUES_FIXED + 1))
        else
            log_error "Failed to add type imports - manual fix required"
        fi
    fi
fi

# Check for typed handler
if grep -q "handler: async (_event: PluginHookBeforePromptBuildEvent" "$LOADER_FILE"; then
    log_success "Typed hook handler present"
else
    log_warn "Missing typed hook handler"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
    
    if [ "$MODE" = "--apply" ]; then
        log_info "Attempting to fix..."
        
        # This is more complex - may need manual intervention
        log_warn "Handler fix requires manual editing - see REINTEGRATION.md section 1"
    fi
fi

# Check for defensive logger
if grep -q "logger?\.debug?" "$LOADER_FILE"; then
    log_success "Defensive logger access present"
else
    log_warn "Missing defensive logger access"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi

# ============================================
# CHECK 2: package.json
# ============================================
print_header "Checking package.json"

PKG_FILE="package.json"

# Check better-sqlite3
if grep -q '"better-sqlite3"' "$PKG_FILE"; then
    log_success "better-sqlite3 dependency present"
else
    log_warn "Missing better-sqlite3 dependency"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
    
    if [ "$MODE" = "--apply" ]; then
        log_info "Attempting to fix..."
        
        # Add before the closing brace of dependencies
        if sed -i '/"ajv": "\^8.18.0",/a\    "better-sqlite3": "^12.6.2",' "$PKG_FILE"; then
            log_success "Added better-sqlite3 dependency"
            ISSUES_FIXED=$((ISSUES_FIXED + 1))
        else
            log_error "Failed to add better-sqlite3"
        fi
    fi
fi

# Check neo4j-driver
if grep -q '"neo4j-driver"' "$PKG_FILE"; then
    log_success "neo4j-driver dependency present"
else
    log_warn "Missing neo4j-driver dependency"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
    
    if [ "$MODE" = "--apply" ]; then
        log_info "Attempting to fix..."
        
        # Add after markdown-it
        if sed -i '/"markdown-it": "\^14.1.1",/a\    "neo4j-driver": "^6.0.1",' "$PKG_FILE"; then
            log_success "Added neo4j-driver dependency"
            ISSUES_FIXED=$((ISSUES_FIXED + 1))
        else
            log_error "Failed to add neo4j-driver"
        fi
    fi
fi

# ============================================
# CHECK 3: src/plugins/types.ts
# ============================================
print_header "Checking src/plugins/types.ts"

TYPES_FILE="src/plugins/types.ts"

# Check before_prompt_build hook
if grep -q '"before_prompt_build"' "$TYPES_FILE"; then
    log_success "before_prompt_build hook type present"
else
    log_warn "Missing before_prompt_build hook type"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
    log_error "CRITICAL: Hook type missing - manual fix required (see REINTEGRATION.md)"
fi

# Check PluginHookBeforePromptBuildEvent
if grep -q "PluginHookBeforePromptBuildEvent" "$TYPES_FILE"; then
    log_success "PluginHookBeforePromptBuildEvent type present"
else
    log_warn "Missing PluginHookBeforePromptBuildEvent type"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi

# ============================================
# CHECK 4: src/hooks/internal-hooks.ts
# ============================================
print_header "Checking src/hooks/internal-hooks.ts"

HOOKS_FILE="src/hooks/internal-hooks.ts"

# Check registerInternalHook export
if grep -q "export function registerInternalHook" "$HOOKS_FILE"; then
    log_success "registerInternalHook export present"
else
    log_warn "Missing registerInternalHook export"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
    log_error "CRITICAL: Hook registration function missing - manual fix required"
fi

# Check MessageSentHookEvent
if grep -q "MessageSentHookEvent" "$HOOKS_FILE"; then
    log_success "MessageSentHookEvent type present"
else
    log_warn "Missing MessageSentHookEvent type"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi

# ============================================
# CHECK 5: src/agents/pi-embedded-runner/run/attempt.ts
# ============================================
print_header "Checking Agent Runner"

ATTEMPT_FILE="src/agents/pi-embedded-runner/run/attempt.ts"

# Check before_prompt_build hook execution
if grep -q "before_prompt_build" "$ATTEMPT_FILE"; then
    log_success "before_prompt_build hook execution present"
else
    log_warn "Missing before_prompt_build hook execution"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi

# Check prependContext handling
if grep -q "prependContext" "$ATTEMPT_FILE"; then
    log_success "prependContext handling present"
else
    log_warn "Missing prependContext handling"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi

# ============================================
# SUMMARY
# ============================================
print_header "Re-Integration Summary"

log_info "Issues found: $ISSUES_FOUND"

if [ "$MODE" = "--apply" ]; then
    log_info "Issues fixed: $ISSUES_FIXED"
fi

if [ $ISSUES_FOUND -eq 0 ]; then
    log_success "All AURA changes are present!"
    echo ""
    log_info "Next steps:"
    echo "  1. Run: npm install"
    echo "  2. Run: npm run build"
    echo "  3. Run: npm run test:aura:post-upgrade"
    exit 0
elif [ "$MODE" = "--check-only" ]; then
    echo ""
    log_warn "Issues found. To attempt automatic fixes, run:"
    echo "  ./reintegrate-aura-changes.sh --apply"
    echo ""
    log_info "For manual fixes, see: docs/OpenClaw-Upgrade/REINTEGRATION.md"
    exit 1
else
    # Apply mode with remaining issues
    REMAINING=$((ISSUES_FOUND - ISSUES_FIXED))
    if [ $REMAINING -gt 0 ]; then
        log_warn "$REMAINING issues require manual fixing"
        echo ""
        log_info "See: docs/OpenClaw-Upgrade/REINTEGRATION.md"
        exit 1
    else
        log_success "All fixable issues resolved!"
        echo ""
        log_info "Next steps:"
        echo "  1. Run: npm install"
        echo "  2. Run: npm run build"
        echo "  3. Run: npm run test:aura:post-upgrade"
        exit 0
    fi
fi