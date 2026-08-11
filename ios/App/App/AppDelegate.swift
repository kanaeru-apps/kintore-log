import UIKit
import AVFoundation
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // WKWebView の音は既定でサイレントスイッチ（本体横の消音スイッチ）に従うため、
        // 消音のままトレーニングしているとタイマーのアラームが鳴らない。
        // 起動時点で .playback を張っておき、「鳴る」を既定の状態にする。
        // 設定でオフにされた場合は AlarmAudioPlugin が .ambient に張り替える。
        AlarmAudioSession.apply(ignoreSilentMode: AlarmAudioSession.savedPreference())
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // 電話の着信など他アプリの割り込みでオーディオセッションは非アクティブにされる。
        // 戻ってきたら張り直しておかないと、次のアラームが無音になる。
        AlarmAudioSession.apply(ignoreSilentMode: AlarmAudioSession.savedPreference())
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

/// オーディオセッションの設定をまとめたもの。
///
/// - ignoreSilentMode = true  … .playback。消音スイッチを無視して鳴る（アラーム用途）
/// - ignoreSilentMode = false … .ambient。消音スイッチに従う（動画アプリなどと同じ挙動）
///
/// どちらも .mixWithOthers を付けているので、Audible やミュージックの再生を
/// 止めずに上から重ねて鳴らせる（トレーニング中に音楽を止められると困るため）。
enum AlarmAudioSession {

    /// JS 側と同じキーで設定を持つ。AppDelegate は起動直後に呼ばれ、
    /// そのときまだ WebView が動いていないので JS からは受け取れない。
    /// UserDefaults に写しておいて、起動時はそれを読む。
    static let preferenceKey = "kintore_ignore_silent"

    static func savedPreference() -> Bool {
        // 未設定なら true（＝消音でも鳴らす）。JS 側の既定値と合わせている
        if UserDefaults.standard.object(forKey: preferenceKey) == nil { return true }
        return UserDefaults.standard.bool(forKey: preferenceKey)
    }

    @discardableResult
    static func apply(ignoreSilentMode: Bool) -> String {
        let category: AVAudioSession.Category = ignoreSilentMode ? .playback : .ambient
        do {
            try AVAudioSession.sharedInstance().setCategory(category, mode: .default, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)
            return ignoreSilentMode ? "playback" : "ambient"
        } catch {
            // 失敗しても WebView の既定動作のままアプリは動く。ここで落とす理由はない
            return "error"
        }
    }
}

/// 消音モードの扱いを JS から切り替えるための自前プラグイン。
///
/// Capacitor は capacitor.config.json の packageClassList を見てプラグインを登録するが、
/// あのファイルは `cap sync` が毎回作り直すのでアプリ側のクラスは載せられない。
/// そのため MainViewController の capacitorDidLoad() で手動登録している。
@objc(AlarmAudioPlugin)
public class AlarmAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AlarmAudioPlugin"
    public let jsName = "AlarmAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setIgnoreSilentMode", returnType: CAPPluginReturnPromise)
    ]

    @objc public func setIgnoreSilentMode(_ call: CAPPluginCall) {
        let value = call.getBool("value", true)
        UserDefaults.standard.set(value, forKey: AlarmAudioSession.preferenceKey)
        let category = AlarmAudioSession.apply(ignoreSilentMode: value)
        call.resolve(["category": category])
    }
}

/// アプリ側で定義したプラグインを登録するためだけの CAPBridgeViewController のサブクラス。
/// Main.storyboard の customClass をこれに差し替えてある。
open class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AlarmAudioPlugin())
    }
}
