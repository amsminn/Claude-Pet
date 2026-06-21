// electron-builder afterPack hook — ad-hoc re-sign the macOS bundle.
//
// With `mac.identity: null` electron-builder SKIPS signing. That leaves the
// renamed bundle (Electron.app -> Claude-Pet.app, rewritten Info.plist) carrying
// a stale/broken signature: `codesign --verify` fails, and an invalid signature
// is REFUSED at exec on Apple Silicon ("damaged"). A free ad-hoc deep re-sign
// (`codesign --sign -`, no Developer ID, no notarization) makes the bundle
// valid-on-disk so it launches. Delivered over `curl` (no quarantine) it runs
// without a Gatekeeper prompt. (--deep is acceptable for ad-hoc/non-notarized
// use; verified valid-on-disk in Phase 0.)
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
};
