import UIKit
import WebKit
import AuthenticationServices

/**
 AZOLVE CHAT — native iOS shell.

 This is deliberately a plain WKWebView app with no CocoaPods and no Capacitor
 dependency, so the project builds the moment you open it in Xcode. `pod install`
 and `npm install` are not required.

 What the native layer adds on top of the web app:
   - camera and microphone permission prompts for WebRTC calls
   - inline media playback (video calls start without a tap)
   - a native file picker for attachments
   - external links open in Safari instead of being trapped in the app
   - a retry screen when the backend is unreachable (Render free tier sleeps)

 The backend is a Render free instance, which goes to sleep after ~15 minutes of
 inactivity. The first launch after a sleep can take 30–60 seconds; that is the
 server waking up, not a broken app. The retry button is there for exactly that.
 */

let AZOLVE_URL = URL(string: "https://azolve-chat.onrender.com")!

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = AzolveViewController()
        window.backgroundColor = UIColor(red: 0.027, green: 0.027, blue: 0.047, alpha: 1)
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    /// The Google return trip arrives here as azolve://oauth?token=… .
    /// ASWebAuthenticationSession usually captures it before this is reached,
    /// but Safari and a cold launch both come through this delegate, so the
    /// session is replayed from here too.
    func application(_ app: UIApplication, open url: URL,
                     options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        guard url.scheme?.lowercased() == "azolve", url.host?.lowercased() == "oauth" else { return false }
        (window?.rootViewController as? AzolveViewController)?.handleDeepLink(url)
        return true
    }
}

final class AzolveViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {

    private var webView: WKWebView!
    private var spinner: UIActivityIndicatorView!
    private var errorBox: UIView!
    private var errorLabel: UILabel!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.027, green: 0.027, blue: 0.047, alpha: 1)

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()

        /* Tell the bundle it is running inside the iOS shell. Google will not
           draw its consent screen in a WKWebView, so the app has to hand the
           sign-in to the real browser; the web code only asks for that when it
           knows a shell is present. */
        let marker = WKUserScript(
            source: "window.AzolveIOS = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true)
        config.userContentController.addUserScript(marker)

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        spinner = UIActivityIndicatorView(style: .large)
        spinner.color = .white
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])

        buildErrorBox()
        loadApp()
    }

    private func buildErrorBox() {
        errorBox = UIView()
        errorBox.backgroundColor = UIColor(red: 0.027, green: 0.027, blue: 0.047, alpha: 1)
        errorBox.translatesAutoresizingMaskIntoConstraints = false
        errorBox.isHidden = true

        errorLabel = UILabel()
        errorLabel.textColor = .white
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorLabel.font = .systemFont(ofSize: 15)
        errorLabel.text = "Could not reach AZOLVE CHAT.\n\nThe server may be waking up — this can take up to a minute on the free tier."
        errorLabel.translatesAutoresizingMaskIntoConstraints = false

        let retry = UIButton(type: .system)
        retry.setTitle("Try again", for: .normal)
        retry.titleLabel?.font = .boldSystemFont(ofSize: 16)
        retry.setTitleColor(.white, for: .normal)
        retry.backgroundColor = UIColor(red: 0.427, green: 0.369, blue: 0.973, alpha: 1)
        retry.layer.cornerRadius = 12
        retry.translatesAutoresizingMaskIntoConstraints = false
        retry.addTarget(self, action: #selector(loadApp), for: .touchUpInside)

        errorBox.addSubview(errorLabel)
        errorBox.addSubview(retry)
        view.addSubview(errorBox)

        NSLayoutConstraint.activate([
            errorBox.topAnchor.constraint(equalTo: view.topAnchor),
            errorBox.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            errorBox.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            errorBox.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            errorLabel.centerYAnchor.constraint(equalTo: errorBox.centerYAnchor, constant: -40),
            errorLabel.leadingAnchor.constraint(equalTo: errorBox.leadingAnchor, constant: 32),
            errorLabel.trailingAnchor.constraint(equalTo: errorBox.trailingAnchor, constant: -32),

            retry.topAnchor.constraint(equalTo: errorLabel.bottomAnchor, constant: 28),
            retry.centerXAnchor.constraint(equalTo: errorBox.centerXAnchor),
            retry.widthAnchor.constraint(equalToConstant: 160),
            retry.heightAnchor.constraint(equalToConstant: 46),
        ])
    }

    @objc private func loadApp() {
        errorBox.isHidden = true
        spinner.startAnimating()
        webView.load(URLRequest(url: AZOLVE_URL, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 90))
    }

    // MARK: - Navigation

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        spinner.stopAnimating()
        errorBox.isHidden = true
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        spinner.stopAnimating()
        errorBox.isHidden = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        spinner.stopAnimating()
        errorBox.isHidden = false
    }

    /// Keep the app's own origin inside the WebView; send everything else to Safari.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow); return
        }
        let scheme = url.scheme?.lowercased() ?? ""

        /* Google sign-in must run in a real browser: Google answers an embedded
           WKWebView with "disallowed_useragent". Catch the start URL here and
           run the whole flow in ASWebAuthenticationSession, which is a genuine
           browser context and hands the azolve:// return straight back. */
        if navigationAction.navigationType == .linkActivated || navigationAction.targetFrame?.isMainFrame == true {
            if url.path.hasPrefix("/api/auth/oauth/google/start") {
                decisionHandler(.cancel)
                startGoogleSignIn(url)
                return
            }
        }

        if scheme == "http" || scheme == "https" || scheme == "file" || scheme == "about" {
            if let host = url.host, host != AZOLVE_URL.host, navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
            return
        }
        // azolve:// is our own return trip — never hand it to the system.
        if scheme == "azolve" {
            decisionHandler(.cancel)
            handleDeepLink(url)
            return
        }
        // mailto:, tel:, whatsapp:, etc.
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    // MARK: - Google sign-in

    private var authSession: ASWebAuthenticationSession?

    private func startGoogleSignIn(_ url: URL) {
        /* The session needs an absolute URL; the page hands us a relative one. */
        let start = URL(string: url.absoluteString, relativeTo: AZOLVE_URL)?.absoluteURL ?? url
        let session = ASWebAuthenticationSession(
            url: start,
            callbackURLScheme: "azolve"
        ) { [weak self] callback, error in
            self?.authSession = nil
            guard let self = self else { return }
            if let callback = callback {
                self.handleDeepLink(callback)
                return
            }
            /* A cancel is the person closing the sheet — say nothing. Anything
               else is a real failure and must be visible, otherwise the login
               form just reappears with no explanation. */
            if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin { return }
            if let e = error {
                self.replaySession("error=" + (e.localizedDescription.addingPercentEncoding(
                    withAllowedCharacters: .alphanumerics) ?? "sign-in-failed"))
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        session.start()
    }

    /// Replay an azolve://oauth?token=… deep link into the WebView.
    func handleDeepLink(_ url: URL) {
        guard url.scheme?.lowercased() == "azolve", url.host?.lowercased() == "oauth" else { return }
        /* The custom scheme carries the session in the query; accept a fragment
           too so either shape works. */
        var q = url.query ?? ""
        if q.isEmpty, let frag = URLComponents(url: url, resolvingAgainstBaseURL: false)?.fragment {
            q = frag
        }
        if q.hasPrefix("?") { q = String(q.dropFirst()) }
        guard !q.isEmpty else { return }
        replaySession(q)
    }

    private func replaySession(_ query: String) {
        /* The unique query is load-bearing. Navigating to the same URL with only
           a different hash is a same-document change: the bundle never re-runs,
           the OAuth fragment is never absorbed, and the person is left on the
           login form with a valid session sitting unused in the URL. */
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        guard let target = URL(string: "\(AZOLVE_URL.absoluteString)/?r=\(stamp)#/auth?\(query)") else { return }
        webView.load(URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 90))
    }

    // MARK: - Permissions (camera / microphone for WebRTC)

    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // The page only asks once the user starts a call, so granting here is
        // still user-initiated. iOS itself shows the system camera/mic prompt.
        decisionHandler(.grant)
    }

    // MARK: - File uploads

    @available(iOS 14.0, *)
    func webView(_ webView: WKWebView,
                 runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.image, .movie, .audio, .data], asCopy: true)
        picker.allowsMultipleSelection = parameters.allowsMultipleSelection
        picker.delegate = self
        picker.presentCompletion = completionHandler
        present(picker, animated: true)
    }
}

/// Small shim so the document picker can hand its result back to WebKit.
extension UIDocumentPickerViewController {
    private struct Holder { static var completion: (([URL]?) -> Void)? }
    var presentCompletion: (([URL]?) -> Void)? {
        get { Holder.completion }
        set { Holder.completion = newValue }
    }
}

extension AzolveViewController: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return view.window ?? ASPresentationAnchor()
    }
}

extension AzolveViewController: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        controller.presentCompletion?(urls)
        controller.presentCompletion = nil
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        controller.presentCompletion?(nil)
        controller.presentCompletion = nil
    }
}
