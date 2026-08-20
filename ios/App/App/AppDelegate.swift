import UIKit
import AVFoundation
import AudioToolbox
import UserNotifications
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

    /// - Parameter activate: セッションを有効化するか。
    ///   `setActive(true)` は「これから音を出す」という宣言で、ほかのアプリの再生に
    ///   割り込む契機になりうる。**起動のたび・前面に戻るたびに呼ぶ必要はない**ので、
    ///   既定では張り替えるだけにして、実際に鳴らす直前にだけ true で呼ぶ。
    ///   （アプリを開いただけで YouTube が止まる、という報告への対処）
    @discardableResult
    static func apply(ignoreSilentMode: Bool, activate: Bool = false) -> String {
        let category: AVAudioSession.Category = ignoreSilentMode ? .playback : .ambient
        do {
            try AVAudioSession.sharedInstance().setCategory(category, mode: .default, options: [.mixWithOthers])
            if activate {
                try AVAudioSession.sharedInstance().setActive(true)
            }
            return ignoreSilentMode ? "playback" : "ambient"
        } catch {
            // 失敗しても WebView の既定動作のままアプリは動く。ここで落とす理由はない
            return "error"
        }
    }

    /// セッションを手放す。
    /// `.notifyOthersOnDeactivation` を付けると、こちらが割り込んで止めてしまった
    /// ほかのアプリに「もう終わった」と伝わり、相手が再生を再開できる。
    static func deactivate() {
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            // 使っていない状態で呼ぶと失敗することがあるが、実害はない
        }
    }
}

/// 消音モードの扱いを JS から切り替えるための自前プラグイン。
///
/// Capacitor は capacitor.config.json の packageClassList を見てプラグインを登録するが、
/// あのファイルは `cap sync` が毎回作り直すのでアプリ側のクラスは載せられない。
/// そのため MainViewController の capacitorDidLoad() で手動登録している。
@objc(AlarmAudioPlugin)
public class AlarmAudioPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioPlayerDelegate {
    public let identifier = "AlarmAudioPlugin"
    public let jsName = "AlarmAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setIgnoreSilentMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playAlarm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopAlarm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sessionState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "installSounds", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "soundFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notificationSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "vibrate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openReviewPage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise)
    ]

    /// アプリアイコンのバッジ数を設定する。0で消去する。
    /// 通知自身が背面で付けたバッジは、WebViewの navigator.clearAppBadge が
    /// 利用できない環境でも、アプリを開いた時点で確実に消せる必要がある。
    @objc public func setBadge(_ call: CAPPluginCall) {
        let value = max(0, call.getInt("value") ?? 0)
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(value) { error in
                    if let error = error {
                        call.reject("Unable to set app badge", nil, error)
                    } else {
                        call.resolve(["value": value])
                    }
                }
            } else {
                UIApplication.shared.applicationIconBadgeNumber = value
                call.resolve(["value": value])
            }
        }
    }

    /// iPhone の「設定 > 筋トレLog」を開く。
    ///
    /// 通知が許可されていないとき、アプリ側からは二度と許可ダイアログを出せない
    /// （iOS はインストールごとに一度しか出さない）。設定アプリへ案内するしか復旧手段がないため、
    /// その一手をアプリ内から踏めるようにしておく。
    @objc public func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString),
                  UIApplication.shared.canOpenURL(url) else {
                call.resolve(["opened": false])
                return
            }
            UIApplication.shared.open(url, options: [:]) { ok in
                call.resolve(["opened": ok])
            }
        }
    }

    /// App Storeの商品ページにあるレビュー入力画面を、アプリ外で開く。
    /// URLはJS側でApple IDと action=write-review を含めて組み立てて渡す。
    @objc public func openReviewPage(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let value = call.getString("url"),
                  let url = URL(string: value),
                  url.scheme == "https",
                  url.host == "apps.apple.com" else {
                call.reject("Invalid App Store review URL")
                return
            }
            UIApplication.shared.open(url, options: [:]) { ok in
                call.resolve(["opened": ok])
            }
        }
    }

    /// 端末を振動させる。
    ///
    /// Capacitor の Haptics は CoreHaptics のエンジンを呼び出しごとに作る作りで、
    /// エンジンがローカル変数のまま関数を抜けるため、振動が途中で切れることがある。
    /// こちらは昔からある AudioServices の振動で、消音モードでも鳴り、
    /// 1回あたり約0.4秒と長さは固定だが確実に動く。
    /// 繰り返しは JS 側が間隔をあけて何度も呼ぶことで作る。
    @objc public func vibrate(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
            call.resolve()
        }
    }

    @objc public func setIgnoreSilentMode(_ call: CAPPluginCall) {
        let value = call.getBool("value", true)
        UserDefaults.standard.set(value, forKey: AlarmAudioSession.preferenceKey)
        let category = AlarmAudioSession.apply(ignoreSilentMode: value)
        call.resolve(["category": category])
    }

    // MARK: - アラーム音の再生

    /// 再生中のプレイヤー。
    /// ローカル変数のままにすると関数を抜けた時点で解放され、音が出ないか途中で切れる。
    private var alarmPlayer: AVAudioPlayer?
    /// 試聴の打ち切り予約。次の再生が始まったら取り消す（連打で先の予約が後の音を止めないように）。
    private var alarmStopWork: DispatchWorkItem?

    /// アラーム音を鳴らす。
    ///
    /// これまでは WebView の中の `<audio>` で鳴らしていたが、WKWebView はメディアを再生するとき
    /// WebKit 自身がオーディオセッションを張り替える。そのとき AppDelegate で付けた
    /// `.mixWithOthers` が外れてしまい、**YouTube などほかのアプリの音が止まる**。
    /// AVAudioPlayer で鳴らせば WebKit は関与せず、こちらが決めたセッションのまま再生される。
    ///
    /// - Parameters:
    ///   - name: 音源名（拡張子なし。`beep` など）
    ///   - seconds: 0より大きいとその秒数で打ち切る（設定画面の試聴用）
    @objc public func playAlarm(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? ""
        let seconds = call.getDouble("seconds") ?? 0
        guard let url = bundledSound(name) else {
            call.reject("同梱されていない音源です: \(name)")
            return
        }
        DispatchQueue.main.async {
            // 前の音が残っていると重なって聞こえる。必ず止めてから始める
            self.stopAlarmPlayback()
            /* WebView に張り替えられていた場合に備えて、鳴らす直前にセッションを引き直す。
               起動時にも張っているが、そのあいだに WebKit が触っている可能性があるため。 */
            let category = AlarmAudioSession.apply(ignoreSilentMode: AlarmAudioSession.savedPreference(),
                                                   activate: true)
            do {
                let player = try AVAudioPlayer(contentsOf: url)
                player.numberOfLoops = 0
                player.delegate = self // 自然に鳴り終わったことを受け取ってセッションを手放すため
                player.prepareToPlay()
                self.alarmPlayer = player
                let started = player.play()
                if seconds > 0 {
                    let work = DispatchWorkItem { [weak self] in self?.stopAlarmPlayback() }
                    self.alarmStopWork = work
                    DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
                }
                call.resolve([
                    "ok": started,
                    "category": category,
                    "duration": player.duration,
                    "mixWithOthers": AVAudioSession.sharedInstance().categoryOptions.contains(.mixWithOthers)
                ])
            } catch {
                self.alarmPlayer = nil
                call.reject("再生に失敗しました: \(name)")
            }
        }
    }

    /// 鳴っているアラームを止める。鳴っていなくても失敗しない。
    @objc public func stopAlarm(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopAlarmPlayback()
            call.resolve()
        }
    }

    /// 最後まで鳴り終わったとき。
    /// ここが無いと、鳴り終わってもセッションを掴んだままになり、
    /// 万一ほかのアプリを止めていた場合に相手が再開できない
    /// （途中で止めたときだけ手放す、という片手落ちになる）。
    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async { [weak self] in
            // 次の音が既に鳴り始めていたら、そちらのセッションを巻き添えにしない
            guard let self = self, self.alarmPlayer === player else { return }
            self.stopAlarmPlayback()
        }
    }

    private func stopAlarmPlayback() {
        alarmStopWork?.cancel()
        alarmStopWork = nil
        guard alarmPlayer != nil else { return } // 鳴っていないなら何も触らない
        alarmPlayer?.stop()
        alarmPlayer = nil
        AlarmAudioSession.deactivate()
    }

    /// いま**実際に有効になっている**オーディオセッションを読んで返す。
    ///
    /// これまで診断欄に出していたのは `setCategory` に渡した値、つまり
    /// 「アプリが設定しようとした値」であって、自分の書き込みを読み返しているだけだった。
    /// WebView に上書きされていても同じ表示になるため、上書きに気づけない。
    /// ここでは OS に問い合わせて、最終的に何が効いているかを返す。
    @objc public func sessionState(_ call: CAPPluginCall) {
        let s = AVAudioSession.sharedInstance()
        var category = s.category.rawValue
        switch s.category {
        case .playback: category = "playback"
        case .ambient: category = "ambient"
        case .soloAmbient: category = "soloAmbient"
        case .playAndRecord: category = "playAndRecord"
        case .record: category = "record"
        case .multiRoute: category = "multiRoute"
        default: break
        }
        var options: [String] = []
        let opts = s.categoryOptions
        if opts.contains(.mixWithOthers) { options.append("mixWithOthers") }
        if opts.contains(.duckOthers) { options.append("duckOthers") }
        if opts.contains(.interruptSpokenAudioAndMixWithOthers) { options.append("interruptSpokenAudio") }
        if opts.contains(.allowBluetooth) { options.append("allowBluetooth") }
        if opts.contains(.defaultToSpeaker) { options.append("defaultToSpeaker") }
        call.resolve([
            "category": category,
            "options": options,
            "mixWithOthers": opts.contains(.mixWithOthers),
            "otherAudioPlaying": s.isOtherAudioPlaying,
            "playing": alarmPlayer?.isPlaying ?? false
        ])
    }

    /// 通知音の置き場所（Library/Sounds）。iOS の UNNotificationSound が探すのはここか
    /// bundle 直下だけで、Capacitor の web 資産（bundle の public/ 配下）は対象外。
    private func soundsDirectory() -> URL? {
        guard let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { return nil }
        return lib.appendingPathComponent("Sounds")
    }

    /// 同梱WAVの在りか。
    /// Xcode の Resources に個別ファイルとして入れてあるので通常は bundle 直下に居る
    /// （＝コピーしなくても通知音として参照できる）。web資産としての public/sounds は予備。
    private func bundledSound(_ name: String) -> URL? {
        return Bundle.main.url(forResource: name, withExtension: "wav")
            ?? Bundle.main.url(forResource: name, withExtension: "wav", subdirectory: "public/sounds")
    }

    /// 同梱の WAV を Library/Sounds/ へコピーする。
    ///
    /// JS 側は fetch → base64 → Filesystem プラグインという長い経路でこれをやっていたが、
    /// 途中のどこで失敗しても「通知は出るが無音」という同じ症状になり切り分けられない。
    /// bundle からの単純なコピーで済む処理なので、ネイティブ側で完結させる。
    @objc public func installSounds(_ call: CAPPluginCall) {
        let names = call.getArray("names", String.self) ?? []
        let fm = FileManager.default
        guard let dir = soundsDirectory() else {
            call.resolve(["ok": false, "reason": "Libraryディレクトリが見つからない"])
            return
        }
        do {
            if !fm.fileExists(atPath: dir.path) {
                try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            }
        } catch {
            call.resolve(["ok": false, "reason": "Soundsフォルダを作れない"])
            return
        }
        var copied: [String] = []
        var failed: [String] = []
        for name in names {
            guard let src = bundledSound(name) else {
                failed.append("\(name):同梱されていない")
                continue
            }
            do {
                // removeItem は使わず上書きする（既存ファイルを消す必要がない）
                let data = try Data(contentsOf: src)
                try data.write(to: dir.appendingPathComponent("\(name).wav"), options: .atomic)
                copied.append(name)
            } catch {
                failed.append("\(name):書き込み失敗")
            }
        }
        call.resolve(["ok": failed.isEmpty, "dir": dir.path, "copied": copied, "failed": failed])
    }

    /// 通知音が実際にどこに在るかを返す。
    /// 「コピーしたつもり」と「本当にある」を分けて見るための確認用で、
    /// bundle 直下（本命）と Library/Sounds（予備）の両方を報告する。
    @objc public func soundFiles(_ call: CAPPluginCall) {
        let fm = FileManager.default
        let names = call.getArray("names", String.self) ?? []
        // UNNotificationSound が見に行くのは bundle 直下だけなので、
        // public/sounds にしか無いものは「同梱あり」に数えない
        let bundled = names.filter { Bundle.main.url(forResource: $0, withExtension: "wav") != nil }

        guard let dir = soundsDirectory() else {
            // 空配列はリテラルのままだと型が決まらないので、明示して渡す
            call.resolve(["dir": "", "files": [String](), "exists": false, "bundled": bundled])
            return
        }
        var files: [String] = []
        if let entries = try? fm.contentsOfDirectory(atPath: dir.path) {
            for name in entries.sorted() {
                let path = dir.appendingPathComponent(name).path
                let size = (try? fm.attributesOfItem(atPath: path)[.size]) as? Int ?? -1
                files.append("\(name) \(size)B")
            }
        }
        call.resolve([
            "dir": dir.path,
            "files": files,
            "exists": fm.fileExists(atPath: dir.path),
            "bundled": bundled
        ])
    }

    /// iOS 側の通知設定を返す。
    /// 通知を「許可」していても、サウンドだけ個別にオフにされていると無音になる。
    /// Capacitor の checkPermissions() は authorizationStatus しか返さないため自前で見る。
    @objc public func notificationSettings(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            func label(_ value: UNNotificationSetting) -> String {
                switch value {
                case .enabled: return "オン"
                case .disabled: return "オフ"
                default: return "非対応"
                }
            }
            var status = "不明"
            switch settings.authorizationStatus {
            case .notDetermined: status = "未確認"
            case .denied: status = "拒否"
            case .authorized: status = "許可"
            case .provisional: status = "仮承認(静かに配信)"
            case .ephemeral: status = "一時的"
            @unknown default: status = "不明"
            }
            var style = "不明"
            switch settings.alertStyle {
            // .none は Optional.none と紛らわしいので型を明示する
            case UNAlertStyle.none: style = "なし"
            case .banner: style = "バナー"
            case .alert: style = "通知"
            @unknown default: style = "不明"
            }
            /// 「通知の要約」に入れられていると、指定した時刻ではなく
            /// まとめ配信の時間まで保留される。＝タイマーが鳴らない、と同じ症状になる。
            /// 許可もサウンドもオンなのに来ない場合の数少ない残りの原因なので必ず見る。
            var summary = "非対応"
            if #available(iOS 15.0, *) {
                summary = label(settings.scheduledDeliverySetting)
            }
            call.resolve([
                "status": status,
                "sound": label(settings.soundSetting),
                "alert": label(settings.alertSetting),
                "lockScreen": label(settings.lockScreenSetting),
                "notificationCenter": label(settings.notificationCenterSetting),
                "alertStyle": style,
                "summary": summary
            ])
        }
    }
}

/// アプリ側で定義したプラグインを登録するためだけの CAPBridgeViewController のサブクラス。
/// Main.storyboard の customClass をこれに差し替えてある。
open class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AlarmAudioPlugin())
    }
}
