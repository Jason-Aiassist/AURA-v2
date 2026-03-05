#!/bin/bash
#
# AURA Memory Integration Test Suite
# 
# Comprehensive test runner for AURA Memory integration.
# Usage: ./run-all-tests.sh [pre|post|smoke|all]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TEST_TYPE="${1:-all}"

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

# Change to repo root
cd "$REPO_ROOT"

print_header "AURA Memory Integration Test Suite"

log_info "Repository: $REPO_ROOT"
log_info "Test type: $TEST_TYPE"
log_info "Timestamp: $(date -Iseconds)"

# Check prerequisites
log_info "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    log_error "Node.js not found. Please install Node.js."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    log_error "npm not found. Please install npm."
    exit 1
fi

log_success "Prerequisites OK"

# Run tests based on type
case $TEST_TYPE in
    pre)
        print_header "Running Pre-Upgrade Tests"
        log_info "Testing system state before OpenClaw upgrade..."
        
        if node "$SCRIPT_DIR/pre-upgrade-check.mjs"; then
            log_success "Pre-upgrade tests PASSED"
            exit 0
        else
            log_error "Pre-upgrade tests FAILED"
            exit 1
        fi
        ;;
        
    post)
        print_header "Running Post-Upgrade Tests"
        log_info "Testing system state after OpenClaw upgrade..."
        
        if node "$SCRIPT_DIR/post-upgrade-check.mjs"; then
            log_success "Post-upgrade tests PASSED"
            exit 0
        else
            log_error "Post-upgrade tests FAILED"
            log_warn "Review failures and consider rollback if critical"
            exit 1
        fi
        ;;
        
    smoke)
        print_header "Running Smoke Tests"
        log_info "Running runtime smoke tests..."
        
        node "$SCRIPT_DIR/smoke-test.mjs"
        exit_code=$?
        
        if [ $exit_code -eq 0 ]; then
            log_success "Smoke tests PASSED"
        else
            log_warn "Smoke tests completed with issues (see report)"
        fi
        exit $exit_code
        ;;
        
    all|full)
        print_header "Running Full Test Suite"
        
        # Pre-upgrade tests
        log_info "Phase 1: Pre-upgrade verification..."
        if ! node "$SCRIPT_DIR/pre-upgrade-check.mjs"; then
            log_error "Pre-upgrade tests FAILED - aborting"
            exit 1
        fi
        log_success "Pre-upgrade tests PASSED"
        
        # Prompt for upgrade
        echo ""
        log_warn "Pre-upgrade tests passed!"
        log_warn "Now perform the OpenClaw upgrade:"
        echo "  1. git fetch upstream"
        echo "  2. git merge upstream/main"
        echo "  3. npm install"
        echo "  4. npm run build"
        echo ""
        read -p "Press ENTER when upgrade is complete to run post-upgrade tests..."
        
        # Post-upgrade tests
        log_info "Phase 2: Post-upgrade verification..."
        if node "$SCRIPT_DIR/post-upgrade-check.mjs"; then
            log_success "Post-upgrade tests PASSED"
        else
            log_error "Post-upgrade tests FAILED"
            log_warn "Review test results above"
        fi
        
        # Smoke tests
        log_info "Phase 3: Runtime smoke tests..."
        node "$SCRIPT_DIR/smoke-test.mjs" || true
        
        print_header "Test Suite Complete"
        log_info "Review all test reports in: docs/OpenClaw-Upgrade/tests/"
        ;;
        
    *)
        echo "Usage: $0 [pre|post|smoke|all]"
        echo ""
        echo "Commands:"
        echo "  pre   - Run pre-upgrade verification tests"
        echo "  post  - Run post-upgrade verification tests"
        echo "  smoke - Run runtime smoke tests (requires running gateway)"
        echo "  all   - Run complete test suite (pre + manual upgrade + post + smoke)"
        echo ""
        echo "Examples:"
        echo "  $0 pre    # Before upgrading OpenClaw"
        echo "  $0 post   # After upgrading OpenClaw"
        echo "  $0 smoke  # Test running system"
        exit 1
        ;;
esac

print_header "Test Reports"

log_info "Generated reports:"
for report in "$SCRIPT_DIR"/*-report.json; do
    if [ -f "$report" ]; then
        echo "  - $(basename "$report")"
    fi
done

echo ""
log_info "For detailed troubleshooting, see:"
echo "  docs/OpenClaw-Upgrade/README.md"
echo "  docs/OpenClaw-Upgrade/TROUBLESHOOTING.md"
echo ""

exit 0