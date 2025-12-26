#!/bin/bash

# AutoE2E Setup Script for Conductor
# This script sets up the development environment and provides helper commands

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "\n${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"

    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18+ first."
        exit 1
    fi

    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js version 18+ is required. Current: $(node -v)"
        exit 1
    fi
    print_success "Node.js $(node -v)"

    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed."
        exit 1
    fi
    print_success "npm $(npm -v)"

    # Check git
    if ! command -v git &> /dev/null; then
        print_warning "git is not installed. Some features may not work."
    else
        print_success "git $(git --version | cut -d' ' -f3)"
    fi
}

# Install dependencies
install_dependencies() {
    print_header "Installing Dependencies"

    cd "$PROJECT_DIR"

    if [ -d "node_modules" ]; then
        print_info "node_modules exists, checking for updates..."
        npm install
    else
        print_info "Installing dependencies..."
        npm install
    fi

    print_success "Dependencies installed"
}

# Build the project
build_project() {
    print_header "Building Project"

    cd "$PROJECT_DIR"
    npm run build

    print_success "Project built successfully"
}

# Install Playwright browsers
install_playwright() {
    print_header "Installing Playwright Browsers"

    cd "$PROJECT_DIR"
    npx playwright install chromium

    print_success "Playwright browsers installed"
}

# Setup environment file
setup_env() {
    print_header "Setting Up Environment"

    cd "$PROJECT_DIR"

    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example .env
            print_warning "Created .env from .env.example"
            print_info "Please edit .env and add your API keys:"
            echo ""
            echo "  OPENAI_API_KEY=sk-..."
            echo "  TEST_URL=https://your-staging-url.com"
            echo "  GITHUB_TOKEN=ghp_... (optional, for private repos)"
            echo ""
        fi
    else
        print_success ".env file already exists"
    fi
}

# Verify setup
verify_setup() {
    print_header "Verifying Setup"

    cd "$PROJECT_DIR"

    # Check if build succeeded
    if [ -f "dist/cli.js" ]; then
        print_success "CLI built at dist/cli.js"
    else
        print_error "CLI not found. Build may have failed."
        exit 1
    fi

    # Check if tests pass
    print_info "Running tests..."
    if npm test -- --run &> /dev/null; then
        print_success "All tests passing"
    else
        print_warning "Some tests may be failing"
    fi

    # Check environment
    if [ -f ".env" ]; then
        if grep -q "OPENAI_API_KEY=sk-" .env 2>/dev/null; then
            print_success "OpenAI API key configured"
        else
            print_warning "OpenAI API key not configured in .env"
        fi

        if grep -q "TEST_URL=http" .env 2>/dev/null; then
            print_success "Test URL configured"
        else
            print_warning "Test URL not configured in .env"
        fi
    fi
}

# Print usage instructions
print_usage() {
    print_header "Setup Complete! 🎉"

    echo -e "AutoE2E is ready to use. Here are the available commands:\n"

    echo -e "${GREEN}Analyze a PR:${NC}"
    echo "  npm run analyze <github-pr-url>"
    echo "  Example: npm run analyze https://github.com/owner/repo/pull/123"
    echo ""

    echo -e "${GREEN}Run tests for a PR:${NC}"
    echo "  npm run vrt <pr-number>"
    echo "  Example: npm run vrt 123"
    echo ""

    echo -e "${GREEN}Update baselines:${NC}"
    echo "  npm run vrt:update <pr-number>"
    echo "  Example: npm run vrt:update 123"
    echo ""

    echo -e "${GREEN}List all tests and baselines:${NC}"
    echo "  npm run list"
    echo ""

    echo -e "${GREEN}Development:${NC}"
    echo "  npm run dev      # Watch mode for TypeScript"
    echo "  npm run build    # Build the project"
    echo "  npm test         # Run tests"
    echo ""

    echo -e "${YELLOW}Before running, make sure to:${NC}"
    echo "  1. Set OPENAI_API_KEY in .env"
    echo "  2. Set TEST_URL in .env (your staging environment)"
    echo "  3. Optionally set GITHUB_TOKEN for private repos"
    echo ""
}

# Main setup flow
main() {
    print_header "AutoE2E Setup"
    echo "Agentic Visual Regression Test Harness for SvelteKit"

    check_prerequisites
    install_dependencies
    build_project
    install_playwright
    setup_env
    verify_setup
    print_usage
}

# Run main if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
