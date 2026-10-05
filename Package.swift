// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RingDriveCore",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [.library(name: "RingDriveCore", targets: ["RingDriveCore"])],
    targets: [
        .target(name: "RingDriveCore"),
        .testTarget(name: "RingDriveCoreTests", dependencies: ["RingDriveCore"])
    ]
)
