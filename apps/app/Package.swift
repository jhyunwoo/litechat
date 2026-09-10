// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "LiteChatWatchCore",
    platforms: [.macOS(.v13), .watchOS(.v10)],
    products: [.library(name:"WatchCore",targets:["WatchCore"])],
    targets: [
        .target(name:"WatchCore",path:"targets/litechat-watch",
            exclude:["Assets.xcassets","Info.plist","PrivacyInfo.xcprivacy","expo-target.config.js","LiteChatWatchApp.swift","Views.swift","WatchNotifications.swift","WatchModel.swift","WatchSessionStore.swift","WatchCacheStore.swift"],
            sources:["Models.swift","WatchAPIClient.swift"]),
        .testTarget(name:"WatchCoreTests",dependencies:["WatchCore"],path:"watch-tests")
    ]
)
