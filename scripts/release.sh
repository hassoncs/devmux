#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "🚀 Devmux Release Script"
echo ""

VERSION=$(node -p "require('./devmux-cli/package.json').version")
echo "📦 Version: $VERSION"
echo ""

echo "🔨 Building devmux-cli..."
cd devmux-cli
pnpm build
echo "✓ CLI built"
cd ..

echo ""
echo "🧪 Running tests..."
cd devmux-cli
pnpm test
echo "✓ Tests passed"
cd ..

echo ""
echo "📚 Building landing page..."
cd landing
pnpm build
echo "✓ Landing built"
cd ..

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All builds complete! Ready to deploy."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

read -p "🔑 Enter npm OTP: " OTP
echo ""

if [ -z "$OTP" ]; then
    echo "❌ OTP required"
    exit 1
fi

echo "🚀 Deploying..."
echo ""

(
    cd devmux-cli
    echo "📦 Publishing to npm..."
    set -o pipefail
    if npm publish --otp="$OTP" 2>&1 | sed 's/^/   [npm] /'; then
        echo "✓ Published @chriscode/devmux@$VERSION to npm"
    else
        echo "❌ npm publish failed"
        exit 1
    fi
) &
NPM_PID=$!

(
    cd landing
    echo "🌐 Deploying to Cloudflare Pages..."
    set -o pipefail
    if pnpm deploy 2>&1 | sed 's/^/   [pages] /'; then
        echo "✓ Landing page deployed"
    else
        echo "❌ Pages deploy failed"
        exit 1
    fi
) &
PAGES_PID=$!

wait $NPM_PID
NPM_EXIT=$?

wait $PAGES_PID
PAGES_EXIT=$?

echo ""
if [ $NPM_EXIT -eq 0 ] && [ $PAGES_EXIT -eq 0 ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🎉 Release complete!"
    echo ""
    echo "   npm: https://www.npmjs.com/package/@chriscode/devmux"
    echo "   docs: https://devmux-landing.pages.dev"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
    echo "❌ Release failed"
    [ $NPM_EXIT -ne 0 ] && echo "   npm publish failed (exit $NPM_EXIT)"
    [ $PAGES_EXIT -ne 0 ] && echo "   pages deploy failed (exit $PAGES_EXIT)"
    exit 1
fi
