const fs = require("node:fs");
const path = require("node:path");

const { withDangerousMod } = require("expo/config-plugins");

// GhosttyKit.xcframework only vendors ios-arm64 + ios-arm64-simulator. When Xcode
// asks for a universal simulator build (arm64 + x86_64), CocoaPods refuses to
// copy any slice ("Unable to find matching slice ... (arm64 x86_64)") and Swift
// then fails with "no such module 'GhosttyKit'". EAS simulator builds hit this;
// Apple Silicon local simulators do not need x86_64 either.
//
// Apply via Podfile post_install only. Writing EXCLUDED_ARCHS[sdk=...] through
// the xcode npm pbxproj writer leaves the key unquoted and breaks later mods
// (ios.entitlements) with: Expected "/*", "=", or [A-Za-z0-9_.] but "[" found.
const MARKER = "# t3code: exclude x86_64 simulator arch (GhosttyKit is arm64-only)";
const EXCLUDE_X86_64 = `${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['EXCLUDED_ARCHS[sdk=iphonesimulator*]'] = 'x86_64'
      end
    end
    installer.aggregate_targets.each do |aggregate_target|
      aggregate_target.user_project.native_targets.each do |target|
        target.build_configurations.each do |config|
          config.build_settings['EXCLUDED_ARCHS[sdk=iphonesimulator*]'] = 'x86_64'
        end
      end
      aggregate_target.user_project.save
    end
`;

module.exports = function withIosSimulatorArm64Only(config) {
  return withDangerousMod(config, [
    "ios",
    (nextConfig) => {
      const podfilePath = path.join(nextConfig.modRequest.platformProjectRoot, "Podfile");
      const podfile = fs.readFileSync(podfilePath, "utf8");

      if (podfile.includes(MARKER)) {
        return nextConfig;
      }

      const postInstallStart = "post_install do |installer|\n";
      if (!podfile.includes(postInstallStart)) {
        throw new Error(
          "Unable to exclude x86_64 simulator arch: Podfile post_install is missing.",
        );
      }

      fs.writeFileSync(
        podfilePath,
        podfile.replace(postInstallStart, `${postInstallStart}${EXCLUDE_X86_64}`),
        "utf8",
      );
      return nextConfig;
    },
  ]);
};
